import * as jwt from "jsonwebtoken";
import type { AccessiOptions } from "../AccessiModule";
import { getAccessiJwtSecret } from "./passwordResetToken";
import type { AccessiJwtPurpose } from "./passwordResetToken";
import { recordAccessiMetric } from "../observability/metrics";
import { auditAccessi } from "./audit";

/** Algoritmi supportati per gli access token Accessi. */
export type AccessiAccessTokenAlgorithm =
  | "HS256"
  | "HS384"
  | "HS512"
  | "RS256"
  | "RS384"
  | "RS512"
  | "ES256"
  | "ES384"
  | "ES512";

/**
 * Evento emesso quando un token presenta un `kid` che non appartiene né alla
 * chiave corrente né alle chiavi precedenti configurate.
 *
 * Serve per collegare un alert operativo (log, metrica, webhook) senza
 * accoppiare il modulo a uno specifico sistema di monitoraggio.
 */
export interface AccessiUnknownKeyIdEvent {
  keyId: string;
  algorithm?: string;
  /** `access` o `refresh`, per distinguere i token coinvolti. */
  purpose: AccessiJwtPurpose;
}

/** Configurazione di verifica con chiave corrente, chiavi precedenti e alert. */
export interface AccessiJwtVerificationConfig {
  /** Chiave corrente. Resta il campo principale per i consumer esistenti. */
  key: jwt.Secret;
  verifyOptions: jwt.VerifyOptions;
  /** Chiavi indicizzate per `kid`: la corrente vince sulle precedenti. */
  keysByKeyId: ReadonlyMap<string, jwt.Secret>;
  /** Chiavi provate per i token legacy privi di `kid`, corrente per prima. */
  fallbackKeys: readonly jwt.Secret[];
  purpose: AccessiJwtPurpose;
  onUnknownKeyId?: (event: AccessiUnknownKeyIdEvent) => void;
}

function resolveAlgorithm(options: AccessiOptions): AccessiAccessTokenAlgorithm {
  return options.jwtOptions.algorithm ?? "HS256";
}

/** Configurazione di firma: chiave, algoritmo e claim standard. */
function getTokenSigningConfig(
  options: AccessiOptions,
  purpose: AccessiJwtPurpose,
): {
  key: jwt.Secret;
  algorithm: AccessiAccessTokenAlgorithm;
  signOptions: Pick<jwt.SignOptions, "issuer" | "audience" | "keyid">;
} {
  const algorithm = resolveAlgorithm(options);
  const key = algorithm.startsWith("HS")
    ? getAccessiJwtSecret(options, purpose)
    : options.jwtOptions.privateKey;

  if (!key) {
    throw new Error(`jwtOptions.privateKey e obbligatoria per l'algoritmo ${algorithm}.`);
  }

  return {
    key,
    algorithm,
    signOptions: {
      ...(options.jwtOptions.issuer ? { issuer: options.jwtOptions.issuer } : {}),
      ...(options.jwtOptions.audience
        ? { audience: options.jwtOptions.audience as jwt.SignOptions["audience"] }
        : {}),
      ...(options.jwtOptions.keyId ? { keyid: options.jwtOptions.keyId } : {}),
    },
  };
}

/**
 * Configurazione di verifica.
 *
 * Con algoritmi asimmetrici accetta anche le chiavi precedenti: un token
 * firmato prima di una rotazione resta valido finché la sua chiave pubblica
 * compare in `previousPublicKeys`. I token legacy senza `kid` vengono provati
 * su tutte le chiavi candidate, la corrente per prima.
 */
function getTokenVerificationConfig(
  options: AccessiOptions,
  purpose: AccessiJwtPurpose,
): AccessiJwtVerificationConfig {
  const algorithm = resolveAlgorithm(options);
  const key = algorithm.startsWith("HS")
    ? getAccessiJwtSecret(options, purpose)
    : (options.jwtOptions.publicKey ?? options.jwtOptions.privateKey);

  if (!key) {
    throw new Error(
      `jwtOptions.publicKey e obbligatoria per verificare token ${algorithm}.`,
    );
  }

  const algorithms = new Set<string>([algorithm]);
  const keysByKeyId = new Map<string, jwt.Secret>();
  const fallbackKeys: jwt.Secret[] = [key];

  if (options.jwtOptions.keyId) {
    keysByKeyId.set(options.jwtOptions.keyId, key);
  }

  if (!algorithm.startsWith("HS")) {
    for (const previous of options.jwtOptions.previousPublicKeys ?? []) {
      const previousAlgorithm = previous.algorithm ?? algorithm;
      algorithms.add(previousAlgorithm);
      fallbackKeys.push(previous.publicKey);
      if (previous.keyId && !keysByKeyId.has(previous.keyId)) {
        keysByKeyId.set(previous.keyId, previous.publicKey);
      }
    }
  }

  return {
    key,
    verifyOptions: {
      algorithms: [...algorithms] as jwt.Algorithm[],
      ...(options.jwtOptions.issuer ? { issuer: options.jwtOptions.issuer } : {}),
      ...(options.jwtOptions.audience
        ? { audience: options.jwtOptions.audience as jwt.VerifyOptions["audience"] }
        : {}),
    },
    keysByKeyId,
    fallbackKeys,
    purpose,
    ...(options.jwtOptions.onUnknownKeyId
      ? { onUnknownKeyId: options.jwtOptions.onUnknownKeyId }
      : {}),
  };
}

function readTokenHeader(token: string): { keyId?: string; algorithm?: string } {
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded || typeof decoded === "string" || !decoded.header) return {};
  const header = decoded.header as { kid?: unknown; alg?: unknown };
  return {
    ...(typeof header.kid === "string" && header.kid !== "" ? { keyId: header.kid } : {}),
    ...(typeof header.alg === "string" ? { algorithm: header.alg } : {}),
  };
}

/**
 * Chiavi da provare per un token.
 *
 * Un `kid` noto seleziona una sola chiave: non si ricade sulle altre, così un
 * token con intestazione manomessa non viene verificato per tentativi.
 */
export function resolveAccessiVerificationKeys(
  config: AccessiJwtVerificationConfig,
  token: string,
): readonly jwt.Secret[] {
  const header = readTokenHeader(token);
  // Con HMAC il kid non partecipa alla crittografia: un kid cambiato non deve
  // invalidare token firmati con lo stesso segreto.
  const hmacOnly = (config.verifyOptions.algorithms ?? []).every((algorithm) =>
    String(algorithm).startsWith("HS"),
  );
  if (!header.keyId || hmacOnly) return config.fallbackKeys;

  const key = config.keysByKeyId.get(header.keyId);
  if (key) return [key];

  config.onUnknownKeyId?.({
    keyId: header.keyId,
    ...(header.algorithm ? { algorithm: header.algorithm } : {}),
    purpose: config.purpose,
  });
  recordAccessiMetric('accessi_jwt_unknown_key_id_total', 1, {
    purpose: config.purpose,
    ...(header.algorithm ? { algorithm: header.algorithm } : {}),
  });
  auditAccessi('jwt_unknown_key_id', {
    kid: header.keyId,
    purpose: config.purpose,
    ...(header.algorithm ? { algorithm: header.algorithm } : {}),
  });
  return [];
}

/**
 * Verifica un JWT Accessi con la chiave corretta (corrente o precedente).
 *
 * Lancia l'errore di `jsonwebtoken` quando nessuna chiave candidata verifica il
 * token; per un `kid` sconosciuto lancia un errore dedicato dopo aver emesso
 * l'evento di alert.
 */
export function verifyAccessiJwt(token: string, config: AccessiJwtVerificationConfig): unknown {
  const keys = resolveAccessiVerificationKeys(config, token);
  if (keys.length === 0) {
    const { keyId } = readTokenHeader(token);
    throw new Error(`Chiave JWT sconosciuta per kid "${keyId ?? "assente"}".`);
  }

  let lastError: unknown;
  for (const key of keys) {
    try {
      return jwt.verify(token, key, config.verifyOptions);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Token JWT non valido.");
}

export function getAccessiAccessTokenSigningConfig(options: AccessiOptions) {
  return getTokenSigningConfig(options, "access");
}

export function getAccessiAccessTokenVerificationConfig(options: AccessiOptions) {
  return getTokenVerificationConfig(options, "access");
}

export function getAccessiRefreshTokenSigningConfig(options: AccessiOptions) {
  return getTokenSigningConfig(options, "refresh");
}

export function getAccessiRefreshTokenVerificationConfig(options: AccessiOptions) {
  return getTokenVerificationConfig(options, "refresh");
}
