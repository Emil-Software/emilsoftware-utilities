/**
 * Client per le API amministrative di Accessi: utenti, ruoli, menu, scope,
 * filtri, configurazione console, provider federati e schema.
 *
 * Richiede un token con privilegi admin. Per login e reset password usare
 * `accessi/client/public`.
 */
import * as generated from '../generated/admin';
import type { AccessiClientConfig } from '../../../accessi-module/console/accessiFetch';
import {
  createAccessiClientFromModule,
  type AccessiScopedClient,
} from '../createAccessiClient';

export * from '../generated/admin';
export * from '../../../accessi-module/console/generated/model';
export { AccessiRequestError } from '../../../accessi-module/console/accessiFetch';
export type { AccessiClientConfig } from '../../../accessi-module/console/accessiFetch';

/** Client admin con configurazione isolata per istanza. */
export type AccessiAdminClient = AccessiScopedClient<typeof generated>;

/** Crea un client delle sole API amministrative, con base URL e token propri. */
export function createAccessiAdminClient(
  config: AccessiClientConfig = {},
): AccessiAdminClient {
  return createAccessiClientFromModule(generated, config);
}
