import type { NextFunction, Request, Response } from 'express';
import { getDefaultRateLimitStore } from './rateLimitStore';
import type { RateLimitStore } from './rateLimitStore';

/** Opzioni del limite grossolano per IP applicato davanti alle rotte Accessi. */
export interface AccessiEdgeRateLimitOptions {
  /** Default: true quando l'oggetto viene configurato. */
  enabled?: boolean;
  /** Finestra del limite. Default: 60000 ms. */
  windowMs?: number;
  /** Richieste consentite per IP nella finestra. Default: 300. */
  maxAttempts?: number;
  /** Store condiviso. Default: memoria. */
  store?: RateLimitStore;
  /** Prefisso delle chiavi. Default: `edge`. */
  keyPrefix?: string;
  /**
   * Decide se applicare il limite alla richiesta.
   *
   * Default: `/api` e `/api/*`. Il bootstrap Accessi passa un matcher che include
   * anche OpenAPI e JWKS.
   */
  match?: (path: string, req: Request) => boolean;
}

export type AccessiEdgeRateLimitMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => Promise<void>;

const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_ATTEMPTS = 300;

function defaultMatch(path: string): boolean {
  return path === '/api' || path.startsWith('/api/');
}

/**
 * Middleware edge per Accessi Service.
 *
 * Non sostituisce il rate limit applicativo per account: aggiunge una soglia
 * grossolana per IP, utile contro bot e floods prima che la richiesta raggiunga
 * controller, database o introspection.
 */
export function createAccessiEdgeRateLimitMiddleware(
  options: AccessiEdgeRateLimitOptions = {},
): AccessiEdgeRateLimitMiddleware | undefined {
  if (options.enabled === false) return undefined;

  const windowMs = Math.max(1, Math.trunc(options.windowMs ?? DEFAULT_WINDOW_MS));
  const maxAttempts = Math.max(1, Math.trunc(options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS));
  const store = options.store ?? getDefaultRateLimitStore();
  const keyPrefix = (options.keyPrefix ?? 'edge').replace(/\|+$/, '');
  const match = options.match ?? defaultMatch;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!match(req.path, req)) {
      next();
      return;
    }

    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    try {
      const decision = await store.consume(
        `${keyPrefix}|ip|${ip}`,
        windowMs,
        maxAttempts,
      );
      if (!decision.allowed) {
        res.setHeader('Retry-After', String(decision.retryAfterSeconds));
        res.status(429).json({
          severity: 'error',
          status: 429,
          statusCode: 2,
          code: 'ACCESSI_EDGE_RATE_LIMITED',
          error: 'ACCESSI_EDGE_RATE_LIMITED',
          message: 'Troppe richieste. Riprova piu tardi.',
        });
        return;
      }
      next();
    } catch {
      res.status(503).json({
        severity: 'error',
        status: 503,
        statusCode: 2,
        code: 'ACCESSI_RATE_LIMIT_UNAVAILABLE',
        error: 'ACCESSI_RATE_LIMIT_UNAVAILABLE',
        message: 'Rate limit non disponibile. Riprova piu tardi.',
      });
    }
  };
}
