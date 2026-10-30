/**
 * Client HTTP generato dal contratto OpenAPI di Accessi.
 *
 * Il client e pensato per essere usato da backend fratelli, frontend e tool
 * amministrativi. Configurare base URL e token provider prima della prima call.
 *
 * Per limitare le operazioni disponibili usare gli entry point per scope:
 * `accessi/client/public`, `accessi/client/admin` e `accessi/client/service`.
 */
import * as generated from "../../accessi-module/Console/generated/emilsoftware-utilities";
import type { AccessiClientConfig } from "../../accessi-module/Console/accessiFetch";
import {
  createAccessiClientFromModule,
  type AccessiScopedClient,
} from "./createAccessiClient";

export * from "../../accessi-module/Console/generated/emilsoftware-utilities";
export * from "../../accessi-module/Console/generated/model";
export { AccessiRequestError } from "../../accessi-module/Console/accessiFetch";
export {
  ACCESSI_UNAUTHORIZED_EVENT,
  getAccessiClientConfig,
  runWithAccessiClient,
  setAccessiFetchBaseUrl,
  setAccessiFetchTokenProvider,
} from "../../accessi-module/Console/accessiFetch";
export type { AccessiClientConfig } from "../../accessi-module/Console/accessiFetch";

import {
  setAccessiFetchBaseUrl,
  setAccessiFetchTokenProvider,
} from "../../accessi-module/Console/accessiFetch";

/** Client completo: tutte le operazioni, con configurazione isolata per istanza. */
export type AccessiClient = AccessiScopedClient<typeof generated>;

/**
 * Configura il trasporto del client generato globale.
 *
 * Uso tipico backend: `configureAccessiClient({ baseUrl, getToken })`.
 * Uso tipico frontend: `configureAccessiClient({ baseUrl, token })` dopo il login.
 *
 * Per usare piu Accessi Service (o tenant) nello stesso processo preferire
 * `createAccessiClient`: la configurazione globale resta il default per le
 * chiamate agli export del package.
 */
export function configureAccessiClient(config: AccessiClientConfig = {}): void {
  setAccessiFetchBaseUrl(config.baseUrl ?? null);
  if (config.getToken) {
    setAccessiFetchTokenProvider(config.getToken);
    return;
  }
  setAccessiFetchTokenProvider(() => config.token ?? null);
}

/**
 * Crea un client isolato con la propria base URL e il proprio token.
 *
 * Le istanze possono essere usate in concorrenza: la configurazione viene
 * applicata alla singola chiamata, quindi due client con base URL o token
 * diversi non si sovrascrivono.
 *
 * ```ts
 * const milano = createAccessiClient({ baseUrl: 'https://accessi-milano.example.com', getToken });
 * const roma = createAccessiClient({ baseUrl: 'https://accessi-roma.example.com', token });
 * const [utentiMilano, utentiRoma] = await Promise.all([milano.getUsers(), roma.getUsers()]);
 * ```
 */
export function createAccessiClient(config: AccessiClientConfig = {}): AccessiClient {
  return createAccessiClientFromModule(generated, config);
}
