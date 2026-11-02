import { randomBytes, timingSafeEqual } from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import type * as jwt from 'jsonwebtoken';
import { decode as decodeJwt } from 'jsonwebtoken';
import type { AccessiOptions } from '../AccessiModule';

/** Modalita di autenticazione via cookie httpOnly. */
export interface AccessiAuthCookieOptions {
  /** Default `true`: la sola presenza dell'oggetto abilita la modalita cookie. */
  enabled?: boolean;
  /** `Secure` sui cookie. Default `true`; disattivare solo in sviluppo locale HTTP. */
  secure?: boolean;
  /** Default `lax`. Per SPA su altro dominio serve `none` insieme a `secure: true`. */
  sameSite?: 'strict' | 'lax' | 'none';
  /** Dominio dei cookie, opzionale. */
  domain?: string;
  /** Nome del cookie con l'access token. Default `accessi_access`. */
  accessTokenName?: string;
  /** Nome del cookie con il refresh token. Default `accessi_refresh`. */
  refreshTokenName?: string;
  /** Nome del cookie CSRF leggibile dal client. Default `accessi_csrf`. */
  csrfTokenName?: string;
  /** Path del cookie access. Default `/api/accessi`. */
  accessPath?: string;
  /** Path del cookie refresh. Default `/api/accessi/auth`. */
  refreshPath?: string;
  /** Path del cookie CSRF. Default `/`. */
  csrfPath?: string;
  /** Header CSRF richiesto. Default `x-csrf-token`. */
  csrfHeaderName?: string;
  /** `double-submit` (default) oppure `off` per host che gestiscono CSRF altrove. */
  csrf?: 'double-submit' | 'off';
  /**
   * Restituisce comunque i token nel body JSON. Default `false`: in modalita
   * cookie i token restano solo negli header httpOnly.
   */
  exposeTokens?: boolean;
  /** Legge il refresh token dal cookie quando il body non lo contiene. Default `true`. */
  refreshFromCookie?: boolean;
}

export type AccessiAuthCookieSetting = AccessiAuthCookieOptions;

export interface ResolvedAccessiAuthCookieOptions {
  secure: boolean;
  sameSite: 'strict' | 'lax' | 'none';
  domain?: string;
  accessTokenName: string;
  refreshTokenName: string;
  csrfTokenName: string;
  accessPath: string;
  refreshPath: string;
  csrfPath: string;
  csrfHeaderName: string;
  csrf: 'double-submit' | 'off';
  exposeTokens: boolean;
  refreshFromCookie: boolean;
}

export interface AccessiAuthTokenPair {
  access?: string;
  refresh?: string;
}

const COOKIE_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

const DEFAULTS = {
  secure: true,
  sameSite: 'lax' as const,
  accessTokenName: 'accessi_access',
  refreshTokenName: 'accessi_refresh',
  csrfTokenName: 'accessi_csrf',
  accessPath: '/api/accessi',
  refreshPath: '/api/accessi/auth',
  csrfPath: '/',
  csrfHeaderName: 'x-csrf-token',
  csrf: 'double-submit' as const,
  exposeTokens: false,
  refreshFromCookie: true,
};

/** Percorsi pubblici che non richiedono il token CSRF (non hanno ancora una sessione). */
const CSRF_EXEMPT_PATHS = [
  '/api/accessi/auth/login',
  '/api/accessi/auth/refresh',
  '/api/accessi/auth/confirm-reset-password',
  '/api/accessi/auth/two-factor/verify',
  '/api/accessi/auth/two-factor/resend',
  '/api/accessi/auth/bootstrap-admin',
  '/api/accessi/email/',
  '/api/accessi/federated-auth/exchange',
  '/api/accessi/user/register',
];

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Risolve la configurazione dei cookie; `undefined` quando la modalita e disattivata. */
export function resolveAccessiAuthCookieOptions(
  options: Pick<AccessiOptions, 'authCookie'>,
): ResolvedAccessiAuthCookieOptions | undefined {
  const raw = options.authCookie;
  if (!raw || raw.enabled === false) return undefined;

  return {
    secure: raw.secure !== false,
    sameSite: raw.sameSite ?? DEFAULTS.sameSite,
    ...(raw.domain ? { domain: raw.domain } : {}),
    accessTokenName: raw.accessTokenName ?? DEFAULTS.accessTokenName,
    refreshTokenName: raw.refreshTokenName ?? DEFAULTS.refreshTokenName,
    csrfTokenName: raw.csrfTokenName ?? DEFAULTS.csrfTokenName,
    accessPath: raw.accessPath ?? DEFAULTS.accessPath,
    refreshPath: raw.refreshPath ?? DEFAULTS.refreshPath,
    csrfPath: raw.csrfPath ?? DEFAULTS.csrfPath,
    csrfHeaderName: (raw.csrfHeaderName ?? DEFAULTS.csrfHeaderName).toLowerCase(),
    csrf: raw.csrf ?? DEFAULTS.csrf,
    exposeTokens: raw.exposeTokens === true,
    refreshFromCookie: raw.refreshFromCookie !== false,
  };
}

/** Legge i cookie senza aggiungere la dipendenza `cookie-parser`. */
export function parseAccessiCookieHeader(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    if (!name) continue;
    const rawValue = part.slice(separator + 1).trim();
    try {
      cookies[name] = decodeURIComponent(rawValue);
    } catch {
      cookies[name] = rawValue;
    }
  }
  return cookies;
}

/** True per richieste che modificano stato (dove serve il CSRF). */
export function isAccessiUnsafeMethod(method: string): boolean {
  return UNSAFE_METHODS.has(method.toUpperCase());
}

/** True per gli endpoint pubblici esenti da CSRF. */
export function isAccessiCsrfExemptPath(path: string): boolean {
  return CSRF_EXEMPT_PATHS.some((exempt) =>
    exempt.endsWith('/') ? path.startsWith(exempt) : path === exempt,
  );
}

function tokenMaxAgeSeconds(token: string | undefined): number | undefined {
  if (!token) return undefined;
  const decoded = decodeJwt(token) as jwt.JwtPayload | string | null;
  if (!decoded || typeof decoded === 'string') return undefined;
  const exp = Number(decoded.exp);
  if (!Number.isFinite(exp)) return undefined;
  return Math.max(0, Math.floor(exp - Date.now() / 1000));
}

function serializeCookie(
  name: string,
  value: string,
  options: {
    path: string;
    maxAgeSeconds?: number;
    httpOnly?: boolean;
    secure: boolean;
    sameSite: 'strict' | 'lax' | 'none';
    domain?: string;
  },
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${options.path}`];
  if (options.domain) parts.push(`Domain=${options.domain}`);
  if (options.maxAgeSeconds !== undefined) parts.push(`Max-Age=${options.maxAgeSeconds}`);
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');
  const sameSite = { strict: 'Strict', lax: 'Lax', none: 'None' }[options.sameSite];
  parts.push(`SameSite=${sameSite}`);
  return parts.join('; ');
}

function appendCookie(res: Pick<Response, 'append'>, cookie: string): void {
  res.append('Set-Cookie', cookie);
}

/** Imposta i cookie access, refresh e (se assente) CSRF. */
export function setAccessiAuthCookies(
  res: Pick<Response, 'append'>,
  config: ResolvedAccessiAuthCookieOptions,
  tokens: AccessiAuthTokenPair,
): void {
  if (tokens.access) {
    appendCookie(res, serializeCookie(config.accessTokenName, tokens.access, {
      path: config.accessPath,
      ...(tokenMaxAgeSeconds(tokens.access) !== undefined
        ? { maxAgeSeconds: tokenMaxAgeSeconds(tokens.access) }
        : {}),
      httpOnly: true,
      secure: config.secure,
      sameSite: config.sameSite,
      ...(config.domain ? { domain: config.domain } : {}),
    }));
  }
  if (tokens.refresh) {
    appendCookie(res, serializeCookie(config.refreshTokenName, tokens.refresh, {
      path: config.refreshPath,
      ...(tokenMaxAgeSeconds(tokens.refresh) !== undefined
        ? { maxAgeSeconds: tokenMaxAgeSeconds(tokens.refresh) }
        : {}),
      httpOnly: true,
      secure: config.secure,
      sameSite: config.sameSite,
      ...(config.domain ? { domain: config.domain } : {}),
    }));
  }
}

/** Cancella i cookie di sessione (logout/revoca). */
export function clearAccessiAuthCookies(
  res: Pick<Response, 'append'>,
  config: ResolvedAccessiAuthCookieOptions,
): void {
  for (const [name, path] of [
    [config.accessTokenName, config.accessPath],
    [config.refreshTokenName, config.refreshPath],
    [config.csrfTokenName, config.csrfPath],
  ] as const) {
    appendCookie(res, serializeCookie(name, '', {
      path,
      maxAgeSeconds: 0,
      httpOnly: name !== config.csrfTokenName,
      secure: config.secure,
      sameSite: config.sameSite,
      ...(config.domain ? { domain: config.domain } : {}),
    }));
  }
}

export interface AccessiAuthTokenValue {
  value?: string;
}

/** Forma comune dei risultati di auth: stringa o `TokenResult` di Accessi. */
export interface AccessiAuthResultLike {
  token?: string | AccessiAuthTokenValue;
  refreshToken?: string | AccessiAuthTokenValue;
}

function accessiTokenValue(token: string | AccessiAuthTokenValue | undefined): string | undefined {
  if (typeof token === 'string') return token === '' ? undefined : token;
  return token?.value;
}

/**
 * Prepara la risposta di login/refresh: imposta i cookie e rimuove i token dal
 * body quando la modalita cookie non prevede `exposeTokens`.
 */
export function applyAccessiAuthCookies<T extends AccessiAuthResultLike>(
  res: Pick<Response, 'append'>,
  config: ResolvedAccessiAuthCookieOptions | undefined,
  result: T,
): T {
  if (!config) return result;
  setAccessiAuthCookies(res, config, {
    access: accessiTokenValue(result.token),
    refresh: accessiTokenValue(result.refreshToken),
  });
  hideAccessiLoginTokens(config, result);
  return result;
}

/** Rimuove i token dal `LoginResult` quando la modalita cookie li nasconde. */
export function hideAccessiLoginTokens(
  config: ResolvedAccessiAuthCookieOptions | undefined,
  result: { token?: unknown; refreshToken?: unknown },
): void {
  if (!config || config.exposeTokens) return;
  delete result.token;
  delete result.refreshToken;
}

/** Legge l'access token dal cookie (per test e per host senza middleware). */
export function getAccessiAccessTokenFromCookie(
  header: string | undefined,
  config: ResolvedAccessiAuthCookieOptions,
): string | undefined {
  return parseAccessiCookieHeader(header)[config.accessTokenName];
}

/** Legge il refresh token dal cookie. */
export function getAccessiRefreshTokenFromCookie(
  header: string | undefined,
  config: ResolvedAccessiAuthCookieOptions,
): string | undefined {
  return parseAccessiCookieHeader(header)[config.refreshTokenName];
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function csrfError(res: Response): void {
  res.status(403).json({
    severity: 'error',
    status: 403,
    statusCode: 2,
    code: 'AUTH_CSRF_INVALID',
    error: 'AUTH_CSRF_INVALID',
    message: 'Token CSRF mancante o non valido.',
  });
}

/**
 * Middleware della modalita cookie.
 *
 * - copia l'access token dal cookie nell'header `Authorization`, cosi guard,
 *   middleware e controller esistenti funzionano senza modifiche;
 * - garantisce un cookie CSRF double-submit leggibile dal client;
 * - blocca le richieste autenticate via cookie che modificano stato senza
 *   l'header CSRF, salvo endpoint pubblici di bootstrap della sessione.
 */
export function createAccessiAuthCookieMiddleware(
  options: Pick<AccessiOptions, 'authCookie'>,
  isAccessiRoute: (path: string) => boolean,
): ((req: Request, res: Response, next: NextFunction) => void) | undefined {
  const config = resolveAccessiAuthCookieOptions(options);
  if (!config) return undefined;

  return (req: Request, res: Response, next: NextFunction): void => {
    if (!isAccessiRoute(req.path)) {
      next();
      return;
    }

    const cookies = parseAccessiCookieHeader(req.headers.cookie);
    let csrfToken = cookies[config.csrfTokenName];
    if (!csrfToken && config.csrf === 'double-submit') {
      csrfToken = randomBytes(32).toString('base64url');
      appendCookie(res, serializeCookie(config.csrfTokenName, csrfToken, {
        path: config.csrfPath,
        httpOnly: false,
        secure: config.secure,
        sameSite: config.sameSite,
        ...(config.domain ? { domain: config.domain } : {}),
      }));
    }
    if (config.csrf === 'double-submit' && csrfToken) {
      // Rende il token leggibile anche a una SPA su altra origine (via CORS,
      // con `Access-Control-Expose-Headers: X-CSRF-Token`).
      res.setHeader('X-CSRF-Token', csrfToken);
    }

    const accessToken = cookies[config.accessTokenName];
    const hasAuthorization = typeof req.headers.authorization === 'string'
      && req.headers.authorization.trim() !== '';
    if (accessToken && !hasAuthorization) {
      req.headers.authorization = `Bearer ${accessToken}`;

      if (
        config.csrf === 'double-submit'
        && isAccessiUnsafeMethod(req.method)
        && !isAccessiCsrfExemptPath(req.path)
      ) {
        const headerValue = req.headers[config.csrfHeaderName];
        const provided = Array.isArray(headerValue) ? headerValue[0] : headerValue;
        if (!csrfToken || !provided || !safeEqual(provided, csrfToken)) {
          csrfError(res);
          return;
        }
      }
    }

    next();
  };
}

/** True se il nome cookie e valido per l'header `Set-Cookie`. */
export function isValidAccessiCookieName(name: string): boolean {
  return COOKIE_NAME.test(name);
}

/** Helpers per le combinazioni di cookie supportate (usati dalla validazione). */
export function accessiCookieNames(config: ResolvedAccessiAuthCookieOptions): string[] {
  return [config.accessTokenName, config.refreshTokenName, config.csrfTokenName];
}
