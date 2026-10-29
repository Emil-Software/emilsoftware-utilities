/** Path standard della console amministrativa Accessi. */
export const ACCESSI_CONSOLE_PATH = "/api/accessi/console";

export interface AccessiConsoleUrlOptions {
  /** Ticket monouso ottenuto da `POST /api/accessi/console/entry`. */
  entryTicket?: string;
  /** Challenge 2FA da completare sulla console. */
  twoFactorChallengeId?: string;
}

/**
 * Costruisce l'URL della console centrale.
 *
 * Il base URL e quello di Accessi Service (es. `https://accessi.example.com`).
 * Il JWT non passa mai nell'URL: usare `entryTicket` o il flusso 2FA.
 */
export function buildAccessiConsoleUrl(
  baseUrl: string,
  options: AccessiConsoleUrlOptions = {},
): string {
  const base = baseUrl.replace(/\/+$/, "");
  const url = new URL(`${base}${ACCESSI_CONSOLE_PATH}`);
  const fragment = options.entryTicket
    ? `entry=${encodeURIComponent(options.entryTicket)}`
    : options.twoFactorChallengeId
      ? `two-factor=${encodeURIComponent(options.twoFactorChallengeId)}`
      : "";
  if (fragment) url.hash = fragment;
  return url.toString();
}
