/** Codici stabili del resource server, allineati al contratto HTTP Accessi. */
export type AccessiResourceServerErrorCode =
  | "AUTH_HEADER_MISSING"
  | "AUTH_TOKEN_MISSING"
  | "AUTH_TOKEN_INVALID"
  | "AUTH_USER_CODE_MISSING"
  | "AUTH_USER_DISABLED"
  | "AUTH_INSUFFICIENT_PERMISSIONS"
  | "AUTH_CONFIG_INVALID"
  | "AUTH_GRANTS_SOURCE_MISSING"
  | "AUTH_INTROSPECTION_UNAVAILABLE"
  | "AUTH_INTROSPECTION_UNAUTHORIZED"
  | "AUTH_JWKS_UNAVAILABLE"
  | "AUTH_INTERNAL_ERROR";

/** Errore tipizzato del resource server, convertibile in risposta HTTP o eccezione Nest. */
export class AccessiResourceServerError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: AccessiResourceServerErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AccessiResourceServerError";
  }
}

export function accessiAuthError(
  status: number,
  code: AccessiResourceServerErrorCode,
  message: string,
  details?: Record<string, unknown>,
): AccessiResourceServerError {
  return new AccessiResourceServerError(status, code, message, details);
}
