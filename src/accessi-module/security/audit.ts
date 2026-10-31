import { Logger } from '../../Logger';
import { recordAccessiMetric } from '../observability/metrics';
import { getAccessiTenantId } from '../tenancy/tenantContext';

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
  /** Etichetta tenant aggiunta a ogni record (multi-tenancy). */
  tenantId?: string;
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

interface ResolvedAccessiAuditConfig {
  sinks: AccessiAuditSink[];
  redactedKeys: Set<string>;
  retentionDays?: number;
  loggerEnabled: boolean;
  tenantId?: string;
  lastPurgeAt: number;
}

function resolveConfig(options: AccessiAuditOptions | undefined): ResolvedAccessiAuditConfig {
  const redactedKeys = new Set(DEFAULT_REDACTED_KEYS);
  for (const key of options?.redact ?? []) redactedKeys.add(normalizedKey(key));
  const retentionDays = Number(options?.retentionDays);
  return {
    sinks: options?.enabled === false
      ? []
      : [
          ...(options?.store ? [options.store] : []),
          ...(options?.sinks ?? []).filter((sink) => sink !== options?.store),
        ],
    redactedKeys,
    ...(Number.isFinite(retentionDays) && retentionDays > 0 ? { retentionDays } : {}),
    loggerEnabled: options?.logger !== false,
    ...(options?.tenantId ? { tenantId: options.tenantId } : {}),
    lastPurgeAt: 0,
  };
}

let defaultConfig = resolveConfig(undefined);
const tenantConfigs = new Map<string, ResolvedAccessiAuditConfig>();

function currentConfig(): ResolvedAccessiAuditConfig {
  const tenantId = getAccessiTenantId();
  if (tenantId) {
    const tenantConfig = tenantConfigs.get(tenantId);
    if (tenantConfig) return tenantConfig;
  }
  return defaultConfig;
}

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
  return redactValue(value, depth, currentConfig().redactedKeys);
}

function redactValue(value: unknown, depth: number, keys: Set<string>): unknown {
  if (depth > MAX_DEPTH) return TRUNCATED;
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH - 3)}...` : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return { name: value.name, message: redactValue(value.message, depth + 1, keys) };
  }
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_LENGTH).map((item) => redactValue(item, depth + 1, keys));
  }
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>).slice(0, MAX_OBJECT_KEYS)) {
      result[key] = keys.has(normalizedKey(key))
        ? REDACTED
        : redactValue(entry, depth + 1, keys);
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

function maybePurge(config: ResolvedAccessiAuditConfig): void {
  if (!config.retentionDays || config.retentionDays <= 0) return;
  const now = Date.now();
  if (now - config.lastPurgeAt < PURGE_INTERVAL_MS) return;
  config.lastPurgeAt = now;
  const before = new Date(now - config.retentionDays * 24 * 60 * 60 * 1000);
  for (const sink of config.sinks) {
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
 * Configura i sink di audit.
 *
 * Chiamato da `AccessiModule.forRoot`. Con `tenantId` la configurazione vale
 * solo per quel tenant e non sovrascrive quella degli altri: e il presupposto
 * per il router multi-tenant in-process. Senza `tenantId` aggiorna la
 * configurazione di default (comportamento single-tenant).
 */
export function configureAccessiAudit(options: AccessiAuditOptions | undefined): void {
  defaultConfig = resolveConfig(options);
}

/**
 * Configura audit e sink per un tenant specifico (router in-process).
 *
 * La configurazione vale quando la richiesta e dentro
 * `runWithAccessiTenant`/`createAccessiTenantRouter`; gli eventi fuori da un
 * contesto tenant usano la configurazione di default del processo.
 */
export function configureAccessiTenantAudit(
  tenantId: string,
  options: AccessiAuditOptions | undefined,
): void {
  if (!tenantId) throw new Error('configureAccessiTenantAudit: tenantId obbligatorio.');
  tenantConfigs.set(tenantId, resolveConfig({ ...(options ?? {}), tenantId }));
}

/** Ripristina la configurazione iniziale (logger attivo, nessun sink). */
export function resetAccessiAudit(): void {
  defaultConfig = resolveConfig(undefined);
  tenantConfigs.clear();
}

/** Sink interrogabile configurato, usato dagli endpoint amministrativi. */
export function getAccessiAuditStore(tenantId?: string): AccessiAuditQueryableSink | undefined {
  const resolvedTenant = tenantId ?? getAccessiTenantId();
  const config = resolvedTenant
    ? tenantConfigs.get(resolvedTenant) ?? defaultConfig
    : defaultConfig;
  return config.sinks.find((sink): sink is AccessiAuditQueryableSink =>
    typeof (sink as AccessiAuditQueryableSink).query === 'function'
    && typeof (sink as AccessiAuditQueryableSink).purge === 'function',
  );
}

/**
 * Registra un evento di sicurezza.
 *
 * Il record viene redatto prima di raggiungere logger e sink. Un sink guasto
 * non interrompe mai il flusso applicativo.
 */
export function auditAccessi(event: string, details: Record<string, unknown> = {}): void {
  const config = currentConfig();
  const contextTenant = getAccessiTenantId();
  const tenantId = contextTenant ?? config.tenantId;
  const record: AccessiAuditRecord = {
    event,
    timestamp: new Date().toISOString(),
    ...(tenantId ? { tenant: tenantId } : {}),
    ...redactDetails(details ?? {}),
  };

  if (config.loggerEnabled) {
    try {
      new Logger('AccessiAudit').warning(JSON.stringify(record));
    } catch {
      // Il logging non deve mai interrompere l'operazione applicativa.
    }
  }

  for (const sink of config.sinks) writeToSink(sink, record);
  maybePurge(config);
}
