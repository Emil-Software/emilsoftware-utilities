/**
 * Client HTTP generato dal contratto OpenAPI di Accessi.
 *
 * Il client e pensato per essere usato da backend fratelli, frontend e tool
 * amministrativi. Configurare base URL e token provider prima della prima call.
 */
export * from "../../accessi-module/Console/generated/emilsoftware-utilities";
export * from "../../accessi-module/Console/generated/model";
export { AccessiRequestError } from "../../accessi-module/Console/accessiFetch";
export {
  ACCESSI_UNAUTHORIZED_EVENT,
  setAccessiFetchBaseUrl,
  setAccessiFetchTokenProvider,
} from "../../accessi-module/Console/accessiFetch";

import {
  setAccessiFetchBaseUrl,
  setAccessiFetchTokenProvider,
} from "../../accessi-module/Console/accessiFetch";

/** Configurazione globale del client. */
export interface AccessiClientConfig {
  /** Base URL di Accessi Service, es. `https://accessi.example.com`. */
  baseUrl?: string | null;
  /** Token statico. Preferire `getToken` per token che cambiano nel tempo. */
  token?: string | null;
  /** Provider asincrono/sincrono del token corrente. */
  getToken?: () => string | null | Promise<string | null>;
}

/**
 * Configura il trasporto del client generato.
 *
 * Uso tipico backend: `configureAccessiClient({ baseUrl, getToken })`.
 * Uso tipico frontend: `configureAccessiClient({ baseUrl, token })` dopo il login.
 */
export function configureAccessiClient(config: AccessiClientConfig = {}): void {
  setAccessiFetchBaseUrl(config.baseUrl ?? null);
  if (config.getToken) {
    setAccessiFetchTokenProvider(config.getToken);
    return;
  }
  setAccessiFetchTokenProvider(() => config.token ?? null);
}
