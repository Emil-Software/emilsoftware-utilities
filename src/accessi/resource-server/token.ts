import { createHash, createPublicKey } from "crypto";
import type { JsonWebKey } from "crypto";
import * as jwt from "jsonwebtoken";
import type { AccessiAccessTokenPayload } from "../contracts";
import { extractAccessiBearerToken, resolveCodiceUtenteFromTokenPayload } from "../contracts";
import { accessiAuthError } from "./errors";
import { deriveAccessiAccessSecret } from "./keys";
import type { AccessiJwtAlgorithm, AccessiResourceServerJwtOptions, AccessiUnknownKeyIdEvent } from "./types";

/** Esito della verifica locale di un access token. */
export interface AccessiTokenVerification {
  token: string;
  payload: AccessiAccessTokenPayload;
  codiceUtente: number;
  user: Record<string, unknown>;
}

/** Verificatore riutilizzabile: conserva la cache JWKS tra una richiesta e l'altra. */
export interface AccessiTokenVerifier {
  verify(token: string): Promise<AccessiTokenVerification>;
  verifyAuthorizationHeader(header: unknown): Promise<AccessiTokenVerification>;
}

interface JwksCacheEntry {
  keys: Array<Record<string, unknown>>;
  expiresAt: number;
  fetchedAt: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function extractUser(payload: Record<string, unknown>): Record<string, unknown> {
  const userData = isRecord(payload.userData) ? payload.userData : undefined;
  const utente = isRecord(payload.utente)
    ? payload.utente
    : isRecord(userData?.utente)
      ? userData.utente
      : undefined;
  return utente ?? {};
}

function defaultAlgorithms(options: AccessiResourceServerJwtOptions): AccessiJwtAlgorithm[] {
  if (options.algorithms && options.algorithms.length > 0) return options.algorithms;

  const algorithms: AccessiJwtAlgorithm[] = [];
  if (options.secret || options.serverSecret) algorithms.push("HS256");
  if (options.publicKey || options.jwks) {
    algorithms.push("RS256", "RS384", "RS512", "ES256", "ES384", "ES512");
  }
  return algorithms;
}

function algorithmFamily(algorithm: string): "hmac" | "asymmetric" {
  return algorithm.startsWith("HS") ? "hmac" : "asymmetric";
}

async function fetchJwks(
  options: NonNullable<AccessiResourceServerJwtOptions["jwks"]>,
): Promise<Array<Record<string, unknown>>> {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw accessiAuthError(500, "AUTH_CONFIG_INVALID", "fetch non disponibile per caricare la JWKS.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 3000);
  try {
    const response = await fetchImpl(options.url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw accessiAuthError(
        503,
        "AUTH_JWKS_UNAVAILABLE",
        `JWKS non disponibile (HTTP ${response.status}).`,
      );
    }
    const payload: unknown = await response.json();
    if (!isRecord(payload) || !Array.isArray(payload.keys)) {
      throw accessiAuthError(503, "AUTH_JWKS_UNAVAILABLE", "Risposta JWKS non valida.");
    }
    return payload.keys.filter(isRecord);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && "status" in error) {
      throw error;
    }
    throw accessiAuthError(503, "AUTH_JWKS_UNAVAILABLE", "JWKS non raggiungibile.");
  } finally {
    clearTimeout(timeout);
  }
}

function selectJwk(
  keys: Array<Record<string, unknown>>,
  kid: string | undefined,
  algorithm: string,
): Record<string, unknown> | undefined {
  return keys.find((key) => {
    const keyAlg = typeof key.alg === "string" ? key.alg : undefined;
    if (keyAlg && keyAlg !== algorithm) return false;
    if (!kid) return true;
    return typeof key.kid === "string" && key.kid === kid;
  });
}

/** Fingerprint della chiave pubblica, identico a quello usato dalla JWKS Accessi. */
function fingerprintPublicKey(publicKey: string | Buffer): string {
  const der = createPublicKey(publicKey).export({ type: "spki", format: "der" });
  return createHash("sha256").update(der).digest("base64url").slice(0, 16);
}

function jwkToPem(jwk: Record<string, unknown>): string {
  return createPublicKey({ key: jwk as unknown as JsonWebKey, format: "jwk" })
    .export({ type: "spki", format: "pem" })
    .toString();
}

/** L'alert non deve mai cambiare l'esito dell'autenticazione. */
function notifyUnknownKeyId(
  options: AccessiResourceServerJwtOptions,
  event: AccessiUnknownKeyIdEvent,
): void {
  try {
    options.onUnknownKeyId?.(event);
  } catch {
    // Un logger o webhook guasto non trasforma un 401 in un 500.
  }
}

/**
 * Crea un verificatore locale riutilizzabile.
 *
 * Supporta HMAC, chiavi pubbliche PEM (RS ed ES) e JWKS remoto. La cache
 * JWKS e legata all'istanza del verificatore.
 */
export function createAccessiTokenVerifier(options: AccessiResourceServerJwtOptions): AccessiTokenVerifier {
  const algorithms = defaultAlgorithms(options);
  if (algorithms.length === 0) {
    throw accessiAuthError(
      500,
      "AUTH_CONFIG_INVALID",
      "Configurare almeno una tra jwt.secret, jwt.serverSecret, jwt.publicKey e jwt.jwks.",
    );
  }

  const clockTolerance = options.clockToleranceSeconds ?? 5;
  const hmacSecret = options.secret
    ?? (options.serverSecret ? deriveAccessiAccessSecret(options.serverSecret) : undefined);
  let jwksCache: JwksCacheEntry | undefined;
  const jwksMinRefreshInterval = Math.max(0, options.jwks?.minRefreshIntervalMs ?? 5_000);

  const getJwksKeys = async (forceRefresh = false): Promise<Array<Record<string, unknown>>> => {
    if (!options.jwks) return [];
    const now = Date.now();
    if (!forceRefresh && jwksCache && jwksCache.expiresAt > now) return jwksCache.keys;
    // Refresh forzato ma troppo ravvicinato: riusa la cache per non martellare la JWKS.
    if (forceRefresh && jwksCache && now - jwksCache.fetchedAt < jwksMinRefreshInterval) {
      return jwksCache.keys;
    }
    const keys = await fetchJwks(options.jwks);
    jwksCache = {
      keys,
      expiresAt: now + Math.max(1_000, options.jwks.cacheTtlMs ?? 300_000),
      fetchedAt: now,
    };
    return keys;
  };

  const verify = async (token: string): Promise<AccessiTokenVerification> => {
    const decoded = jwt.decode(token, { complete: true });
    if (!decoded || typeof decoded === "string" || !isRecord(decoded.header)) {
      throw accessiAuthError(401, "AUTH_TOKEN_INVALID", "Token JWT non valido.");
    }

    const algorithm = typeof decoded.header.alg === "string" ? decoded.header.alg : undefined;
    if (!algorithm || !algorithms.includes(algorithm as AccessiJwtAlgorithm)) {
      throw accessiAuthError(401, "AUTH_TOKEN_INVALID", "Algoritmo JWT non consentito.");
    }

    const kid = typeof decoded.header.kid === "string" && decoded.header.kid !== ""
      ? decoded.header.kid
      : undefined;
    let key: jwt.Secret;
    let kidMismatch = false;
    if (algorithmFamily(algorithm) === "hmac") {
      if (!hmacSecret) {
        throw accessiAuthError(
          500,
          "AUTH_CONFIG_INVALID",
          "jwt.secret o jwt.serverSecret non configurato per token HS*.",
        );
      }
      key = hmacSecret;
    } else if (options.publicKey) {
      key = options.publicKey;
      if (kid) {
        const expectedKeyId = options.keyId ?? fingerprintPublicKey(options.publicKey);
        kidMismatch = kid !== expectedKeyId;
      }
    } else if (options.jwks) {
      let keys = await getJwksKeys();
      let selected = selectJwk(keys, kid, algorithm);
      if (!selected && kid) {
        // La JWKS in cache potrebbe precedere una rotazione appena avvenuta.
        keys = await getJwksKeys(true);
        selected = selectJwk(keys, kid, algorithm);
      }
      if (!selected) {
        if (kid) {
          notifyUnknownKeyId(options, { kid, algorithm, source: "jwks" });
          throw accessiAuthError(
            401,
            "AUTH_TOKEN_INVALID",
            `Chiave JWKS non trovata per kid "${kid}".`,
          );
        }
        throw accessiAuthError(401, "AUTH_TOKEN_INVALID", "Chiave JWKS non trovata per il token.");
      }
      key = jwkToPem(selected);
    } else {
      throw accessiAuthError(500, "AUTH_CONFIG_INVALID", "jwt.publicKey/jwt.jwks non configurati.");
    }

    let verified: unknown;
    try {
      verified = jwt.verify(token, key, {
        algorithms: [algorithm as jwt.Algorithm],
        ...(options.issuer ? { issuer: options.issuer } : {}),
        ...(options.audience
          ? { audience: options.audience as jwt.VerifyOptions["audience"] }
          : {}),
        clockTolerance,
      });
    } catch {
      if (kidMismatch && kid) {
        notifyUnknownKeyId(options, { kid, algorithm, source: "publicKey" });
      }
      throw accessiAuthError(401, "AUTH_TOKEN_INVALID", "Token non valido o scaduto.");
    }

    if (!isRecord(verified)) {
      throw accessiAuthError(401, "AUTH_TOKEN_INVALID", "Payload JWT non valido.");
    }
    if (verified.typ !== "access") {
      throw accessiAuthError(401, "AUTH_TOKEN_INVALID", "Il token non e un access token Accessi.");
    }

    const codiceUtente = resolveCodiceUtenteFromTokenPayload(verified);
    if (!codiceUtente) {
      throw accessiAuthError(401, "AUTH_USER_CODE_MISSING", "Token privo di un utente valido.");
    }

    return {
      token,
      payload: verified as AccessiAccessTokenPayload,
      codiceUtente,
      user: extractUser(verified),
    };
  };

  return {
    verify,
    async verifyAuthorizationHeader(header: unknown): Promise<AccessiTokenVerification> {
      const token = extractAccessiBearerToken(header);
      if (!token) {
        throw accessiAuthError(401, "AUTH_TOKEN_MISSING", "Token Bearer mancante o malformato.");
      }
      return verify(token);
    },
  };
}

/** Converte un header `Authorization` in verifica del token, senza cache JWKS condivisa. */
export async function verifyAccessiAccessToken(
  header: unknown,
  options: AccessiResourceServerJwtOptions,
): Promise<AccessiTokenVerification> {
  return createAccessiTokenVerifier(options).verifyAuthorizationHeader(header);
}
