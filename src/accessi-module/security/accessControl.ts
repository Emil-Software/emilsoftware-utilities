import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';

/** Profilo autorizzativo normalizzato estratto dal middleware Accessi. */
export interface AuthenticatedAccessiUser {
  codiceUtente: number;
  email?: string;
  flagSuper: boolean;
  flagAdminConfigurator: boolean;
}

function normalizeBooleanFlag(value: unknown): boolean {
  return value === true || value === 1 || value === '1';
}

/**
 * Estrae l'utente gia verificato da `authorizeAccessi` o `JwtSimpleGuard`.
 * Non usare questa funzione come autenticazione: se il middleware non e stato applicato genera 401.
 */
export function getAuthenticatedAccessiUser(req: Request): AuthenticatedAccessiUser {
  const payload = (req as any)?.user;
  const utente = payload?.utente ?? payload?.userData?.utente ?? payload;
  const codiceUtente = Number(utente?.codiceUtente);

  if (!Number.isSafeInteger(codiceUtente) || codiceUtente <= 0) {
    throw new UnauthorizedException('Utente non autenticato.');
  }

  return {
    codiceUtente,
    email: typeof utente?.email === 'string' ? utente.email : undefined,
    flagSuper: normalizeBooleanFlag(utente?.flagSuper),
    flagAdminConfigurator: normalizeBooleanFlag(utente?.flagAdminConfigurator),
  };
}

/** Impone il flag superutente, necessario per configurazione globale, utenti e catalogo SSO. */
export function ensureSuperUser(
  user: AuthenticatedAccessiUser,
  message = 'Operazione riservata agli amministratori.',
): void {
  if (!user.flagSuper) {
    throw new ForbiddenException(message);
  }
}

/** Permette l'operazione al proprietario della risorsa o a un superutente. */
export function ensureSelfOrSuperUser(
  user: AuthenticatedAccessiUser,
  targetUserCode: number,
  message = 'Operazione non autorizzata su questo utente.',
): void {
  if (user.flagSuper || user.codiceUtente === targetUserCode) {
    return;
  }

  throw new ForbiddenException(message);
}

/** Riconosce i campi che non possono essere aggiornati da un utente sul proprio profilo. */
export function hasPrivilegedUserChanges(user: {
  statoRegistrazione?: unknown;
  flagSuper?: unknown;
  flagAdminConfigurator?: unknown;
  passwordLoginEnabled?: unknown;
  passwordlessLoginEnabled?: unknown;
  flagDueFattori?: unknown;
  roles?: unknown;
  permissions?: unknown;
}): boolean {
  return (
    user.statoRegistrazione !== undefined ||
    user.flagSuper !== undefined ||
    user.flagAdminConfigurator !== undefined ||
    user.passwordLoginEnabled !== undefined ||
    user.passwordlessLoginEnabled !== undefined ||
    user.flagDueFattori !== undefined ||
    user.roles !== undefined ||
    user.permissions !== undefined
  );
}
