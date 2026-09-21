import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ServiceTokenService, serviceTokenHasScope, VerifiedServiceToken } from '../Services/ServiceTokenService/ServiceTokenService';
import { extractAccessiBearerToken } from './authenticatedToken';

/** Chiave dei metadata usata da `@RequireServiceTokenScopes`. */
export const SERVICE_TOKEN_SCOPES_METADATA = 'accessi:service-token-scopes';

/** Richiede che il token di servizio presenti tutti gli scope indicati. */
export const RequireServiceTokenScopes = (...scopes: string[]) => SetMetadata(SERVICE_TOKEN_SCOPES_METADATA, scopes);

export type AccessiServiceTokenRequest = Request & { accessiServiceToken?: VerifiedServiceToken };

/** Restituisce il token di servizio verificato da `ServiceTokenGuard`; lancia 401 se assente. */
export function getAccessiServiceToken(req: Request): VerifiedServiceToken {
  const verified = (req as AccessiServiceTokenRequest).accessiServiceToken;
  if (!verified) {
    throw new UnauthorizedException('Token di servizio non verificato.');
  }
  return verified;
}

/**
 * Autentica le chiamate tecniche macchina-a-macchina tramite `Authorization: Bearer <token>`.
 *
 * Il token e per installazione/servizio, non legato a un utente. Gli scope richiesti si dichiarano
 * con `@RequireServiceTokenScopes('ia')`.
 */
@Injectable()
export class ServiceTokenGuard implements CanActivate {
  constructor(
    private readonly serviceTokenService: ServiceTokenService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = extractAccessiBearerToken(request.headers['authorization']);
    if (!token) {
      throw new UnauthorizedException('Token di servizio mancante.');
    }

    const verified = await this.serviceTokenService.verify(token);
    if (!verified) {
      throw new UnauthorizedException('Token di servizio non valido, scaduto o revocato.');
    }

    (request as AccessiServiceTokenRequest).accessiServiceToken = verified;

    const requiredScopes = this.reflector.getAllAndOverride<string[]>(SERVICE_TOKEN_SCOPES_METADATA, [
      context.getHandler(),
      context.getClass(),
    ]) ?? [];
    const missingScope = requiredScopes.find((scope) => !serviceTokenHasScope(verified.scopes, scope));
    if (missingScope) {
      throw new ForbiddenException(`Scope '${missingScope}' non autorizzato per questo token.`);
    }

    return true;
  }
}
