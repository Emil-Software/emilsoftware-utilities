import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException,
  Type,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import { auditAccessi } from "../../accessi-module/security/audit";
import { AccessiResourceServerError } from "./errors";
import { authenticateAccessiRequest, createAccessiResourceServer } from "./runtime";
import type { AccessiResourceServerOptions } from "./types";

function toNestException(error: unknown): Error {
  const normalized = error instanceof AccessiResourceServerError
    ? error
    : new AccessiResourceServerError(500, "AUTH_INTERNAL_ERROR", "Errore interno durante l'autenticazione.");
  const payload = { code: normalized.code, message: normalized.message };

  if (normalized.status === 401) return new UnauthorizedException(payload);
  if (normalized.status === 403) return new ForbiddenException(payload);
  if (normalized.status === 503) return new ServiceUnavailableException(payload);
  return new InternalServerErrorException(payload);
}

/**
 * Crea un guard Nest configurato con le opzioni del resource server.
 *
 * Uso:
 * `@UseGuards(createAccessiAuthGuard(options))`
 */
export function createAccessiAuthGuard(
  options: AccessiResourceServerOptions,
): Type<CanActivate> {
  const runtime = createAccessiResourceServer(options);

  @Injectable()
  class ConfiguredAccessiAuthGuard implements CanActivate {
    async canActivate(context: ExecutionContext): Promise<boolean> {
      const request = context.switchToHttp().getRequest<Request>();
      try {
        await authenticateAccessiRequest(request, runtime);
        return true;
      } catch (error) {
        const normalized = error instanceof AccessiResourceServerError
          ? error
          : new AccessiResourceServerError(500, "AUTH_INTERNAL_ERROR", "Errore interno durante l'autenticazione.");
        if (runtime.options.audit !== false) {
          auditAccessi("auth_failure", {
            code: normalized.code,
            status: normalized.status,
            method: request.method,
            path: request.path,
            ip: request.ip,
          });
        }
        throw toNestException(error);
      }
    }
  }

  return ConfiguredAccessiAuthGuard;
}
