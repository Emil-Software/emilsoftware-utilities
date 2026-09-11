import { StatoRegistrazione } from '../Dtos/StatoRegistrazione';

/** Stato autorevole minimo riletto dal database per ogni verifica JWT. */
export interface AccessiAuthenticatedUserSnapshot {
  codiceUtente: number;
  email?: string;
  statoRegistrazione: StatoRegistrazione;
  flagSuper: boolean;
  flagAdminConfigurator: boolean;
  flagDueFattori?: boolean;
  passwordlessLoginEnabled?: boolean;
  passwordLoginEnabled?: boolean;
}

function normalizeBooleanFlag(value: unknown): boolean {
  return value === true || value === 1 || value === '1';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Shared, strict Bearer parsing for the Nest guard and Express middleware. */
export function extractAccessiBearerToken(header: unknown): string | undefined {
  if (typeof header !== 'string') return undefined;
  return /^Bearer[ \t]+([^\s]+)$/i.exec(header.trim())?.[1];
}

/** Estrae il codice utente sia dai JWT Accessi moderni sia dai payload legacy compatibili. */
export function resolveCodiceUtenteFromTokenPayload(decoded: unknown): number | undefined {
  if (!isRecord(decoded) || (decoded.typ !== undefined && decoded.typ !== 'access')) {
    return undefined;
  }

  const userData = isRecord(decoded.userData) ? decoded.userData : undefined;
  const utente = isRecord(decoded.utente)
    ? decoded.utente
    : isRecord(userData?.utente)
      ? userData.utente
      : undefined;

  const codiceUtente = Number(utente?.codiceUtente ?? decoded.codiceUtente);
  if (!Number.isSafeInteger(codiceUtente) || codiceUtente <= 0) {
    return undefined;
  }

  return codiceUtente;
}

/**
 * Mantiene le claim estranee al modulo ma sovrascrive il profilo con valori correnti e autorevoli dal database.
 * `tokenPayload` conserva il payload verificato originale per audit o integrazioni che ne abbiano necessita.
 */
export function buildAuthenticatedTokenPayload(
  decoded: unknown,
  utente: AccessiAuthenticatedUserSnapshot,
): Record<string, unknown> {
  const basePayload = isRecord(decoded) ? { ...decoded } : {};
  const userData = isRecord(basePayload.userData) ? { ...basePayload.userData } : {};

  const normalizedUser = {
    ...utente,
    flagSuper: normalizeBooleanFlag(utente.flagSuper),
    flagAdminConfigurator: normalizeBooleanFlag(utente.flagAdminConfigurator),
    flagDueFattori: normalizeBooleanFlag(utente.flagDueFattori),
    passwordlessLoginEnabled: normalizeBooleanFlag(utente.passwordlessLoginEnabled),
  };

  return {
    ...basePayload,
    codiceUtente: normalizedUser.codiceUtente,
    email: normalizedUser.email,
    statoRegistrazione: normalizedUser.statoRegistrazione,
    flagSuper: normalizedUser.flagSuper,
    flagAdminConfigurator: normalizedUser.flagAdminConfigurator,
    flagDueFattori: normalizedUser.flagDueFattori,
    passwordlessLoginEnabled: normalizedUser.passwordlessLoginEnabled,
    passwordLoginEnabled: normalizedUser.passwordLoginEnabled,
    utente: normalizedUser,
    userData: {
      ...userData,
      utente: normalizedUser,
    },
    tokenPayload: decoded,
  };
}

/** Enabling 2FA invalidates sessions which have not completed the required verification. */
export function isAccessiTokenAllowedForUser(decoded: unknown, user: AccessiAuthenticatedUserSnapshot): boolean {
  if (!isRecord(decoded)) return false;
  const methods = Array.isArray(decoded.amr) ? decoded.amr : [];
  if (user.flagDueFattori && !methods.includes('otp')) return false;
  if (methods.includes('passwordless') && (!user.flagDueFattori || !user.passwordlessLoginEnabled)) return false;
  return true;
}

/** Un JWT puo essere usato soltanto da utenti nello stato confermato, indipendentemente dalla sua scadenza. */
export function isAuthenticatedUserEnabledForJwt(
  utente: AccessiAuthenticatedUserSnapshot | null | undefined,
): boolean {
  return utente?.statoRegistrazione === StatoRegistrazione.CONF;
}
