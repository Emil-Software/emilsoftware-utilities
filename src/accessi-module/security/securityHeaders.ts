import type { NextFunction, Request, Response } from 'express';

/** Direttive CSP personalizzabili; `false` rimuove la direttiva. */
export type AccessiCspDirectives = Record<string, string[] | false>;

/** Opzioni della Content Security Policy di Accessi. */
export interface AccessiCspOptions {
  /** `false` disabilita solo la CSP, lasciando gli altri header. Default: abilitata. */
  enabled?: boolean;
  /** Invia `Content-Security-Policy-Report-Only` invece dell'header bloccante. */
  reportOnly?: boolean;
  /** Endpoint `report-uri` per la raccolta delle violazioni. */
  reportUri?: string;
  /** Origini aggiuntive per `connect-src`, es. API su un dominio diverso. */
  connectSrc?: string[];
  /**
   * Override delle direttive (vincono sui default). Per esempio
   * `{ "img-src": ["'self'", "data:", "https:"] }`.
   */
  directives?: AccessiCspDirectives;
  /**
   * La UI Swagger usa script e stili inline generati a runtime.
   * Default `true`: la CSP di OpenAPI include `'unsafe-inline'` solo lì.
   */
  swaggerUnsafeInline?: boolean;
}

/** Header di sicurezza applicati alle rotte Accessi. */
export interface AccessiSecurityHeadersOptions {
  /** `false` disabilita tutti gli header gestiti da Accessi. */
  enabled?: boolean;
  /** `X-Frame-Options`; `false` non lo invia. Default: `SAMEORIGIN`. */
  frameOptions?: string | false;
  /** `Referrer-Policy`; `false` non la invia. Default: `no-referrer`. */
  referrerPolicy?: string | false;
  /** `Permissions-Policy`; `false` non la invia. */
  permissionsPolicy?: string | false;
  /** `Cache-Control` della shell console. Default: `no-store, max-age=0`. */
  cacheControl?: string | false;
  /** CSP; `false` la disabilita. Default: abilitata. */
  contentSecurityPolicy?: false | AccessiCspOptions;
}

export type AccessiSecurityHeadersSetting = boolean | AccessiSecurityHeadersOptions;

export interface ResolvedAccessiCsp {
  reportOnly: boolean;
  reportUri?: string;
  connectSrc: string[];
  directives: AccessiCspDirectives;
  swaggerUnsafeInline: boolean;
}

export interface ResolvedAccessiSecurityHeaders {
  frameOptions: string;
  referrerPolicy: string;
  permissionsPolicy: string;
  cacheControl: string;
  contentSecurityPolicy: false | ResolvedAccessiCsp;
}

/** Superficie della risposta: cambia solo la CSP, non gli altri header. */
export type AccessiCspSurface = 'console' | 'openapi' | 'api';

const DEFAULTS = {
  frameOptions: 'SAMEORIGIN',
  referrerPolicy: 'no-referrer',
  permissionsPolicy: 'camera=(), microphone=(), geolocation=()',
  cacheControl: 'no-store, max-age=0',
} as const;

/**
 * Risolve la configurazione degli header. `undefined` e `true` equivalgono ai
 * default; `false` disabilita tutto. La forma booleana storica resta valida.
 */
export function resolveAccessiSecurityHeaders(
  setting: AccessiSecurityHeadersSetting | undefined,
): ResolvedAccessiSecurityHeaders | undefined {
  if (setting === false) return undefined;
  const options: AccessiSecurityHeadersOptions = setting === true || setting === undefined ? {} : setting;
  if (options.enabled === false) return undefined;

  const csp = options.contentSecurityPolicy;
  return {
    frameOptions: options.frameOptions === false ? '' : (options.frameOptions ?? DEFAULTS.frameOptions),
    referrerPolicy: options.referrerPolicy === false ? '' : (options.referrerPolicy ?? DEFAULTS.referrerPolicy),
    permissionsPolicy: options.permissionsPolicy === false
      ? ''
      : (options.permissionsPolicy ?? DEFAULTS.permissionsPolicy),
    cacheControl: options.cacheControl === false ? '' : (options.cacheControl ?? DEFAULTS.cacheControl),
    contentSecurityPolicy: csp === false || csp?.enabled === false
      ? false
      : {
          reportOnly: csp?.reportOnly === true,
          ...(csp?.reportUri ? { reportUri: csp.reportUri } : {}),
          connectSrc: csp?.connectSrc ?? [],
          directives: csp?.directives ?? {},
          swaggerUnsafeInline: csp?.swaggerUnsafeInline !== false,
        },
  };
}

function frameAncestors(frameOptions: string): string {
  switch (frameOptions.toUpperCase()) {
    case 'DENY':
      return "'none'";
    case 'SAMEORIGIN':
    default:
      return "'self'";
  }
}

const BASE_DIRECTIVES: AccessiCspDirectives = {
  'default-src': ["'self'"],
  'base-uri': ["'none'"],
  'object-src': ["'none'"],
  'form-action': ["'self'"],
  'img-src': ["'self'", 'data:'],
  'font-src': ["'self'"],
  'style-src': ["'self'"],
  'script-src': ["'self'"],
  'connect-src': ["'self'"],
};

function listOf(directives: AccessiCspDirectives, name: string): string[] {
  const value = directives[name];
  return Array.isArray(value) ? value : [];
}

/**
 * Costruisce la CSP per la superficie richiesta.
 *
 * La console usa un nonce per i due script inline della shell; la UI Swagger
 * richiede `'unsafe-inline'` (documentato in `docs/security-headers.md`) e non
 * riceve mai il nonce della console.
 */
export function buildAccessiContentSecurityPolicy(
  resolved: ResolvedAccessiSecurityHeaders,
  surface: AccessiCspSurface,
  options: { nonce?: string; connectSrc?: string[] } = {},
): string | undefined {
  const csp = resolved.contentSecurityPolicy;
  if (!csp) return undefined;

  const directives: AccessiCspDirectives = {};
  for (const [name, value] of Object.entries(BASE_DIRECTIVES)) {
    directives[name] = Array.isArray(value) ? [...value] : value;
  }
  if (resolved.frameOptions) {
    directives['frame-ancestors'] = [frameAncestors(resolved.frameOptions)];
  }

  const connectSrc = new Set([...listOf(directives, 'connect-src'), ...csp.connectSrc, ...(options.connectSrc ?? [])]);
  directives['connect-src'] = [...connectSrc];

  if (surface === 'console') {
    if (options.nonce) {
      directives['script-src'] = [...listOf(directives, 'script-src'), `'nonce-${options.nonce}'`];
    }
  } else if (surface === 'openapi' && csp.swaggerUnsafeInline) {
    directives['script-src'] = [...listOf(directives, 'script-src'), "'unsafe-inline'"];
    directives['style-src'] = [...listOf(directives, 'style-src'), "'unsafe-inline'"];
  }

  for (const [name, value] of Object.entries(csp.directives)) {
    if (value === false) delete directives[name];
    else directives[name] = [...value];
  }
  if (csp.reportUri) directives['report-uri'] = [csp.reportUri];

  return Object.entries(directives)
    .filter(([, value]) => value !== false && value.length > 0)
    .map(([name, value]) => `${name} ${(value as string[]).join(' ')}`)
    .join('; ');
}

/** Applica l'header CSP corretto per la superficie, se configurata. */
export function applyAccessiContentSecurityPolicy(
  res: Pick<Response, 'setHeader'>,
  resolved: ResolvedAccessiSecurityHeaders,
  surface: AccessiCspSurface,
  options: { nonce?: string; connectSrc?: string[] } = {},
): string | undefined {
  const csp = resolved.contentSecurityPolicy;
  if (!csp) return undefined;
  const policy = buildAccessiContentSecurityPolicy(resolved, surface, options);
  if (!policy) return undefined;
  res.setHeader(
    csp.reportOnly ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy',
    policy,
  );
  return policy;
}

/** Header comuni (frame, referrer, permessi) senza la CSP. */
export function applyAccessiBaseSecurityHeaders(
  res: Pick<Response, 'setHeader'>,
  resolved: ResolvedAccessiSecurityHeaders,
): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (resolved.frameOptions) res.setHeader('X-Frame-Options', resolved.frameOptions);
  if (resolved.referrerPolicy) res.setHeader('Referrer-Policy', resolved.referrerPolicy);
  if (resolved.permissionsPolicy) res.setHeader('Permissions-Policy', resolved.permissionsPolicy);
}

/**
 * Middleware per host Express/Nest.
 *
 * Applica gli header solo alle rotte Accessi. La CSP della console viene
 * sovrascritta dal controller con il nonce della richiesta; per la UI OpenAPI
 * vale la variante Swagger.
 */
export function createAccessiSecurityHeadersMiddleware(
  setting: AccessiSecurityHeadersSetting | undefined,
  isAccessiRoute: (path: string) => boolean,
  options: { isOpenApiUi?: (path: string) => boolean } = {},
): ((req: Request, res: Response, next: NextFunction) => void) | undefined {
  const resolved = resolveAccessiSecurityHeaders(setting);
  if (!resolved) return undefined;

  return (req: Request, res: Response, next: NextFunction): void => {
    if (!isAccessiRoute(req.path)) {
      next();
      return;
    }
    applyAccessiBaseSecurityHeaders(res, resolved);
    if (resolved.contentSecurityPolicy) {
      const surface: AccessiCspSurface = options.isOpenApiUi?.(req.path)
        ? 'openapi'
        : req.path.startsWith('/api/accessi/console')
          ? 'console'
          : 'api';
      applyAccessiContentSecurityPolicy(res, resolved, surface);
    }
    next();
  };
}
