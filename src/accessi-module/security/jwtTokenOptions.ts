import type * as jwt from "jsonwebtoken";
import type { AccessiOptions } from "../AccessiModule";
import { getAccessiJwtSecret } from "./passwordResetToken";

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

function resolveAlgorithm(options: AccessiOptions): AccessiAccessTokenAlgorithm {
  return options.jwtOptions.algorithm ?? "HS256";
}

/** Configurazione di firma: chiave, algoritmo e claim standard. */
export function getAccessiAccessTokenSigningConfig(options: AccessiOptions): {
  key: jwt.Secret;
  algorithm: AccessiAccessTokenAlgorithm;
  signOptions: Pick<jwt.SignOptions, "issuer" | "audience" | "keyid">;
} {
  const algorithm = resolveAlgorithm(options);
  const key = algorithm.startsWith("HS")
    ? getAccessiJwtSecret(options)
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

/** Configurazione di verifica: chiave pubblica per RS/ES, segreto derivato per HS. */
export function getAccessiAccessTokenVerificationConfig(options: AccessiOptions): {
  key: jwt.Secret;
  verifyOptions: jwt.VerifyOptions;
} {
  const algorithm = resolveAlgorithm(options);
  const key = algorithm.startsWith("HS")
    ? getAccessiJwtSecret(options)
    : (options.jwtOptions.publicKey ?? options.jwtOptions.privateKey);

  if (!key) {
    throw new Error(
      `jwtOptions.publicKey e obbligatoria per verificare token ${algorithm}.`,
    );
  }

  return {
    key,
    verifyOptions: {
      algorithms: [algorithm],
      ...(options.jwtOptions.issuer ? { issuer: options.jwtOptions.issuer } : {}),
      ...(options.jwtOptions.audience
        ? { audience: options.jwtOptions.audience as jwt.VerifyOptions["audience"] }
        : {}),
    },
  };
}
