import { startAccessiService } from '../accessi/server';
import { Logger } from '../Logger';
import { Orm } from '../Orm';

startAccessiService().catch(async (error: unknown) => {
  new Logger('startAccessiService').error(
    'Avvio Accessi Service fallito:',
    error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack }
      : { error: String(error) },
  );
  await Orm.closePools().catch(() => undefined);
  // Nessun listener deve restare attivo dopo un preflight rifiutato o fallito.
  process.exit(1);
});
