let accessToken: string | null = null;
let baseUrl: string | null = null;
let tokenProvider: (() => string | null | Promise<string | null>) | null = null;
let scopedConfig: AccessiClientConfig | null = null;

/**
 * Configurazione di un client Accessi.
 *
 * Usata sia dalla configurazione globale (`configureAccessiClient`) sia dalle
 * istanze isolate create con `createAccessiClient`.
 */
export interface AccessiClientConfig {
  /** Base URL di Accessi Service, es. `https://accessi.example.com`. */
  baseUrl?: string | null;
  /** Token statico. Preferire `getToken` per token che cambiano nel tempo. */
  token?: string | null;
  /** Provider asincrono/sincrono del token corrente. */
  getToken?: () => string | null | Promise<string | null>;
}

declare global {
  interface Window {
    __ACCESSI_API_BASE_URL__?: string;
    /** La console e servita in modalita cookie httpOnly. */
    __ACCESSI_AUTH_COOKIE__?: boolean;
    __ACCESSI_CSRF_COOKIE_NAME__?: string;
    __ACCESSI_CSRF_HEADER_NAME__?: string;
  }
}

const loadingEventName = 'accessi-console-network';
/** Emesso quando una richiesta autenticata riceve 401: la console deve riportare al login. */
export const ACCESSI_UNAUTHORIZED_EVENT = 'accessi-console-unauthorized';

/** Errore del client console: conserva status, codice stabile Accessi e dettagli di validazione. */
export class AccessiRequestError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string, readonly details?: string[]) {
    super(message);
    this.name = 'AccessiRequestError';
  }
}

/** Notifies the browser shell without coupling generated Orval calls to the UI implementation. */
function notifyNetworkActivity(active: boolean): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(loadingEventName, { detail: { active } }));
  }
}

/** Imposta il JWT usato da tutte le funzioni generate da Orval. */
export function setAccessiConsoleToken(token: string | null): void {
  accessToken = token;
}

/** Prefissa le chiamate relative del client generato (es. `https://accessi.example.com`). */
export function setAccessiFetchBaseUrl(url: string | null): void {
  baseUrl = url ? url.replace(/\/+$/, '') : null;
}

/** Token provider per client esterni alla console (server-to-server o frontend). */
export function setAccessiFetchTokenProvider(
  provider: (() => string | null | Promise<string | null>) | null,
): void {
  tokenProvider = provider;
}

/** Configurazione isolata attiva in questo momento, se una chiamata e in corso. */
export function getAccessiClientConfig(): AccessiClientConfig | null {
  return scopedConfig;
}

/**
 * Esegue `callback` con una configurazione del client isolata.
 *
 * Le funzioni generate da Orval invocano il trasporto in modo sincrono, quindi
 * la configurazione viene letta all'inizio della richiesta: due client diversi
 * possono chiamare in concorrenza senza sovrascriversi a vicenda.
 *
 * Per un uso continuativo preferire `createAccessiClient`, che applica il
 * contesto a ogni metodo.
 */
export function runWithAccessiClient<T>(config: AccessiClientConfig, callback: () => T): T {
  const previous = scopedConfig;
  scopedConfig = config;
  try {
    return callback();
  } finally {
    scopedConfig = previous;
  }
}

/** Legge una stringa non vuota dal payload di errore Accessi, ignorando tipi inattesi. */
function payloadString(payload: unknown, key: string): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Legge un cookie non httpOnly (token CSRF double-submit). */
function readBrowserCookie(name: string): string | null {
  if (typeof document === 'undefined' || !document.cookie) return null;
  for (const part of document.cookie.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return part.slice(separator + 1).trim();
    }
  }
  return null;
}

function isCookieAuthMode(): boolean {
  return typeof window !== 'undefined' && window.__ACCESSI_AUTH_COOKIE__ === true;
}

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Trasporto comune del client Orval: aggiunge il Bearer token e converte le
 * risposte di errore Accessi in Error JavaScript leggibili dalla console.
 *
 * In modalita cookie non richiede un token in memoria: invia i cookie
 * same-origin/cross-origin e l'header CSRF double-submit.
 */
export async function accessiFetch<T>(url: string, options: RequestInit): Promise<T> {
  // Il contesto va letto prima di ogni await: la funzione generata invoca il
  // trasporto in modo sincrono, quindi la configurazione appartiene a questa call.
  const config = scopedConfig;
  const cookieMode = isCookieAuthMode();
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');
  if (options.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (cookieMode) {
    const method = (options.method ?? 'GET').toUpperCase();
    if (UNSAFE_METHODS.has(method)) {
      const csrfCookie = window.__ACCESSI_CSRF_COOKIE_NAME__ ?? 'accessi_csrf';
      const csrfHeader = window.__ACCESSI_CSRF_HEADER_NAME__ ?? 'x-csrf-token';
      const csrfToken = readBrowserCookie(csrfCookie);
      if (csrfToken) headers.set(csrfHeader, csrfToken);
    }
  }
  const resolvedToken = config
    ? (config.getToken ? await config.getToken() : config.token ?? null)
    : tokenProvider
      ? await tokenProvider()
      : accessToken;
  const isAuthEntryRequest = /\/(?:auth\/(?:login|refresh|two-factor\/(?:verify|resend))|console\/entry\/exchange)\b/.test(url);
  const authenticatedRequest = !isAuthEntryRequest && (cookieMode || (resolvedToken !== null && resolvedToken !== undefined));
  if (resolvedToken) headers.set('Authorization', `Bearer ${resolvedToken}`);
  const runtimeBaseUrl = config?.baseUrl !== undefined
    ? config.baseUrl
    : baseUrl ?? (typeof window !== 'undefined' ? window.__ACCESSI_API_BASE_URL__ ?? null : null);
  const requestUrl = runtimeBaseUrl && url.startsWith('/')
    ? `${runtimeBaseUrl.replace(/\/+$/, '')}${url}`
    : url;

  notifyNetworkActivity(true);
  try {
    const response = await fetch(requestUrl, {
      ...options,
      headers,
      ...(cookieMode ? { credentials: 'include' as const } : {}),
    });
    const payload = await response.json().catch(() => undefined);
    if (!response.ok) {
      const message = payloadString(payload, 'message') ?? payloadString(payload, 'error') ?? `Errore HTTP ${response.status}`;
      const rawDetails = payload && typeof payload === 'object' ? (payload as { details?: unknown }).details : undefined;
      const details = Array.isArray(rawDetails) ? rawDetails.map((item) => String(item)) : undefined;
      // Un 401 su una richiesta autenticata significa sessione scaduta/revocata: il token non e piu valido.
      if (response.status === 401 && authenticatedRequest && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(ACCESSI_UNAUTHORIZED_EVENT));
      }
      throw new AccessiRequestError(message, response.status, payloadString(payload, 'code') ?? payloadString(payload, 'error'), details);
    }
    return {
      data: payload,
      status: response.status,
      headers: response.headers,
    } as T;
  } finally {
    notifyNetworkActivity(false);
  }
}
