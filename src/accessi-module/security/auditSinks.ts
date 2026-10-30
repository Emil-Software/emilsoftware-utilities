import type {
  AccessiAuditPage,
  AccessiAuditQuery,
  AccessiAuditQueryableSink,
  AccessiAuditRecord,
  AccessiAuditSink,
} from './audit';
import { instrumentAccessiRedisClient } from '../observability/redisMetrics';
import type { AccessiRedisEvalClient } from '../observability/redisMetrics';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 1_000;

function normalizeQuery(query: AccessiAuditQuery = {}): Required<Pick<AccessiAuditQuery, 'limit' | 'offset' | 'order'>> {
  const limit = Number.isFinite(query.limit)
    ? Math.min(MAX_LIMIT, Math.max(1, Math.trunc(query.limit as number)))
    : DEFAULT_LIMIT;
  const offset = Number.isFinite(query.offset) ? Math.max(0, Math.trunc(query.offset as number)) : 0;
  return { limit, offset, order: query.order === 'asc' ? 'asc' : 'desc' };
}

function recordTime(record: AccessiAuditRecord): number {
  const time = Date.parse(record.timestamp);
  return Number.isFinite(time) ? time : 0;
}

function matches(record: AccessiAuditRecord, query: AccessiAuditQuery): boolean {
  if (query.event && record.event !== query.event) return false;
  if (query.codiceUtente !== undefined && Number(record.codiceUtente) !== query.codiceUtente) return false;
  const time = recordTime(record);
  if (query.from) {
    const from = Date.parse(query.from);
    if (Number.isFinite(from) && time < from) return false;
  }
  if (query.to) {
    const to = Date.parse(query.to);
    if (Number.isFinite(to) && time > to) return false;
  }
  return true;
}

function paginate(records: AccessiAuditRecord[], query: AccessiAuditQuery): AccessiAuditPage {
  const { limit, offset, order } = normalizeQuery(query);
  const filtered = records.filter((record) => matches(record, query));
  const ordered = order === 'asc' ? filtered : [...filtered].reverse();
  return {
    records: ordered.slice(offset, offset + limit),
    total: filtered.length,
    limit,
    offset,
  };
}

function cloneRecord(record: AccessiAuditRecord): AccessiAuditRecord {
  return JSON.parse(JSON.stringify(record)) as AccessiAuditRecord;
}

/** Opzioni del sink in memoria. */
export interface MemoryAccessiAuditSinkOptions {
  name?: string;
  /** Numero massimo di record conservati. Default: 10000. */
  maxRecords?: number;
  /** Retention in millisecondi. Default: nessuna scadenza. */
  retentionMs?: number;
  /** Orologio iniettabile per i test. */
  now?: () => number;
}

export interface MemoryAccessiAuditSink extends AccessiAuditQueryableSink {
  all(): AccessiAuditRecord[];
  clear(): void;
}

/**
 * Sink in memoria con query e retention.
 *
 * Adatto a sviluppo, test e singola istanza. Per piu istanze usare
 * `createRedisAccessiAuditSink` o un sink esterno.
 */
export function createMemoryAccessiAuditSink(
  options: MemoryAccessiAuditSinkOptions = {},
): MemoryAccessiAuditSink {
  const maxRecords = Math.max(1, Math.trunc(options.maxRecords ?? 10_000));
  const retentionMs = Math.max(0, Number(options.retentionMs ?? 0));
  const now = options.now ?? Date.now;
  let records: AccessiAuditRecord[] = [];

  const purgeExpired = (): void => {
    if (!retentionMs) return;
    const threshold = now() - retentionMs;
    records = records.filter((record) => recordTime(record) >= threshold);
  };

  return {
    name: options.name ?? 'memory',
    write(record) {
      records.push(cloneRecord(record));
      if (records.length > maxRecords) records = records.slice(records.length - maxRecords);
      purgeExpired();
    },
    async query(query = {}) {
      purgeExpired();
      return paginate(records, query);
    },
    async purge(before: Date) {
      const threshold = before.getTime();
      const beforeCount = records.length;
      records = records.filter((record) => recordTime(record) >= threshold);
      return beforeCount - records.length;
    },
    all() {
      return records.map(cloneRecord);
    },
    clear() {
      records = [];
    },
  };
}

/** Sink HTTP: inoltra ogni record a un endpoint esterno (SIEM, collector). */
export interface HttpAccessiAuditSinkOptions {
  name?: string;
  url: string;
  headers?: Record<string, string>;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export function createHttpAccessiAuditSink(
  options: HttpAccessiAuditSinkOptions,
): AccessiAuditSink {
  if (!options?.url) throw new Error('Audit sink HTTP: url obbligatoria.');
  return {
    name: options.name ?? 'http',
    async write(record) {
      const fetchImpl = options.fetch ?? globalThis.fetch;
      if (typeof fetchImpl !== 'function') {
        throw new Error('Audit sink HTTP: fetch non disponibile.');
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 3000);
      try {
        const response = await fetchImpl(options.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(options.headers ?? {}),
          },
          body: JSON.stringify(record),
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`Audit sink HTTP: risposta ${response.status}.`);
        }
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

/**
 * Adattatore per database, OpenTelemetry o qualunque destinazione custom.
 *
 * La callback riceve un record gia redatto e serializzabile.
 */
export function createCallbackAccessiAuditSink(
  write: (record: AccessiAuditRecord) => void | Promise<void>,
  name = 'callback',
): AccessiAuditSink {
  return { name, write };
}

export interface RedisAccessiAuditSinkOptions {
  client: AccessiRedisEvalClient;
  name?: string;
  /** Default: `accessi:audit:`. */
  keyPrefix?: string;
  /** Numero massimo di record. Default: 10000. */
  maxRecords?: number;
  /** Retention Redis in millisecondi. Default: 30 giorni. */
  retentionMs?: number;
}

const REDIS_WRITE_SCRIPT = `
local key = KEYS[1]
redis.call('RPUSH', key, ARGV[1])
redis.call('LTRIM', key, -tonumber(ARGV[2]), -1)
redis.call('PEXPIRE', key, ARGV[3])
return 1
`;

const REDIS_READ_SCRIPT = `return redis.call('LRANGE', KEYS[1], 0, -1)`;

const REDIS_REWRITE_SCRIPT = `
local key = KEYS[1]
redis.call('DEL', key)
for i = 2, #ARGV do
  redis.call('RPUSH', key, ARGV[i])
end
redis.call('PEXPIRE', key, ARGV[1])
return #ARGV - 1
`;

function parseRedisRecords(value: unknown): AccessiAuditRecord[] {
  if (!Array.isArray(value)) return [];
  const records: AccessiAuditRecord[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    try {
      const parsed = JSON.parse(entry) as AccessiAuditRecord;
      if (parsed && typeof parsed.event === 'string' && typeof parsed.timestamp === 'string') {
        records.push(parsed);
      }
    } catch {
      // Un record corrotto non deve bloccare query ed export.
    }
  }
  return records;
}

/**
 * Sink Redis persistente, condiviso tra istanze e interrogabile.
 *
 * Usa una lista con `LTRIM` per limitare i record e `PEXPIRE` per la retention.
 * Le query leggono la lista e filtrano lato applicazione.
 */
export function createRedisAccessiAuditSink(
  options: RedisAccessiAuditSinkOptions,
): AccessiAuditQueryableSink {
  if (!options?.client || typeof options.client.eval !== 'function') {
    throw new Error('Audit sink Redis: client.eval non configurato.');
  }
  const client = instrumentAccessiRedisClient('audit', options.client);
  const key = `${(options.keyPrefix ?? 'accessi:audit:').replace(/:*$/, ':')}events`;
  const maxRecords = Math.max(1, Math.trunc(options.maxRecords ?? 10_000));
  const retentionMs = Math.max(1_000, Math.trunc(options.retentionMs ?? 30 * 24 * 60 * 60 * 1000));

  const readAll = async (): Promise<AccessiAuditRecord[]> =>
    parseRedisRecords(await client.eval(REDIS_READ_SCRIPT, 1, key));

  return {
    name: options.name ?? 'redis',
    async write(record) {
      await client.eval(REDIS_WRITE_SCRIPT, 1, key, JSON.stringify(record), maxRecords, retentionMs);
    },
    async query(query = {}) {
      return paginate(await readAll(), query);
    },
    async purge(before: Date) {
      const records = await readAll();
      const kept = records.filter((record) => recordTime(record) >= before.getTime());
      const removed = records.length - kept.length;
      if (removed === 0) return 0;
      await client.eval(
        REDIS_REWRITE_SCRIPT,
        1,
        key,
        retentionMs,
        ...kept.map((record) => JSON.stringify(record)),
      );
      return removed;
    },
  };
}
