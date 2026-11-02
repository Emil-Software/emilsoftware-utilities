import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';

/** Profilo autorizzativo normalizzato estratto dal middleware Accessi. */
export interface AuthenticatedAccessiUser {
  codiceUtente: number;
  email?: string;
  flagSuper: boolean;
  flagAdmin: boolean;
}

function normalizeBooleanFlag(value: unknown): boolean {
  return value === true || value === 1 || value === '1';
}

/**
 * Estrae l'utente gia verificato da `authorizeAccessi` o `JwtSimpleGuard`.
 * Non usare questa funzione come autenticazione: se il middleware non e stato applicato genera 401.
 */
export function getAuthenticatedAccessiUser(req: Request): AuthenticatedAccessiUser {
  const payload = (req as Request & { user?: unknown }).user;
  const payloadRecord = payload && typeof payload === 'object' ? payload as Record<string, unknown> : undefined;
  const userData = payloadRecord?.userData && typeof payloadRecord.userData === 'object'
    ? payloadRecord.userData as Record<string, unknown>
    : undefined;
  const rawUser = payloadRecord?.utente ?? userData?.utente ?? payloadRecord;
  const utente = rawUser && typeof rawUser === 'object' ? rawUser as Record<string, unknown> : undefined;
  const codiceUtente = Number(utente?.codiceUtente);

  if (!Number.isSafeInteger(codiceUtente) || codiceUtente <= 0) {
    throw new UnauthorizedException('Utente non autenticato.');
  }

  return {
    codiceUtente,
    email: typeof utente?.email === 'string' ? utente.email : undefined,
    flagSuper: normalizeBooleanFlag(utente?.flagSuper),
    flagAdmin: normalizeBooleanFlag(utente?.flagAdmin),
  };
}

/** Impone il flag superutente: gestione utenti e dei loro grant. */
export function ensureSuperUser(
  user: AuthenticatedAccessiUser,
  message = 'Operazione riservata ai superutenti.',
): void {
  if (!user.flagSuper) {
    throw new ForbiddenException(message);
  }
}

/** Impone il flag admin: catalogo (menu, gruppi, tipi), token di servizio e provider SSO. */
export function ensureAdmin(
  user: AuthenticatedAccessiUser,
  message = 'Operazione riservata agli amministratori.',
): void {
  if (!user.flagAdmin) {
    throw new ForbiddenException(message);
  }
}

/**
 * Gestione utenti e assegnazioni: consentita a superutenti e admin.
 * `flagAdmin` non conferisce abilitazioni, ma abilita la console completa.
 */
export function ensureUserManagement(
  user: AuthenticatedAccessiUser,
  message = 'Operazione riservata agli amministratori degli utenti.',
): void {
  if (!user.flagSuper && !user.flagAdmin) {
    throw new ForbiddenException(message);
  }
}

/**
 * Rango di un utente Accessi: 0 utente comune, 1 superutente, 2 admin.
 * La gerarchia e' ADMIN > SUPER: un attore puo' gestire solo utenti di rango
 * pari o inferiore, quindi un superutente non puo' toccare un admin.
 */
export function accessiUserRank(user: { flagSuper?: boolean; flagAdmin?: boolean }): number {
  if (user.flagAdmin) return 2;
  if (user.flagSuper) return 1;
  return 0;
}

/**
 * Impone che l'attore possa gestire il target: rango attore >= rango target.
 * Un superutente (1) gestisce utenti comuni e altri superutenti, ma non admin (2).
 */
export function ensureCanManageTargetUser(
  actor: AuthenticatedAccessiUser,
  target: { flagSuper?: boolean; flagAdmin?: boolean },
  message = 'Non puoi gestire un utente di rango superiore al tuo.',
): void {
  if (accessiUserRank(actor) < accessiUserRank(target)) {
    throw new ForbiddenException(message);
  }
}

/**
 * Limita la modifica dei flag di privilegio in base al ruolo dell'attore:
 * un admin gestisce sia `flagAdmin` sia `flagSuper`; un superutente senza
 * `flagAdmin` gestisce solo `flagSuper`.
 */
export function ensurePrivilegeFlagChanges(
  user: AuthenticatedAccessiUser,
  changes: { flagSuper?: unknown; flagAdmin?: unknown },
): void {
  if (changes.flagAdmin !== undefined && !user.flagAdmin) {
    throw new ForbiddenException('Solo un admin puo modificare il flag admin.');
  }
  if (changes.flagSuper !== undefined && !user.flagSuper && !user.flagAdmin) {
    throw new ForbiddenException('Solo un superutente o un admin puo modificare il flag superutente.');
  }
}

/** Accesso alla console: superutenti e admin. */
export function ensureConsoleAccess(
  user: AuthenticatedAccessiUser,
  message = 'La console richiede un superutente o un admin Accessi.',
): void {
  if (!user.flagSuper && !user.flagAdmin) {
    throw new ForbiddenException(message);
  }
}

/** Permette l'operazione al proprietario della risorsa o a superutenti/admin. */
export function ensureSelfOrSuperUser(
  user: AuthenticatedAccessiUser,
  targetUserCode: number,
  message = 'Operazione non autorizzata su questo utente.',
): void {
  if (user.flagSuper || user.flagAdmin || user.codiceUtente === targetUserCode) {
    return;
  }

  throw new ForbiddenException(message);
}

/** Riconosce i campi che non possono essere aggiornati da un utente sul proprio profilo. */
export function hasPrivilegedUserChanges(user: {
  statoRegistrazione?: unknown;
  flagSuper?: unknown;
  flagAdmin?: unknown;
  passwordLoginEnabled?: unknown;
  passwordlessLoginEnabled?: unknown;
  flagDueFattori?: unknown;
  roles?: unknown;
  permissions?: unknown;
}): boolean {
  return (
    user.statoRegistrazione !== undefined ||
    user.flagSuper !== undefined ||
    user.flagAdmin !== undefined ||
    user.passwordLoginEnabled !== undefined ||
    user.passwordlessLoginEnabled !== undefined ||
    user.flagDueFattori !== undefined ||
    user.roles !== undefined ||
    user.permissions !== undefined
  );
}
