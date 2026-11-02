import { AccessiDatabaseUpdater } from "./AccessiDatabaseUpdater";
import { applyCatalogScripts, listPendingCatalogScripts } from "./AccessiCatalogMigrator";
import { createAccessiOptionsFromEnv } from "./accessiOptionsFromEnv";
import { Orm } from "../../Orm";

async function main(): Promise<void> {
  const options = createAccessiOptionsFromEnv();
  if (!options.catalogScripts?.folder) {
    throw new Error("Variabile ambiente mancante: ACCESSI_CATALOG_FOLDER (cartella delle catalog migrations).");
  }

  const checkOnly = process.argv.includes('--check');
  console.log(`[Accessi Catalog] Target: ${options.databaseOptions.host}:${options.databaseOptions.port} -> ${options.databaseOptions.database}`);
  console.log(`[Accessi Catalog] Cartella: ${options.catalogScripts.folder}`);

  // Prima lo schema si adegua, poi si eseguono gli script di catalogo.
  if (!checkOnly) {
    console.log('[Accessi Catalog] Riconciliazione schema...');
    await AccessiDatabaseUpdater.run(options);
  }

  if (checkOnly) {
    const pending = await listPendingCatalogScripts(options);
    console.log(`[Accessi Catalog] Gia applicati: ${pending.applied.length}`);
    console.log(`[Accessi Catalog] Da applicare: ${pending.pending.length}${pending.pending.length ? ` -> ${pending.pending.join(', ')}` : ''}`);
    console.log(`[Accessi Catalog] Modificati (checksum diverso): ${pending.changed.length}${pending.changed.length ? ` -> ${pending.changed.join(', ')}` : ''}`);
    console.log(`[Accessi Catalog] Non conformi (solo DML): ${pending.invalid.length}`);
    for (const entry of pending.invalid) {
      for (const violation of entry.violations) console.error(`[Accessi Catalog] Non conforme: ${entry.script} -> ${violation}`);
    }
    if (pending.invalid.length) process.exitCode = 1;
    return;
  }

  const report = await applyCatalogScripts(options);
  console.log(`[Accessi Catalog] Scoperti: ${report.discovered} | Applicati: ${report.applied.length} | Saltati: ${report.skipped.length} | Non conformi: ${report.invalid.length} | Falliti: ${report.failed.length}`);
  if (report.applied.length) console.log(`[Accessi Catalog] Applicati: ${report.applied.join(', ')}`);
  for (const entry of report.invalid) {
    for (const violation of entry.violations) console.error(`[Accessi Catalog] Non conforme: ${entry.script} -> ${violation}`);
  }
  if (report.failed.length) {
    for (const failure of report.failed) console.error(`[Accessi Catalog] Fallito: ${failure.script} -> ${failure.error}`);
  }
  if (report.failed.length || report.invalid.length) process.exitCode = 1;
}

main()
  .then(() => Orm.closePools())
  .then(() => process.exit(process.exitCode ?? 0))
  .catch(async (error) => {
    console.error("[Accessi Catalog] Errore durante l'esecuzione:", error);
    await Orm.closePools().catch(() => undefined);
    process.exit(1);
  });
