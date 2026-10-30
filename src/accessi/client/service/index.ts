/**
 * Client per le API service-to-service di Accessi: gestione dei service token
 * (creazione, rotazione, revoca, elenco) e introspezione degli access token.
 *
 * Pensato per backend fratelli e job: non va distribuito a frontend pubblici.
 */
import * as generated from '../generated/service';
import type { AccessiClientConfig } from '../../../accessi-module/Console/accessiFetch';
import {
  createAccessiClientFromModule,
  type AccessiScopedClient,
} from '../createAccessiClient';

export * from '../generated/service';
export * from '../../../accessi-module/Console/generated/model';
export { AccessiRequestError } from '../../../accessi-module/Console/accessiFetch';
export type { AccessiClientConfig } from '../../../accessi-module/Console/accessiFetch';

/** Client service-to-service con configurazione isolata per istanza. */
export type AccessiServiceClient = AccessiScopedClient<typeof generated>;

/** Crea un client delle API service-to-service, con base URL e token propri. */
export function createAccessiServiceClient(
  config: AccessiClientConfig = {},
): AccessiServiceClient {
  return createAccessiClientFromModule(generated, config);
}
