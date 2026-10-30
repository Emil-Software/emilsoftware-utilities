import { startAccessiService, loadAccessiTenantEnvironmentFile } from '../accessi/server';
import { Logger } from '../Logger';

/**
 * Avvia Accessi per un singolo tenant.
 *
 * `ACCESSI_TENANT_ENVIRONMENT` punta al file `*.environment.ts`; `PORT` e la
 * porta interna assegnata dal supervisore o dal proxy.
 */
const logger = new Logger('startAccessiTenantService');
const environmentFile = process.env.ACCESSI_TENANT_ENVIRONMENT;

if (!environmentFile) {
  logger.error('ACCESSI_TENANT_ENVIRONMENT non impostata.');
  process.exitCode = 1;
} else {
  try {
    const { tenant } = loadAccessiTenantEnvironmentFile(environmentFile);
    const port = Number(process.env.PORT ?? tenant.port ?? 3200);
    logger.info(`Avvio tenant ${tenant.id} sulla porta ${port}.`);
    void startAccessiService({ accessiOptions: tenant.options, port }).catch((error: unknown) => {
      logger.error(
        `Avvio tenant ${tenant.id} fallito:`,
        error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : { error: String(error) },
      );
      process.exitCode = 1;
    });
  } catch (error) {
    logger.error(
      'Configurazione tenant non valida:',
      error instanceof Error ? { message: error.message } : { error: String(error) },
    );
    process.exitCode = 1;
  }
}
