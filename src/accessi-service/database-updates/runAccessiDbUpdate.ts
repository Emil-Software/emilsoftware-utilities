import { AccessiDatabaseUpdater } from "./AccessiDatabaseUpdater";
import { createAccessiOptionsFromEnv } from "./accessiOptionsFromEnv";
import { Orm } from "../../Orm";

async function main(): Promise<void> {
  const options = createAccessiOptionsFromEnv();

  const checkOnly = process.argv.includes('--check');
  console.log(checkOnly ? '[Accessi DB Update] Verifica schema in sola lettura...' : '[Accessi DB Update] Avvio aggiornamento database...');
  console.log(
    `[Accessi DB Update] Target: ${options.databaseOptions.host}:${options.databaseOptions.port} -> ${options.databaseOptions.database}`
  );

  if (checkOnly) {
    const report = await AccessiDatabaseUpdater.preflight(options);
    if (report.status !== 'ok') {
      const current = report.currentVersion ?? 'non inizializzato';
      throw new Error(
        `Schema Accessi non allineato: corrente ${current}, attesa ${report.expectedVersion}.` +
          (report.issues.length > 0 ? `\n- ${report.issues.join('\n- ')}` : ''),
      );
    }
    console.log(`[Accessi DB Update] Schema e versione OK: ${report.expectedVersion}`);
  } else {
    await AccessiDatabaseUpdater.migrate(options);
  }

  const currentVersion = await AccessiDatabaseUpdater.getCurrentVersion(options);
  console.log(
    `[Accessi DB Update] Completato. Versione corrente: ${currentVersion ?? "N/D"} | Ultima disponibile: ${AccessiDatabaseUpdater.getLatestVersion()}`
  );
}

main()
  .then(() => Orm.closePools())
  .then(() => process.exit(0))
  .catch(async (error) => {
    console.error("[Accessi DB Update] Errore durante l'aggiornamento:", error);
    await Orm.closePools().catch(() => undefined);
    process.exit(1);
  });
