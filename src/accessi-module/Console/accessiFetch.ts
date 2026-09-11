let accessToken: string | null = null;

const loadingEventName = 'accessi-console-network';

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
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);

  notifyNetworkActivity(true);
  try {
    const response = await fetch(url, { ...options, headers });
    const payload = await response.json().catch(() => undefined);
    if (!response.ok) {
      const message = payload?.message ?? payload?.error ?? `Errore HTTP ${response.status}`;
      throw new Error(message);
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
