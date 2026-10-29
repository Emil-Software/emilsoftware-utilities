import { createHash, createPublicKey } from "crypto";
import type { JsonWebKey } from "crypto";
import type { Request, Response } from "express";
import type { AccessiOptions } from "../AccessiModule";

/** Chiave pubblica in formato JWK, pronta per una risposta JWKS. */
export type AccessiJwksKey = JsonWebKey & {
  kid: string;
  alg: string;
  use: "sig";
};

export interface AccessiJwksDocument {
  keys: AccessiJwksKey[];
}

const DEFAULT_JWKS_PATH = "accessi/.well-known/jwks.json";

function normalizePath(value: string): string {
  return `/${value.replace(/^\/+|\/+$/g, "")}`;
}

function fingerprintPublicKey(publicKey: string | Buffer): string {
  const der = createPublicKey(publicKey).export({ type: "spki", format: "der" });
  return createHash("sha256").update(der).digest("base64url").slice(0, 16);
}

function toJwksKey(
  publicKey: string | Buffer,
  keyId: string | undefined,
  algorithm: string,
): AccessiJwksKey {
  const jwk = createPublicKey(publicKey).export({ format: "jwk" }) as JsonWebKey;
  return {
    ...jwk,
    kid: keyId ?? fingerprintPublicKey(publicKey),
    alg: algorithm,
    use: "sig",
  };
}

/** Path pubblico della JWKS, oppure `undefined` quando si usa HS256. */
export function getAccessiJwksPath(options: AccessiOptions): string | undefined {
  const algorithm = options.jwtOptions.algorithm ?? "HS256";
  if (algorithm.startsWith("HS")) return undefined;
  return normalizePath(options.jwtOptions.jwksPath ?? DEFAULT_JWKS_PATH);
}

/**
 * Costruisce la JWKS pubblica con chiave corrente e chiavi precedenti.
 *
 * Restituisce `null` per HS256 o quando non e configurata una chiave
 * pubblica/privata asimmetrica.
 */
export function buildAccessiJwks(options: AccessiOptions): AccessiJwksDocument | null {
  const algorithm = options.jwtOptions.algorithm ?? "HS256";
  if (algorithm.startsWith("HS")) return null;

  const currentPublicKey = options.jwtOptions.publicKey ?? options.jwtOptions.privateKey;
  if (!currentPublicKey) return null;

  const keys: AccessiJwksKey[] = [
    toJwksKey(currentPublicKey, options.jwtOptions.keyId, algorithm),
  ];

  for (const previous of options.jwtOptions.previousPublicKeys ?? []) {
    const previousAlgorithm = previous.algorithm ?? algorithm;
    keys.push(toJwksKey(previous.publicKey, previous.keyId, previousAlgorithm));
  }

  // Deduplica per kid: la chiave corrente vince sulle precedenti.
  const unique = new Map<string, AccessiJwksKey>();
  for (const key of keys) {
    if (!unique.has(key.kid)) unique.set(key.kid, key);
  }

  return { keys: [...unique.values()] };
}

/** Handler Express per la JWKS. Risponde 404 se la configurazione e HS256. */
export function createAccessiJwksHandler(
  options: AccessiOptions,
): (req: Request, res: Response) => Response | void {
  return (_req: Request, res: Response): Response | void => {
    const document = buildAccessiJwks(options);
    if (!document) {
      return res.status(404).json({
        severity: "error",
        status: 404,
        statusCode: 2,
        code: "ACCESSI_JWKS_NOT_AVAILABLE",
        error: "ACCESSI_JWKS_NOT_AVAILABLE",
        message: "JWKS non disponibile: Accessi usa HS256 o non ha una chiave asimmetrica.",
      });
    }

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "public, max-age=300");
    return res.status(200).send(document);
  };
}

/**
 * Monta la route JWKS sull'Express host.
 *
 * Per un'app Nest esistente passare `app.getHttpAdapter().getInstance()`.
 * Restituisce il path montato, oppure `undefined` se HS256.
 */
export interface AccessiJwksExpressApp {
  get(path: string, handler: (req: Request, res: Response) => unknown): unknown;
}

export function setupAccessiJwks(
  app: AccessiJwksExpressApp,
  options: AccessiOptions,
): string | undefined {
  const path = getAccessiJwksPath(options);
  if (!path) return undefined;
  app.get(path, createAccessiJwksHandler(options));
  return path;
}
