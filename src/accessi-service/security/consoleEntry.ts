import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { instrumentAccessiRedisClient } from '../observability/redisMetrics';

/**
 * Ticket di ingresso alla console, monouso e a breve scadenza.
 *
 * Serve a passare una sessione gia autenticata (frontend che possiede un JWT Accessi)
 * alla console amministrativa senza reinserire le credenziali e senza mettere il JWT
 * nell'URL: il frontend scambia il proprio JWT con un ticket opaco, apre la console
 * con `#entry=<ticket>` e la console lo scambia con il token originale.
 *
 * Il ticket e valido una sola volta, per pochi secondi, ed e legato all'utente che
 * lo ha richiesto (che deve avere accesso alla console). Lo store di default e in
 * memoria; in multi-istanza usare `createRedisConsoleEntryStore`.
 */

export interface ConsoleEntryRecord {
  token: string;
  codiceUtente: number;
}

export interface ConsoleEntryTicket {
  ticket: string;
  expiresInSeconds: number;
}

/** Store pluggable: memoria per single instance, Redis per multi-istanza. */
export interface ConsoleEntryStore {
  issue(record: ConsoleEntryRecord, ttlMs: number): Promise<ConsoleEntryTicket>;
  consume(ticket: string): Promise<ConsoleEntryRecord | null>;
  /** Health check opzionale per readiness del servizio. */
  healthCheck?(): Promise<boolean>;
}

const DEFAULT_TTL_MS = 60_000;
const DEFAULT_MAX_ENTRIES = 5000;
const TICKET_PATTERN = /^[a-f0-9]{64}$/i;

interface StoredEntry extends ConsoleEntryRecord {
  expiresAt: number;
}

/** Store in memoria con API sincrona per retrocompatibilita e API async per l'interfaccia. */
export interface MemoryConsoleEntryStore extends ConsoleEntryStore {
  issueSync(record: ConsoleEntryRecord, ttlMs?: number): ConsoleEntryTicket;
  consumeSync(ticket: string): ConsoleEntryRecord | null;
  clear(): void;
}

function createTicket(): string {
  return randomBytes(32).toString('hex');
}

function normalizeTtl(ttlMs: number): number {
  return Math.max(1, Math.trunc(ttlMs));
}

/** Store in memoria: adatto a sviluppo e a una singola istanza. */
export function createMemoryConsoleEntryStore(
  maxEntries: number = DEFAULT_MAX_ENTRIES,
): MemoryConsoleEntryStore {
  const entries = new Map<string, StoredEntry>();

  const sweep = (now: number): void => {
    for (const [ticket, record] of entries) {
      if (record.expiresAt <= now) entries.delete(ticket);
    }
  };

  const issueSync = (record: ConsoleEntryRecord, ttlMs: number = DEFAULT_TTL_MS): ConsoleEntryTicket => {
    // Il TTL negativo resta supportato per test e per il comportamento storico:
    // il ticket e immediatamente scaduto.
    const ttl = Math.trunc(ttlMs);
    const now = Date.now();
    sweep(now);

    while (entries.size >= maxEntries) {
      const oldest = entries.keys().next().value;
      if (oldest === undefined) break;
      entries.delete(oldest);
    }

    const ticket = createTicket();
    entries.set(ticket, { ...record, expiresAt: now + ttl });
    return { ticket, expiresInSeconds: Math.max(0, Math.ceil(ttl / 1000)) };
  };

  const consumeSync = (ticket: string): ConsoleEntryRecord | null => {
    if (typeof ticket !== 'string' || !TICKET_PATTERN.test(ticket)) {
      return null;
    }
    const record = entries.get(ticket);
    if (!record) return null;
    entries.delete(ticket);
    if (record.expiresAt <= Date.now()) return null;
    return { token: record.token, codiceUtente: record.codiceUtente };
  };

  return {
    issueSync,
    consumeSync,
    clear: () => entries.clear(),
    async issue(record, ttlMs) {
      return issueSync(record, ttlMs);
    },
    async consume(ticket) {
      return consumeSync(ticket);
    },
    async healthCheck() {
      return true;
    },
  };
}

const defaultStore = createMemoryConsoleEntryStore();

/** Store di default in memoria, usato quando `AccessiOptions.consoleEntry.store` non e configurato. */
export function getDefaultConsoleEntryStore(): ConsoleEntryStore {
  return defaultStore;
}

// Funzioni storiche sincrone: mantengono il comportamento per test e consumer esistenti.
export function issueConsoleEntryTicket(
  record: ConsoleEntryRecord,
  ttlMs: number = DEFAULT_TTL_MS,
): ConsoleEntryTicket {
  return defaultStore.issueSync(record, ttlMs);
}

export function consumeConsoleEntryTicket(ticket: unknown): ConsoleEntryRecord | null {
  return typeof ticket === 'string' ? defaultStore.consumeSync(ticket) : null;
}

/** Solo per i test: azzera lo store in memoria di default. */
export function clearConsoleEntryTickets(): void {
  defaultStore.clear();
}

/** Client Redis minimale: compatibile con ioredis (`redis.eval(script, numKeys, ...args)`). */
export interface ConsoleEntryRedisClient {
  eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown>;
}

export interface RedisConsoleEntryStoreOptions {
  client: ConsoleEntryRedisClient;
  /** Segreto per cifrare il JWT nel Redis. Non usare il JWT in chiaro. */
  encryptionKey: string | Buffer;
  /** Default: `accessi:console-entry:`. */
  keyPrefix?: string;
  /** Tentativi in caso di collisione del ticket. Default: 5. */
  maxIssueAttempts?: number;
}

const SET_SCRIPT = "return redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2], 'NX')";
const CONSUME_SCRIPT =
  "local value = redis.call('GET', KEYS[1]) if value then redis.call('DEL', KEYS[1]) end return value";

function deriveEncryptionKey(secret: string | Buffer): Buffer {
  const source = Buffer.isBuffer(secret) ? secret : Buffer.from(secret, 'utf8');
  if (source.length === 0) {
    throw new Error('Redis console entry encryptionKey non configurata.');
  }
  return source.length === 32 ? source : createHash('sha256').update(source).digest();
}

function encryptRecord(record: ConsoleEntryRecord, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(record), 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext].map((part) => part.toString('base64url')).join('.');
}

function decryptRecord(value: string, key: Buffer): ConsoleEntryRecord | null {
  const [ivPart, tagPart, ciphertextPart] = value.split('.');
  if (!ivPart || !tagPart || !ciphertextPart) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivPart, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(ciphertextPart, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
    const parsed: unknown = JSON.parse(plaintext);
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof (parsed as ConsoleEntryRecord).token !== 'string' ||
      typeof (parsed as ConsoleEntryRecord).codiceUtente !== 'number'
    ) {
      return null;
    }
    return parsed as ConsoleEntryRecord;
  } catch {
    return null;
  }
}

/**
 * Store Redis per ticket console.
 *
 * - il JWT viene cifrato con AES-256-GCM prima di essere scritto;
 * - `SET ... PX ... NX` evita collisioni;
 * - il consume usa `GET` + `DEL` atomici in Lua, quindi il ticket e monouso
 *   anche con piu istanze.
 */
export function createRedisConsoleEntryStore(
  options: RedisConsoleEntryStoreOptions,
): ConsoleEntryStore {
  if (!options?.client || typeof options.client.eval !== 'function') {
    throw new Error('Redis console entry store: client.eval non configurato.');
  }

  const key = deriveEncryptionKey(options.encryptionKey);
  const keyPrefix = (options.keyPrefix ?? 'accessi:console-entry:').replace(/:+$/, ':');
  const maxAttempts = Math.max(1, options.maxIssueAttempts ?? 5);
  const client = instrumentAccessiRedisClient('console_entry', options.client);

  return {
    async issue(record, ttlMs) {
      const safeTtl = normalizeTtl(ttlMs);
      const value = encryptRecord(record, key);

      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const ticket = createTicket();
        const result = await client.eval(
          SET_SCRIPT,
          1,
          `${keyPrefix}${ticket}`,
          value,
          safeTtl,
        );
        if (result) {
          return { ticket, expiresInSeconds: Math.ceil(safeTtl / 1000) };
        }
      }

      throw new Error('Impossibile emettere un ticket console univoco.');
    },

    async consume(ticket) {
      if (typeof ticket !== 'string' || !TICKET_PATTERN.test(ticket)) {
        return null;
      }
      const value = await client.eval(
        CONSUME_SCRIPT,
        1,
        `${keyPrefix}${ticket}`,
      );
      if (typeof value !== 'string') return null;
      return decryptRecord(value, key);
    },

    async healthCheck() {
      try {
        const result = await client.eval("return redis.call('PING')", 0);
        return String(result).toUpperCase() === 'PONG';
      } catch {
        return false;
      }
    },
  };
}
