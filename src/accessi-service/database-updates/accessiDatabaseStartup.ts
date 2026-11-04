import type { AccessiOptions } from '../AccessiModule';
import { ACCESSI_SCHEMA_VERSION } from './accessiSchema';

/** Politica applicata quando lo schema Accessi non e alla versione attesa. */
export type AccessiDatabaseMigrationPolicy = 'ask' | 'migrate' | 'fail';

export type AccessiDatabasePreflightStatus = 'ok' | 'outdated' | 'newer';

export type AccessiDatabasePreflightReason =
  | 'none'
  | 'missing'
  | 'older'
  | 'drift'
  | 'invalid'
  | 'newer';

/** Sottoinsieme read-only di `AccessiSchemaReport`, per non creare dipendenze circolari. */
export interface AccessiSchemaInspection {
  compatible: boolean;
  issues: string[];
  warnings: string[];
}

export interface AccessiDatabasePreflightReport {
  status: AccessiDatabasePreflightStatus;
  reason: AccessiDatabasePreflightReason;
  currentVersion: string | null;
  expectedVersion: string;
  issues: string[];
  warnings: string[];
}

export type AccessiDatabaseStartupErrorCode =
  | 'ACCESSI_DATABASE_SCHEMA_OUTDATED'
  | 'ACCESSI_DATABASE_SCHEMA_NEWER'
  | 'ACCESSI_DATABASE_MIGRATION_DECLINED'
  | 'ACCESSI_DATABASE_MIGRATION_FAILED';

/** Errore bloccante del preflight: l'avvio non deve proseguire. */
export class AccessiDatabaseStartupError extends Error {
  constructor(
    message: string,
    readonly code: AccessiDatabaseStartupErrorCode,
    readonly report?: AccessiDatabasePreflightReport,
  ) {
    super(message);
    this.name = 'AccessiDatabaseStartupError';
  }
}

export class AccessiDatabaseSchemaOutdatedError extends AccessiDatabaseStartupError {
  constructor(message: string, report: AccessiDatabasePreflightReport) {
    super(message, 'ACCESSI_DATABASE_SCHEMA_OUTDATED', report);
    this.name = 'AccessiDatabaseSchemaOutdatedError';
  }
}

export class AccessiDatabaseSchemaNewerError extends AccessiDatabaseStartupError {
  constructor(message: string, report: AccessiDatabasePreflightReport) {
    super(message, 'ACCESSI_DATABASE_SCHEMA_NEWER', report);
    this.name = 'AccessiDatabaseSchemaNewerError';
  }
}

export class AccessiDatabaseMigrationDeclinedError extends AccessiDatabaseStartupError {
  constructor(message: string, report: AccessiDatabasePreflightReport) {
    super(message, 'ACCESSI_DATABASE_MIGRATION_DECLINED', report);
    this.name = 'AccessiDatabaseMigrationDeclinedError';
  }
}

export class AccessiDatabaseMigrationFailedError extends AccessiDatabaseStartupError {
  constructor(message: string, report: AccessiDatabasePreflightReport) {
    super(message, 'ACCESSI_DATABASE_MIGRATION_FAILED', report);
    this.name = 'AccessiDatabaseMigrationFailedError';
  }
}

function parseSchemaVersion(value: string): number[] | undefined {
  if (!/^\d+\.\d+\.\d+$/.test(value)) return undefined;
  const parsed = value.split('.').map(Number);
  return parsed.length === 3 && parsed.every((part) => Number.isFinite(part))
    ? parsed
    : undefined;
}

/** Confronta due versioni semver Accessi. `undefined` se una delle due non e valida. */
export function compareAccessiSchemaVersions(
  current: string,
  expected: string,
): number | undefined {
  const left = parseSchemaVersion(current);
  const right = parseSchemaVersion(expected);
  if (!left || !right) return undefined;
  for (let index = 0; index < 3; index += 1) {
    const difference = left[index]! - right[index]!;
    if (difference !== 0) return difference;
  }
  return 0;
}

/** Unisce versione letta e ispezione read-only in un unico esito. */
export function evaluateAccessiDatabasePreflight(
  currentVersion: string | null,
  expectedVersion: string,
  inspection: AccessiSchemaInspection,
): AccessiDatabasePreflightReport {
  const base = {
    currentVersion,
    expectedVersion,
    issues: [...inspection.issues],
    warnings: [...inspection.warnings],
  };

  if (!currentVersion) {
    return { ...base, status: 'outdated', reason: 'missing' };
  }

  const comparison = compareAccessiSchemaVersions(currentVersion, expectedVersion);
  if (comparison === undefined) {
    return {
      ...base,
      status: 'outdated',
      reason: 'invalid',
      issues: [...base.issues, `Versione Accessi non riconosciuta: ${currentVersion}`],
    };
  }
  if (comparison > 0) {
    return { ...base, status: 'newer', reason: 'newer' };
  }
  if (comparison < 0) {
    return { ...base, status: 'outdated', reason: 'older' };
  }
  if (inspection.compatible) {
    return { ...base, status: 'ok', reason: 'none', issues: [], warnings: base.warnings };
  }
  return { ...base, status: 'outdated', reason: 'drift' };
}

/**
 * `autoUpdateDatabase: false` resta una modalita di sola verifica e non puo
 * avviare DDL, indipendentemente dalla policy configurata.
 */
export function resolveAccessiDatabaseMigrationPolicy(
  options: AccessiOptions,
): AccessiDatabaseMigrationPolicy {
  if (options.autoUpdateDatabase === false) return 'fail';
  return options.databaseMigration ?? 'ask';
}

export function formatAccessiDatabaseStatus(report: AccessiDatabasePreflightReport): string {
  const current = report.currentVersion ?? 'non inizializzato';
  const drift = report.reason === 'drift' ? ' (schema non allineato)' : '';
  return `Corrente: ${current}${drift} - Attesa: ${report.expectedVersion}`;
}

/** Testo unico mostrato prima di chiedere SI/NO. */
export function formatAccessiDatabaseMigrationPrompt(
  report: AccessiDatabasePreflightReport,
): string {
  return [
    'Non siamo alla versione corretta di Accessi.',
    formatAccessiDatabaseStatus(report),
    'Vuoi avviare la migrazione? SI - NO',
  ].join('\n');
}

/** Solo una sessione con stdin/stdout TTY puo ricevere la conferma. */
export function isInteractiveAccessiSession(): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

function yes(answer: string): boolean {
  return ['si', 's', 'y', 'yes'].includes(answer);
}

function no(answer: string): boolean {
  return ['no', 'n'].includes(answer);
}

/** Chiede SI/NO su TTY e ripete finche la risposta non e valida. */
export async function askAccessiDatabaseMigration(
  report: AccessiDatabasePreflightReport,
): Promise<boolean> {
  const { createInterface } = await import('node:readline/promises');
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (;;) {
      const answer = (await readline.question(`${formatAccessiDatabaseMigrationPrompt(report)} `))
        .trim()
        .toLowerCase();
      if (yes(answer)) return true;
      if (no(answer)) return false;
      process.stdout.write('Risposta non valida. Digitare SI oppure NO.\n');
    }
  } finally {
    readline.close();
  }
}

function issueBlock(issues: string[]): string {
  return issues.length > 0 ? `\nProblemi rilevati:\n- ${issues.join('\n- ')}` : '';
}

function outdatedMessage(report: AccessiDatabasePreflightReport, suffix: string): string {
  return `Non siamo alla versione corretta di Accessi.\n${formatAccessiDatabaseStatus(report)}\n${suffix}${issueBlock(report.issues)}`;
}

export interface AccessiDatabaseStartupDependencies {
  getVersion(options: AccessiOptions): Promise<string | null>;
  inspect(options: AccessiOptions): Promise<AccessiSchemaInspection>;
  migrate(options: AccessiOptions): Promise<void>;
  prompt?(report: AccessiDatabasePreflightReport): Promise<boolean>;
  isInteractive?(): boolean;
  log?(message: string): void;
}

/**
 * Preflight bloccante eseguito prima del bootstrap Accessi.
 *
 * - schema sano: ritorna subito;
 * - schema piu recente della libreria: non chiede nulla e blocca (downgrade vietato);
 * - schema mancante/vecchio/diforme: applica la policy `ask`/`migrate`/`fail`;
 * - dopo la migrazione ripete il check e pretende un database sano.
 */
export async function ensureAccessiDatabase(
  options: AccessiOptions,
  dependencies: AccessiDatabaseStartupDependencies,
): Promise<AccessiDatabasePreflightReport> {
  const expectedVersion = ACCESSI_SCHEMA_VERSION;
  const before = evaluateAccessiDatabasePreflight(
    await dependencies.getVersion(options),
    expectedVersion,
    await dependencies.inspect(options),
  );

  if (before.status === 'ok') return before;

  if (before.status === 'newer') {
    throw new AccessiDatabaseSchemaNewerError(
      `Schema Accessi ${before.currentVersion} piu recente della libreria (${expectedVersion}); downgrade automatico non consentito.`,
      before,
    );
  }

  const policy = resolveAccessiDatabaseMigrationPolicy(options);
  if (policy === 'fail') {
    throw new AccessiDatabaseSchemaOutdatedError(
      outdatedMessage(
        before,
        'Migrazione non avviata: verificare lo schema o abilitare la migrazione.',
      ),
      before,
    );
  }

  if (policy === 'ask') {
    const interactive = dependencies.isInteractive?.() ?? isInteractiveAccessiSession();
    if (!interactive) {
      throw new AccessiDatabaseMigrationDeclinedError(
        outdatedMessage(
          before,
          'Migrazione non avviata: sessione non interattiva. Impostare ACCESSI_DB_MIGRATION_POLICY=migrate (oppure databaseMigration: "migrate") per eseguirla.',
        ),
        before,
      );
    }
    const accepted = await (dependencies.prompt ?? askAccessiDatabaseMigration)(before);
    if (!accepted) {
      throw new AccessiDatabaseMigrationDeclinedError(
        outdatedMessage(before, 'Migrazione annullata dall\'utente. Avvio interrotto.'),
        before,
      );
    }
  }

  dependencies.log?.(
    `Migrazione schema Accessi da ${before.currentVersion ?? 'non inizializzato'} a ${expectedVersion}.`,
  );
  await dependencies.migrate(options);

  const after = evaluateAccessiDatabasePreflight(
    await dependencies.getVersion(options),
    expectedVersion,
    await dependencies.inspect(options),
  );
  if (after.status !== 'ok') {
    throw new AccessiDatabaseMigrationFailedError(
      `Migrazione Accessi completata ma lo schema non e sano.\n${formatAccessiDatabaseStatus(after)}${issueBlock(after.issues)}`,
      after,
    );
  }

  dependencies.log?.(`Schema Accessi verificato: ${expectedVersion}.`);
  return after;
}
