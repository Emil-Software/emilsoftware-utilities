import type { AccessiOptions } from '../AccessiModule';

/**
 * Revoca delle sessioni per utente.
 *
 * La revoca e un timestamp: un token con `iat` precedente al cutoff viene
 * rifiutato. I token emessi dopo il cutoff restano validi. La granularita di
 * `iat` e in secondi, quindi un token emesso nello stesso secondo della revoca
 * puo sopravvivere: e una finestra massima di 1 secondo.
 */
export interface SessionRevocationStore {
  revokeUser(codiceUtente: number, revokedAtMs: number): Promise<void>;
  getUserRevocation(codiceUtente: number): Promise<number | null>;
  /** Health check opzionale per readiness del servizio. */
  healthCheck?(): Promise<boolean>;
}

export interface SessionRevocationOptions {
  /** Default: disabilitata se non viene fornito uno store. */
  enabled?: boolean;
  /** Store condiviso (es. Redis) per invalidare le sessioni tra istanze. */
  store?: SessionRevocationStore;
  /** TTL delle chiavi Redis. Default: 365 giorni. */
  ttlMs?: number;
}

export interface MemorySessionRevocationStore extends SessionRevocationStore {
  clear(): void;
}

const REVOKE_USER_SCRIPT =
  "if tonumber(ARGV[2]) > 0 then return redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2]) else return redis.call('SET', KEYS[1], ARGV[1]) end";
const GET_USER_SCRIPT = "return redis.call('GET', KEYS[1])";

export function createMemorySessionRevocationStore(): MemorySessionRevocationStore {
  const revokedAt = new Map<number, number>();
  return {
    async revokeUser(codiceUtente, timestamp) {
      revokedAt.set(codiceUtente, timestamp);
    },
    async getUserRevocation(codiceUtente) {
      return revokedAt.get(codiceUtente) ?? null;
    },
    async healthCheck() {
      return true;
    },
    clear() {
      revokedAt.clear();
    },
  };
}

export interface SessionRevocationRedisClient {
  eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown>;
}

export interface RedisSessionRevocationStoreOptions {
  client: SessionRevocationRedisClient;
  /** Default: `accessi:revoked-user:`. */
  keyPrefix?: string;
  /** Default: 365 giorni. */
  ttlMs?: number;
}

/**
 * Store Redis per la revoca sessioni.
 *
 * `revokeUser` scrive un timestamp con TTL; `getUserRevocation` lo legge.
 * Il TTL deve essere maggiore della durata massima dei token.
 */
export function createRedisSessionRevocationStore(
  options: RedisSessionRevocationStoreOptions,
): SessionRevocationStore {
  if (!options?.client || typeof options.client.eval !== 'function') {
    throw new Error('Redis session revocation store: client.eval non configurato.');
  }

  const keyPrefix = (options.keyPrefix ?? 'accessi:revoked-user:').replace(/:+$/, ':');
  const ttlMs = Math.max(0, Math.trunc(options.ttlMs ?? 365 * 24 * 60 * 60 * 1000));

  return {
    async revokeUser(codiceUtente, revokedAtMs) {
      await options.client.eval(
        REVOKE_USER_SCRIPT,
        1,
        `${keyPrefix}${codiceUtente}`,
        String(revokedAtMs),
        ttlMs,
      );
    },

    async getUserRevocation(codiceUtente) {
      const value = await options.client.eval(
        GET_USER_SCRIPT,
        1,
        `${keyPrefix}${codiceUtente}`,
      );
      if (typeof value !== 'string' && typeof value !== 'number') return null;
      const timestamp = Number(value);
      return Number.isFinite(timestamp) ? timestamp : null;
    },

    async healthCheck() {
      try {
        const result = await options.client.eval("return redis.call('PING')", 0);
        return String(result).toUpperCase() === 'PONG';
      } catch {
        return false;
      }
    },
  };
}

const defaultMemoryStore = createMemorySessionRevocationStore();

/** Store di default in memoria, usato quando `sessionRevocation.store` non e configurato ma la revoca e abilitata. */
export function getSessionRevocationStore(options: AccessiOptions): SessionRevocationStore | undefined {
  if (options.sessionRevocation?.enabled === false) return undefined;
  if (options.sessionRevocation?.store) return options.sessionRevocation.store;
  return options.sessionRevocation?.enabled === true ? defaultMemoryStore : undefined;
}

/** True se il token e stato emesso prima dell'ultima revoca sessioni dell'utente. */
export async function isAccessiTokenRevoked(
  options: AccessiOptions,
  payload: Record<string, unknown>,
  codiceUtente: number,
): Promise<boolean> {
  const store = getSessionRevocationStore(options);
  if (!store) return false;

  const issuedAt = Number(payload.iat);
  if (!Number.isFinite(issuedAt)) return true;

  const revokedAt = await store.getUserRevocation(codiceUtente);
  if (revokedAt === null) return false;

  return issuedAt < Math.floor(revokedAt / 1000);
}

/** Revoca tutte le sessioni dell'utente. Richiede uno store configurato. */
export async function revokeAccessiUserSessions(
  options: AccessiOptions,
  codiceUtente: number,
  revokedAtMs: number = Date.now(),
): Promise<void> {
  const store = getSessionRevocationStore(options);
  if (!store) {
    throw new Error('Session revocation store non configurato.');
  }
  await store.revokeUser(codiceUtente, revokedAtMs);
}

/** Solo per test: azzera lo store in memoria di default. */
export function clearDefaultSessionRevocations(): void {
  defaultMemoryStore.clear();
}
