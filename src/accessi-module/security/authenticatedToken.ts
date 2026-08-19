import { StatoRegistrazione } from '../Dtos/StatoRegistrazione';

export interface AccessiAuthenticatedUserSnapshot {
  codiceUtente: number;
  email?: string;
  statoRegistrazione: StatoRegistrazione;
  flagSuper: boolean;
  flagAdminConfigurator: boolean;
}

function normalizeBooleanFlag(value: unknown): boolean {
  return value === true || value === 1 || value === '1';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function resolveCodiceUtenteFromTokenPayload(decoded: unknown): number | undefined {
  if (!isRecord(decoded)) {
    return undefined;
  }

  const userData = isRecord(decoded.userData) ? decoded.userData : undefined;
  const utente = isRecord(decoded.utente)
    ? decoded.utente
    : isRecord(userData?.utente)
      ? userData.utente
      : undefined;

  const codiceUtente = Number(utente?.codiceUtente ?? decoded.codiceUtente);
  if (!Number.isFinite(codiceUtente) || codiceUtente <= 0) {
    return undefined;
  }

  return codiceUtente;
}

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
  };

  return {
    ...basePayload,
    utente: normalizedUser,
    userData: {
      ...userData,
      utente: normalizedUser,
    },
    tokenPayload: decoded,
  };
}

export function isAuthenticatedUserEnabledForJwt(
  utente: AccessiAuthenticatedUserSnapshot | null | undefined,
): boolean {
  return utente?.statoRegistrazione === StatoRegistrazione.CONF;
}
