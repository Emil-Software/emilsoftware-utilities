import type { NextFunction, Request, Response } from "express";
import { auditAccessi } from "../../accessi-module/security/audit";
import { AccessiResourceServerError, accessiAuthError } from "./errors";
import { authenticateAccessiRequest, createAccessiResourceServer } from "./runtime";
import type { AccessiResourceServerRuntime } from "./runtime";
import type { AccessiResourceServerOptions } from "./types";

/** Normalizza un errore sconosciuto nel contratto di errore Accessi. */
export function toAccessiResourceServerError(error: unknown): AccessiResourceServerError {
  if (error instanceof AccessiResourceServerError) return error;
  return accessiAuthError(500, "AUTH_INTERNAL_ERROR", "Errore interno durante l'autenticazione.");
}

/** Invia la risposta di errore Accessi senza esporre stack trace o dettagli interni. */
export function sendAccessiResourceServerError(res: Response, error: unknown): Response {
  const normalized = toAccessiResourceServerError(error);
  return res.status(normalized.status).json({
    severity: "error",
    status: normalized.status,
    statusCode: 2,
    code: normalized.code,
    error: normalized.code,
    message: normalized.message,
  });
}

/**
 * Middleware Express per backend che non possiedono il database Accessi.
 *
 * Popola `req.user`, `req.data` e `req.accessi`; con una policy di autorizzazione
 * popola anche `req.userGrants`.
 */
export function createAccessiAuthMiddleware(
  options: AccessiResourceServerOptions,
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  const runtime = createAccessiResourceServer(options);

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await authenticateAccessiRequest(req, runtime);
      next();
    } catch (error) {
      const normalized = toAccessiResourceServerError(error);
      if (runtime.options.audit !== false) {
        auditAccessi("auth_failure", {
          code: normalized.code,
          status: normalized.status,
          method: req.method,
          path: req.path,
          ip: req.ip,
        });
      }
      sendAccessiResourceServerError(res, error);
    }
  };
}

/** Variante con runtime gia creato, utile per test o bootstrap manuale. */
export function createAccessiAuthMiddlewareFromRuntime(
  runtime: AccessiResourceServerRuntime,
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await authenticateAccessiRequest(req, runtime);
      next();
    } catch (error) {
      const normalized = toAccessiResourceServerError(error);
      if (runtime.options.audit !== false) {
        auditAccessi("auth_failure", {
          code: normalized.code,
          status: normalized.status,
          method: req.method,
          path: req.path,
          ip: req.ip,
        });
      }
      sendAccessiResourceServerError(res, error);
    }
  };
}
