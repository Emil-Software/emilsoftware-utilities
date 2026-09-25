import { createHash } from 'crypto';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { extname, join, relative, resolve, sep } from 'path';
import { Orm } from '../../Orm';
import { Logger } from '../../Logger';
import type { AccessiOptions, CatalogScriptChecksumPolicy, CatalogScriptsOptions } from '../AccessiModule';

export interface CatalogScriptMigration {
  name: string;
  applied: boolean;
  skipped: boolean;
  reapplied: boolean;
  error?: string;
}

export interface CatalogMigrationReport {
  folder: string;
  discovered: number;
  applied: string[];
  skipped: string[];
  failed: { script: string; error: string }[];
}

/** Ritorna la policy di checksum effettiva (default `error`). */
function checksumPolicy(options: CatalogScriptsOptions): CatalogScriptChecksumPolicy {
  return options.onChecksumMismatch ?? 'error';
}

/** Hash SHA-256 del contenuto dello script, usato per rilevare modifiche non versionate. */
export function computeCatalogScriptChecksum(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Divide un file SQL in statement eseguibili separatamente.
 *
 * Supporta:
 * - terminator personalizzati con `SET TERM <char>` / `SET TERM <char> ;`
 * - stringhe `'...'` con escape `''`
 * - commenti di riga `--` e di blocco `/* ... * /`
 *
 * Non interpreta la semantica SQL: e volutamente un tokenizer prudente che non spezza
 * mai all'interno di stringhe o commenti.
 */
export function splitSqlStatements(sql: string, defaultTerminator = ';'): string[] {
  const statements: string[] = [];
  const lines = sql.replace(/\r\n?/g, '\n').split('\n');
  let buffer = '';
  let terminator = defaultTerminator;
  let inString = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (const line of lines) {
    const setTerm = /^\s*SET\s+TERM\s+(\S+)/i.exec(line);
    if (setTerm && !inString && !inLineComment && !inBlockComment) {
      const raw = setTerm[1] ?? '';
      terminator = raw.length > 1 && raw.endsWith(';') ? raw.slice(0, -1) : raw || defaultTerminator;
      continue;
    }

    buffer += `${line}\n`;

    let start = 0;
    let index = 0;
    while (index < buffer.length) {
      const char = buffer[index] as string;
      const next = buffer[index + 1];

      if (inLineComment) {
        if (char === '\n') inLineComment = false;
        index += 1;
        continue;
      }
      if (inBlockComment) {
        if (char === '*' && next === '/') {
          inBlockComment = false;
          index += 2;
          continue;
        }
        index += 1;
        continue;
      }
      if (inString) {
        if (char === "'") {
          if (next === "'") {
            index += 2;
            continue;
          }
          inString = false;
        }
        index += 1;
        continue;
      }

      if (char === "'") {
        inString = true;
        index += 1;
        continue;
      }
      if (char === '-' && next === '-') {
        inLineComment = true;
        index += 2;
        continue;
      }
      if (char === '/' && next === '*') {
        inBlockComment = true;
        index += 2;
        continue;
      }
      if (buffer.startsWith(terminator, index)) {
        const statement = buffer.slice(start, index).trim();
        if (statement) statements.push(statement);
        index += terminator.length;
        start = index;
        continue;
      }
      index += 1;
    }

    buffer = buffer.slice(start);
  }

  const trailing = buffer.trim();
  if (trailing) statements.push(trailing);
  return statements;
}

/** Elenca gli script `.sql` della cartella, ordinati per percorso (prefissi numerici consigliati). */
export function discoverCatalogScripts(options: CatalogScriptsOptions): { name: string; path: string }[] {
  const folder = resolve(options.folder);
  if (!existsSync(folder)) {
    throw new Error(`AccessiCatalogMigrator: cartella non trovata: ${folder}`);
  }

  const include = options.include && options.include.length > 0 ? options.include : ['.sql'];
  const found: { name: string; path: string }[] = [];

  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      const matches = include.some((pattern) =>
        pattern.startsWith('.') ? extname(entry.name).toLowerCase() === pattern.toLowerCase() : entry.name.includes(pattern),
      );
      if (!matches) continue;
      const name = relative(folder, absolute).split(sep).join('/');
      found.push({ name, path: absolute });
    }
  };

  walk(folder);
  return found.sort((a, b) => a.name.localeCompare(b.name));
}

function isLedgerPresent(options: AccessiOptions): Promise<boolean> {
  return Orm.query(
    options.databaseOptions,
    "SELECT 1 FROM RDB$RELATIONS WHERE TRIM(RDB$RELATION_NAME) = 'ACCESSI_CATALOG_SCRIPT'",
    [],
    false,
  ).then((rows) => rows.length > 0);
}

/** Legge il ledger come mappa `script -> checksum`. */
async function readLedger(options: AccessiOptions): Promise<Map<string, string>> {
  const rows = (await Orm.query(
    options.databaseOptions,
    'SELECT SCRIPT_NAME AS NAME, CHECKSUM FROM ACCESSI_CATALOG_SCRIPT',
    [],
    false,
  )) as Array<Record<string, unknown>>;
  const ledger = new Map<string, string>();
  for (const row of rows) {
    const name = String(row.NAME ?? row.name ?? '').trim();
    const checksum = String(row.CHECKSUM ?? row.checksum ?? '').trim();
    if (name) ledger.set(name, checksum);
  }
  return ledger;
}

async function upsertLedger(options: AccessiOptions, name: string, checksum: string, reapplied: boolean): Promise<void> {
  if (reapplied) {
    await Orm.execute(
      options.databaseOptions,
      'UPDATE ACCESSI_CATALOG_SCRIPT SET CHECKSUM = ?, APPLIED_AT = CURRENT_TIMESTAMP, APPLIED_COUNT = APPLIED_COUNT + 1 WHERE SCRIPT_NAME = ?',
      [checksum, name],
      false,
    );
    return;
  }
  await Orm.execute(
    options.databaseOptions,
    'UPDATE OR INSERT INTO ACCESSI_CATALOG_SCRIPT (SCRIPT_NAME, CHECKSUM, APPLIED_AT, APPLIED_COUNT) VALUES (?, ?, CURRENT_TIMESTAMP, 1) MATCHING (SCRIPT_NAME)',
    [name, checksum],
    false,
  );
}

/** Elenca gli script non ancora applicati (o con checksum diverso) senza eseguirli. */
export async function listPendingCatalogScripts(options: AccessiOptions): Promise<{ applied: string[]; pending: string[]; changed: string[] }> {
  const config = options.catalogScripts;
  if (!config?.folder) throw new Error('AccessiCatalogMigrator: catalogScripts.folder non configurato.');
  if (!(await isLedgerPresent(options))) {
    throw new Error('AccessiCatalogMigrator: tabella ACCESSI_CATALOG_SCRIPT assente. Eseguire prima AccessiDatabaseUpdater.run (db:update:accessi).');
  }

  const ledger = await readLedger(options);
  const discovered = discoverCatalogScripts(config);
  const pending: string[] = [];
  const changed: string[] = [];

  for (const script of discovered) {
    const checksum = computeCatalogScriptChecksum(readFileSync(script.path, 'utf8'));
    const appliedChecksum = ledger.get(script.name);
    if (appliedChecksum === undefined) pending.push(script.name);
    else if (appliedChecksum !== checksum) changed.push(script.name);
  }

  return { applied: [...ledger.keys()].sort(), pending, changed };
}

/**
 * Applica le catalog migrations presenti nella cartella configurata.
 *
 * Idempotenza:
 * - uno script gia presente nel ledger con lo stesso checksum viene saltato;
 * - uno script gia applicato ma modificato segue `onChecksumMismatch` (`error` default, `warn`, `reapply`);
 * - un errore interrompe il run (default) senza avanzare, lasciando il ledger all'ultimo script completato.
 *
 * Il chiamante deve avere gia riconciliato lo schema (`AccessiDatabaseUpdater.run`): la tabella
 * ledger `ACCESSI_CATALOG_SCRIPT` e creata dall'updater.
 */
export async function applyCatalogScripts(options: AccessiOptions): Promise<CatalogMigrationReport> {
  const logger = new Logger(AccessiCatalogMigrator.name);
  const config = options.catalogScripts;
  if (!config?.folder) throw new Error('AccessiCatalogMigrator: catalogScripts.folder non configurato.');
  if (!(await isLedgerPresent(options))) {
    throw new Error('AccessiCatalogMigrator: tabella ACCESSI_CATALOG_SCRIPT assente. Eseguire prima AccessiDatabaseUpdater.run (db:update:accessi).');
  }

  const folder = resolve(config.folder);
  const discovered = discoverCatalogScripts(config);
  const ledger = await readLedger(options);
  const stopOnError = config.stopOnError !== false;
  const maxScripts = Number.isInteger(config.maxScriptsPerRun) && (config.maxScriptsPerRun ?? 0) > 0 ? config.maxScriptsPerRun : undefined;
  const report: CatalogMigrationReport = { folder, discovered: discovered.length, applied: [], skipped: [], failed: [] };

  logger.info(`Catalog migrations: ${discovered.length} script trovati in ${folder}.`);

  for (const script of discovered) {
    if (maxScripts !== undefined && report.applied.length >= maxScripts) {
      logger.warning(`Catalog migrations: limite maxScriptsPerRun=${maxScripts} raggiunto, resto rimandato.`);
      break;
    }

    const content = readFileSync(script.path, 'utf8');
    const checksum = computeCatalogScriptChecksum(content);
    const appliedChecksum = ledger.get(script.name);

    if (appliedChecksum === checksum) {
      report.skipped.push(script.name);
      continue;
    }

    let reapplied = false;
    if (appliedChecksum !== undefined && appliedChecksum !== checksum) {
      const policy = checksumPolicy(config);
      if (policy === 'error') {
        throw new Error(
          `AccessiCatalogMigrator: lo script "${script.name}" e gia applicato con un checksum diverso (migrazioni immutabili). ` +
          `Ripristina il file o configura onChecksumMismatch='reapply'/'warn' consapevolmente.`,
        );
      }
      if (policy === 'warn') {
        logger.warning(`Catalog migrations: "${script.name}" applicato con checksum diverso, ignorato (policy warn).`);
        report.skipped.push(script.name);
        continue;
      }
      reapplied = true;
      logger.warning(`Catalog migrations: "${script.name}" riapplicato (policy reapply).`);
    }

    try {
      const statements = splitSqlStatements(content);
      for (const statement of statements) {
        await Orm.execute(options.databaseOptions, statement, [], false);
      }
      await upsertLedger(options, script.name, checksum, reapplied);
      ledger.set(script.name, checksum);
      report.applied.push(script.name);
      logger.info(`Catalog migration applicata: ${script.name} (${statements.length} statement).`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      report.failed.push({ script: script.name, error: message });
      logger.error(`Catalog migration fallita: ${script.name}. ${message}`);
      if (stopOnError) {
        throw new Error(`AccessiCatalogMigrator: script "${script.name}" fallito. ${message}`);
      }
    }
  }

  return report;
}

/** Esegue la riconciliazione dello schema non e responsabilita di questa classe: usare l'updater prima. */
export class AccessiCatalogMigrator {
  static apply(options: AccessiOptions): Promise<CatalogMigrationReport> {
    return applyCatalogScripts(options);
  }

  static listPending(options: AccessiOptions): Promise<{ applied: string[]; pending: string[]; changed: string[] }> {
    return listPendingCatalogScripts(options);
  }
}
