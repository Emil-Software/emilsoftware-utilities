import { createHmac } from "crypto";

/** Derivazione usata dal server Accessi per separare le chiavi JWT per scopo. */
export const ACCESSI_JWT_ACCESS_PURPOSE = "accessi:jwt:access:v1";

/**
 * Deriva la chiave HMAC degli access token dal segreto configurato in
 * `ACCESSI_JWT_SECRET`.
 *
 * Serve ai resource server che condividono il segreto grezzo con Accessi ma non
 * vogliono replicare la KDF: passare il risultato come `jwt.secret`, oppure
 * usare direttamente `jwt.serverSecret`.
 */
export function deriveAccessiAccessSecret(serverSecret: string): string {
  if (typeof serverSecret !== "string" || serverSecret.length === 0) {
    throw new Error("serverSecret Accessi non configurato.");
  }
  return createHmac("sha256", serverSecret).update(ACCESSI_JWT_ACCESS_PURPOSE).digest("hex");
}
