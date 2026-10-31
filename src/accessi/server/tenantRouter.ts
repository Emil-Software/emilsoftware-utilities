import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { AccessiTenant, AccessiTenantRegistry } from './tenants';
import { runWithAccessiTenant } from '../../accessi-module/tenancy/tenantContext';

/** Request arricchita dal router con il tenant risolto. */
export interface AccessiTenantAwareRequest extends Request {
  accessiTenant?: AccessiTenant;
}

export interface CreateAccessiTenantRouterOptions {
  registry: AccessiTenantRegistry;
  /**
   * Handler per tenant. Ogni handler deve essere indipendente (per esempio
   * l'app Express di un `createAccessiService` gia inizializzato).
   */
  handlers: Record<string, RequestHandler> | Map<string, RequestHandler>;
  /** Abilita l'header `x-accessi-tenant`. Default: false. */
  allowHeader?: boolean;
  /** Nome header tenant. Default `x-accessi-tenant`. */
  headerName?: string;
  /** Risposta quando nessun tenant corrisponde. Default: 404 JSON Accessi. */
  onNotFound?: RequestHandler;
  /** Risposta quando il tenant esiste ma non ha handler. Default: 501 JSON. */
  onMissingHandler?: RequestHandler;
}

function defaultHeader(request: Request, name: string): string | undefined {
  const value = request.headers[name];
  if (Array.isArray(value)) return value[0];
  return typeof value === 'string' ? value : undefined;
}

function requestPath(request: Request): string {
  if (typeof request.path === 'string' && request.path !== '') return request.path;
  const url = typeof request.url === 'string' ? request.url : '/';
  const query = url.indexOf('?');
  return query >= 0 ? url.slice(0, query) : url;
}

function getHandler(
  handlers: CreateAccessiTenantRouterOptions['handlers'],
  tenantId: string,
): RequestHandler | undefined {
  if (handlers instanceof Map) return handlers.get(tenantId);
  return Object.prototype.hasOwnProperty.call(handlers, tenantId)
    ? handlers[tenantId]
    : undefined;
}

function sendTenantError(
  res: Response,
  status: number,
  code: string,
  message: string,
): Response {
  return res.status(status).json({
    severity: 'error',
    status,
    statusCode: 2,
    code,
    error: code,
    message,
  });
}

/**
 * Router multi-tenant in-process (opt-in, fase 4 ADR).
 *
 * Risolve il tenant da host, path e header fidato, poi delega al suo handler
 * dentro `runWithAccessiTenant`: audit e metriche emessi durante la richiesta
 * ricevono il label `tenant`. Nessun fallback implicito: un host/path
 * sconosciuto risponde 404 e non usa il primo tenant disponibile.
 *
 * Non sostituisce il processo-per-tenant come default: gli handler restano
 * applicazioni indipendenti e le API globali (`authorizeAccessi`,
 * `setAccessiAuthService`) non sono tenant-aware.
 */
export function createAccessiTenantRouter(
  options: CreateAccessiTenantRouterOptions,
): RequestHandler {
  if (!options?.registry) throw new Error('createAccessiTenantRouter: registry obbligatorio.');
  if (!options.handlers) throw new Error('createAccessiTenantRouter: handlers obbligatorio.');

  const headerName = (options.headerName ?? 'x-accessi-tenant').toLowerCase();
  const notFound = options.onNotFound ?? ((_req: Request, res: Response) => sendTenantError(
    res,
    404,
    'ACCESSI_TENANT_NOT_FOUND',
    'Nessun tenant Accessi configurato per questa richiesta.',
  ));
  const missingHandler = options.onMissingHandler ?? ((_req: Request, res: Response) => sendTenantError(
    res,
    501,
    'ACCESSI_TENANT_HANDLER_MISSING',
    'Tenant risolto ma nessun handler configurato.',
  ));

  return (request: Request, response: Response, next: NextFunction): void | Promise<void> => {
    const resolution = options.registry.resolve(
      {
        ...(typeof request.headers.host === 'string' ? { host: request.headers.host } : {}),
        path: requestPath(request),
        ...(defaultHeader(request, headerName) ? { header: defaultHeader(request, headerName) } : {}),
      },
      options.allowHeader !== undefined ? { allowHeader: options.allowHeader } : undefined,
    );

    if (!resolution) {
      notFound(request, response, next);
      return;
    }
    const handler = getHandler(options.handlers, resolution.tenant.id);
    if (!handler) {
      missingHandler(request, response, next);
      return;
    }

    (request as AccessiTenantAwareRequest).accessiTenant = resolution.tenant;
    return runWithAccessiTenant(resolution.tenant.id, () => handler(request, response, next)) as void | Promise<void>;
  };
}
