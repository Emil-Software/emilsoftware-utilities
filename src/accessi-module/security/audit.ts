import { Logger } from '../../Logger';
import { recordAccessiMetric } from '../observability/metrics';

/** Record di audit normalizzato e gia redatto. */
export interface AccessiAuditRecord {
  event: string;
  timestamp: string;
  [key: string]: unknown;
}

/** Destinazione di un record di audit. */
export interface AccessiAuditSink {
  /** Nome usato nelle metriche di errore del sink. */
  name?: string;
  write(record: AccessiAuditRecord): void | Promise<void>;
}

export interface AccessiAuditQuery {
  event?: string;
  from?: string;
  to?: string;
  codiceUtente?: number;
  limit?: number;
  offset?: number;
  order?: 'asc' | 'desc';
}

export interface AccessiAuditPage {
  records: AccessiAuditRecord[];
  total: number;
  limit: number;
  offset: number;
}

/** Sink interrogabile dagli endpoint amministrativi e dalla retention. */
export interface AccessiAuditQueryableSink extends AccessiAuditSink {
  query(filter?: AccessiAuditQuery): Promise<AccessiAuditPage>;
  purge(before: Date): Promise<number>;
}

/** Opzioni di audit del modulo. */
export interface AccessiAuditOptions {
  /** `false` disattiva i sink ma lascia il log strutturato. Default: abilitati. */
  enabled?: boolean;
  /** Sink aggiuntivi (HTTP, DB, OpenTelemetry). */
  sinks?: AccessiAuditSink[];
  /** Sink interrogabile usato da `/api/accessi/audit`. Default: primo sink queryable. */
  store?: AccessiAuditQueryableSink;
  /** Giorni di retention applicati ai sink queryable. Default: nessuna scadenza automatica. */
  retentionDays?: number;
  /** Chiavi aggiuntive da redigere, oltre a quelle predefinite. */
  redact?: string[];
  /** Scrivi anche sul Logger strutturato. Default: true. */
  logger?: boolean;
}

const REDACTED = '[REDACTED]';
const TRUNCATED = '[TRUNCATED]';

const DEFAULT_REDACTED_KEYS = new Set([
  'token',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'bearer',
  'jwt',
  'authorization',
  'cookie',
  'setcookie',
  'password',
  'passwordhash',
  'hashedpassword',
  'resettoken',
  'secret',
  'clientsecret',
  'privatekey',
  'apikey',
  'csrf',
  'csrftoken',
]);

const MAX_STRING_LENGTH = 512;
const MAX_ARRAY_LENGTH = 50;
const MAX_OBJECT_KEYS = 100;
const MAX_DEPTH = 4;
const PURGE_INTERVAL_MS = 60 * 60 * 1000;

let sinks: AccessiAuditSink[] = [];
let redactedKeys = new Set(DEFAULT_REDACTED_KEYS);
let retentionDays: number | undefined;
let loggerEnabled = true;
let lastPurgeAt = 0;

function normalizedKey(key: string): string {
  return key.toLowerCase().replace(/[-_\s]/g, '');
}

/**
 * Redige ricorsivamente token, segreti, cookie e header sensibili.
 *
 * Limita profondita, lunghezza delle stringhe e numero di elementi per evitare
 * che un payload applicativo finisca per intero nell'audit.
 */
export function redactAccessiAuditValue(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return TRUNCATED;
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH - 3)}...` : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return { name: value.name, message: redactAccessiAuditValue(value.message, depth + 1) };
  }
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_LENGTH).map((item) => redactAccessiAuditValue(item, depth + 1));
  }
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>).slice(0, MAX_OBJECT_KEYS)) {
      result[key] = redactedKeys.has(normalizedKey(key))
        ? REDACTED
        : redactAccessiAuditValue(entry, depth + 1);
    }
    return result;
  }
  return String(value);
}

function redactDetails(details: Record<string, unknown>): Record<string, unknown> {
  return redactAccessiAuditValue(details) as Record<string, unknown>;
}

function reportSinkError(sink: AccessiAuditSink, error: unknown): void {
  recordAccessiMetric('accessi_audit_sink_errors_total', 1, { sink: sink.name ?? 'unknown' });
  try {
    new Logger('AccessiAudit').error(
      `Audit sink non disponibile${sink.name ? ` (${sink.name})` : ''}: ${error instanceof Error ? error.message : String(error)}`,
    );
  } catch {
    // Il logging non deve mai interrompere l'operazione applicativa.
  }
}

function writeToSink(sink: AccessiAuditSink, record: AccessiAuditRecord): void {
  try {
    const result = sink.write(record);
    if (result && typeof (result as Promise<void>).catch === 'function') {
      (result as Promise<void>).catch((error) => reportSinkError(sink, error));
    }
  } catch (error) {
    reportSinkError(sink, error);
  }
}

function maybePurge(): void {
  if (!retentionDays || retentionDays <= 0) return;
  const now = Date.now();
  if (now - lastPurgeAt < PURGE_INTERVAL_MS) return;
  lastPurgeAt = now;
  const before = new Date(now - retentionDays * 24 * 60 * 60 * 1000);
  for (const sink of sinks) {
    if (typeof (sink as AccessiAuditQueryableSink).purge !== 'function') continue;
    try {
      const result = (sink as AccessiAuditQueryableSink).purge(before);
      if (result && typeof (result as Promise<number>).catch === 'function') {
        (result as Promise<number>).catch((error) => reportSinkError(sink, error));
      }
    } catch (error) {
      reportSinkError(sink, error);
    }
  }
}

/**
 * Configura i sink di audit del processo.
 *
 * Chiamato da `AccessiModule.forRoot`. Le opzioni sono globali: un solo modulo
 * Accessi per processo e la configurazione consigliata.
 */
export function configureAccessiAudit(options: AccessiAuditOptions | undefined): void {
  sinks = [];
  redactedKeys = new Set(DEFAULT_REDACTED_KEYS);
  retentionDays = undefined;
  loggerEnabled = true;
  lastPurgeAt = 0;

  for (const key of options?.redact ?? []) redactedKeys.add(normalizedKey(key));
  loggerEnabled = options?.logger !== false;
  if (options?.enabled === false) return;

  if (options?.store) sinks.push(options.store);
  for (const sink of options?.sinks ?? []) {
    if (!sinks.includes(sink)) sinks.push(sink);
  }
  const days = Number(options?.retentionDays);
  if (Number.isFinite(days) && days > 0) retentionDays = days;
}

/** Ripristina la configurazione iniziale (logger attivo, nessun sink). */
export function resetAccessiAudit(): void {
  configureAccessiAudit(undefined);
}

/** Sink interrogabile configurato, usato dagli endpoint amministrativi. */
export function getAccessiAuditStore(): AccessiAuditQueryableSink | undefined {
  const configured = sinks.find((sink): sink is AccessiAuditQueryableSink =>
    typeof (sink as AccessiAuditQueryableSink).query === 'function'
    && typeof (sink as AccessiAuditQueryableSink).purge === 'function',
  );
  return configured;
}

/**
 * Registra un evento di sicurezza.
 *
 * Il record viene redatto prima di raggiungere logger e sink. Un sink guasto
 * non interrompe mai il flusso applicativo.
 */
export function auditAccessi(event: string, details: Record<string, unknown> = {}): void {
  const record: AccessiAuditRecord = {
    event,
    timestamp: new Date().toISOString(),
    ...redactDetails(details ?? {}),
  };

  if (loggerEnabled) {
    try {
      new Logger('AccessiAudit').warning(JSON.stringify(record));
    } catch {
      // Il logging non deve mai interrompere l'operazione applicativa.
    }
  }

  for (const sink of sinks) writeToSink(sink, record);
  maybePurge();
}
