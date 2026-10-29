import { Logger } from '../Logger';
import type { AccessiOptions } from './AccessiModule';
import { getOrCreateAdminBootstrapToken } from './security/adminBootstrap';
import { resolveAccessiOpenApiOptions } from '../openapi/OpenApiConfig';
import type { ResolvedOpenApiSetupOptions } from '../openapi/OpenApiConfig';

/**
 * Logga gli indirizzi utili del modulo Accessi appena il bootstrap e completato, cosi che
 * console, OpenAPI e API siano visibili insieme nei log di avvio.
 */
export function logAccessiStartup(
  options: AccessiOptions,
  openApiOverride?: ResolvedOpenApiSetupOptions
): void {
  const logger = new Logger('Accessi');
  const base = (options.publicBaseUrl ?? '').replace(/\/+$/, '');
  const url = (path: string) => `${base}${path}`;
  const openApi = openApiOverride ?? resolveAccessiOpenApiOptions(options.openapi);

  logger.info('Accessi pronto. Indirizzi utili:');
  logger.info(`  Console:      ${url('/api/accessi/console')}`);
  if (openApi.enabled) {
    logger.info(`  OpenAPI UI:   ${url(`/${openApi.openApiPath}`)}`);
    logger.info(`  OpenAPI JSON: ${url(`/${openApi.openApiJsonPath}`)}`);
  }
  logger.info(`  API:          ${url('/api/accessi')}`);

  if (options.adminBootstrap?.enabled === true) {
    const token = getOrCreateAdminBootstrapToken();
    logger.warning(`  Bootstrap admin abilitato. Token di avvio (monouso, valido fino al riavvio): ${token}`);
  }
}
