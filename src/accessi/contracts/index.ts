/**
 * Contratti Accessi browser-safe.
 *
 * Questo entry point non importa NestJS, il database, SMTP o servizi server.
 * Contiene solo tipi, enum e helper puri condivisibili da backend, frontend e
 * resource server.
 */
export { StatoRegistrazione, StatoRegistrazioneValues } from "../../accessi-module/Dtos/StatoRegistrazione";
export { TipoAbilitazione } from "../../accessi-module/Dtos/TipoAbilitazione";

export {
  accessiRequirement,
  buildRequirementTree,
  evaluateRequirement,
  RequirementEvaluationError,
} from "../../accessi-module/middleware/accessiRequirements";

export type {
  AccessiGrant,
  GrantsResult,
  AccessiPermissionRequirement,
  AccessiAllRequirement,
  AccessiAnyRequirement,
  AccessiNotRequirement,
  AccessiCustomRequirement,
  AccessiRequirementNode,
  AccessiAuthorizationOptions,
  AccessiCustomRequirementContext,
  AccessiCustomRequirementHandler,
} from "../../accessi-module/middleware/accessiRequirements";

export {
  extractAccessiBearerToken,
  resolveCodiceUtenteFromTokenPayload,
  buildAuthenticatedTokenPayload,
  isLoginAsTokenPayload,
  isAccessiTokenAllowedForUser,
  isAuthenticatedUserEnabledForJwt,
} from "../../accessi-module/security/authenticatedToken";

export type {
  AccessiAuthenticatedUserSnapshot,
} from "../../accessi-module/security/authenticatedToken";

/** Payload di un access token Accessi verificato. Le claim extra restano disponibili. */
export interface AccessiAccessTokenPayload extends Record<string, unknown> {
  /** Obbligatorio: distingue un access token da reset token e token 2FA. */
  typ: "access";
  /** Metodi di autenticazione usati (es. `password`, `otp`, `login_as`). */
  amr?: string[];
  codiceUtente?: number;
  utente?: Record<string, unknown>;
  userData?: { utente?: Record<string, unknown> };
}
