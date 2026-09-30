let accessToken: string | null = null;

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

/** Legge una stringa non vuota dal payload di errore Accessi, ignorando tipi inattesi. */
function payloadString(payload: unknown, key: string): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const value = (payload as Record<string, unknown>)[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Trasporto comune del client Orval: aggiunge il Bearer token e converte le
 * risposte di errore Accessi in Error JavaScript leggibili dalla console.
 */
export async function accessiFetch<T>(url: string, options: RequestInit): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');
  if (options.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const authenticatedRequest = accessToken !== null;
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);

  notifyNetworkActivity(true);
  try {
    const response = await fetch(url, { ...options, headers });
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
