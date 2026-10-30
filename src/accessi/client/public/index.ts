/**
 * Client per le API pubbliche di Accessi: login, refresh, 2FA, reset password,
 * registrazione pubblica e scambio ticket console.
 *
 * Non include le operazioni amministrative (utenti, ruoli, menu, schema, filtri,
 * service token). Per quelle usare `accessi/client/admin`.
 */
import * as generated from '../generated/public';
import type { AccessiClientConfig } from '../../../accessi-module/Console/accessiFetch';
import {
  createAccessiClientFromModule,
  type AccessiScopedClient,
} from '../createAccessiClient';

export * from '../generated/public';
export * from '../../../accessi-module/Console/generated/model';
export { AccessiRequestError } from '../../../accessi-module/Console/accessiFetch';
export type { AccessiClientConfig } from '../../../accessi-module/Console/accessiFetch';

/** Client pubblico con configurazione isolata per istanza. */
export type AccessiPublicClient = AccessiScopedClient<typeof generated>;

/** Crea un client delle sole API pubbliche, con base URL e token propri. */
export function createAccessiPublicClient(
  config: AccessiClientConfig = {},
): AccessiPublicClient {
  return createAccessiClientFromModule(generated, config);
}
