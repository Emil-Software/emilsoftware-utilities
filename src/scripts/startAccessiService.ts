import { startAccessiService } from '../accessi/server';
import { Logger } from '../Logger';

startAccessiService().catch((error: unknown) => {
  new Logger('startAccessiService').error(
    'Avvio Accessi Service fallito:',
    error instanceof Error
      ? { name: error.name, message: error.message, stack: error.stack }
      : { error: String(error) },
  );
  process.exitCode = 1;
});
