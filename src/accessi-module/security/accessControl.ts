import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';

export interface AuthenticatedAccessiUser {
  codiceUtente: number;
  email?: string;
  flagSuper: boolean;
  flagAdminConfigurator: boolean;
}

function normalizeBooleanFlag(value: unknown): boolean {
  return value === true || value === 1 || value === '1';
}

export function getAuthenticatedAccessiUser(req: Request): AuthenticatedAccessiUser {
  const payload = (req as any)?.user;
  const utente = payload?.utente ?? payload?.userData?.utente ?? payload;
  const codiceUtente = Number(utente?.codiceUtente);

  if (!codiceUtente) {
    throw new UnauthorizedException('Utente non autenticato.');
  }

  return {
    codiceUtente,
    email: typeof utente?.email === 'string' ? utente.email : undefined,
    flagSuper: normalizeBooleanFlag(utente?.flagSuper),
    flagAdminConfigurator: normalizeBooleanFlag(utente?.flagAdminConfigurator),
  };
}

export function ensureSuperUser(
  user: AuthenticatedAccessiUser,
  message = 'Operazione riservata agli amministratori.',
): void {
  if (!user.flagSuper) {
    throw new ForbiddenException(message);
  }
}

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

export function hasPrivilegedUserChanges(user: {
  statoRegistrazione?: unknown;
  flagSuper?: unknown;
  flagAdminConfigurator?: unknown;
  roles?: unknown;
  permissions?: unknown;
}): boolean {
  return (
    user.statoRegistrazione !== undefined ||
    user.flagSuper !== undefined ||
    user.flagAdminConfigurator !== undefined ||
    user.roles !== undefined ||
    user.permissions !== undefined
  );
}
