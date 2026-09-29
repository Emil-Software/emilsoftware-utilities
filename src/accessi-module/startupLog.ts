import { Logger } from '../Logger';
import type { AccessiOptions } from './AccessiModule';
import { getOrCreateAdminBootstrapToken } from './security/adminBootstrap';

/**
 * Logga gli indirizzi utili del modulo Accessi appena il bootstrap e completato, cosi che
 * console, swagger e API siano visibili insieme nei log di avvio.
 */
export function logAccessiStartup(options: AccessiOptions): void {
  const logger = new Logger('Accessi');
  const base = (options.publicBaseUrl ?? '').replace(/\/+$/, '');
  const url = (path: string) => `${base}${path}`;

  logger.info('Accessi pronto. Indirizzi utili:');
  logger.info(`  Console:      ${url('/api/accessi/console')}`);
  logger.info(`  Swagger UI:   ${url('/accessi/swagger')}`);
  logger.info(`  Swagger JSON: ${url('/accessi/swagger.json')}`);
  logger.info(`  API:          ${url('/api/accessi')}`);

  if (options.adminBootstrap?.enabled === true) {
    const token = getOrCreateAdminBootstrapToken();
    logger.warning(`  Bootstrap admin abilitato. Token di avvio (monouso, valido fino al riavvio): ${token}`);
  }
}
