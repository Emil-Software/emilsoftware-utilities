import type { AccessiOptions } from '../AccessiModule';

/**
 * Revoca dei singoli access token tramite `jti`.
 *
 * A differenza della revoca per utente, questa annulla un solo token senza
 * toccare le altre sessioni. La chiave scade al massimo a `exp` del token, cosi
 * la memoria usata resta limitata alla durata dei token emessi.
 */
export interface AccessTokenRevocationStore {
  revoke(jti: string, expiresAtMs: number): Promise<void>;
  isRevoked(jti: string): Promise<boolean>;
  /** Health check opzionale per readiness del servizio. */
  healthCheck?(): Promise<boolean>;
}

export interface AccessTokenRevocationOptions {
  /** Default: disabilitata se non viene fornito uno store. */
  enabled?: boolean;
  /** Store condiviso (es. Redis) per revocare i token tra istanze. */
  store?: AccessTokenRevocationStore;
  /** TTL di default quando `exp` non e noto. Default: 24 ore. */
  ttlMs?: number;
}

export interface MemoryAccessTokenRevocationStore extends AccessTokenRevocationStore {
  clear(): void;
}

const REVOKE_SCRIPT =
  "if tonumber(ARGV[2]) > 0 then return redis.call('SET', KEYS[1], '1', 'PX', ARGV[2]) else return redis.call('SET', KEYS[1], '1') end";
const IS_REVOKED_SCRIPT = "return redis.call('EXISTS', KEYS[1])";

export function createMemoryAccessTokenRevocationStore(): MemoryAccessTokenRevocationStore {
  const revoked = new Map<string, number>();
  const prune = (now: number) => {
    for (const [jti, expiresAt] of revoked) {
      if (expiresAt <= now) revoked.delete(jti);
    }
  };
  return {
    async revoke(jti, expiresAtMs) {
      const now = Date.now();
      prune(now);
      revoked.set(jti, Math.max(expiresAtMs, now + 1));
    },
    async isRevoked(jti) {
      const expiresAt = revoked.get(jti);
      if (expiresAt === undefined) return false;
      if (expiresAt <= Date.now()) {
        revoked.delete(jti);
        return false;
      }
      return true;
    },
    async healthCheck() {
      return true;
    },
    clear() {
      revoked.clear();
    },
  };
}

export interface AccessTokenRevocationRedisClient {
  eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown>;
}

export interface RedisAccessTokenRevocationStoreOptions {
  client: AccessTokenRevocationRedisClient;
  /** Default: `accessi:revoked-token:`. */
  keyPrefix?: string;
  /** Default: 24 ore. */
  ttlMs?: number;
}

/** Store Redis per la revoca dei singoli access token. */
export function createRedisAccessTokenRevocationStore(
  options: RedisAccessTokenRevocationStoreOptions,
): AccessTokenRevocationStore {
  if (!options?.client || typeof options.client.eval !== 'function') {
    throw new Error('Redis access token revocation store: client.eval non configurato.');
  }

  const keyPrefix = (options.keyPrefix ?? 'accessi:revoked-token:').replace(/:+$/, ':');
  const ttlMs = Math.max(0, Math.trunc(options.ttlMs ?? 24 * 60 * 60 * 1000));

  return {
    async revoke(jti, expiresAtMs) {
      const ttl = Number.isFinite(expiresAtMs)
        ? Math.max(0, Math.trunc(expiresAtMs - Date.now()))
        : ttlMs;
      await options.client.eval(REVOKE_SCRIPT, 1, `${keyPrefix}${jti}`, ttl);
    },

    async isRevoked(jti) {
      const result = await options.client.eval(IS_REVOKED_SCRIPT, 1, `${keyPrefix}${jti}`);
      return Number(result) > 0;
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

const defaultMemoryStore = createMemoryAccessTokenRevocationStore();

export function getAccessTokenRevocationStore(
  options: AccessiOptions,
): AccessTokenRevocationStore | undefined {
  if (options.accessTokenRevocation?.enabled === false) return undefined;
  if (options.accessTokenRevocation?.store) return options.accessTokenRevocation.store;
  return options.accessTokenRevocation?.enabled === true ? defaultMemoryStore : undefined;
}

/** True se il `jti` del token risulta revocato. */
export async function isAccessiAccessTokenRevoked(
  options: AccessiOptions,
  payload: Record<string, unknown>,
): Promise<boolean> {
  const store = getAccessTokenRevocationStore(options);
  if (!store) return false;
  const jti = typeof payload.jti === 'string' ? payload.jti : undefined;
  if (!jti) return false;
  return store.isRevoked(jti);
}

/** Revoca un singolo access token. Richiede uno store configurato. */
export async function revokeAccessiAccessToken(
  options: AccessiOptions,
  jti: string,
  expiresAtMs?: number,
): Promise<void> {
  const store = getAccessTokenRevocationStore(options);
  if (!store) throw new Error('Access token revocation store non configurato.');
  if (typeof jti !== 'string' || jti.trim() === '') {
    throw new Error('jti non valido.');
  }
  const ttlMs = Math.max(0, Math.trunc(options.accessTokenRevocation?.ttlMs ?? 24 * 60 * 60 * 1000));
  await store.revoke(jti, expiresAtMs ?? Date.now() + ttlMs);
}

/** Variante per i flussi applicativi: no-op se la revoca non e configurata. */
export async function revokeAccessiAccessTokenIfConfigured(
  options: AccessiOptions,
  jti: string,
  expiresAtMs?: number,
): Promise<boolean> {
  if (!getAccessTokenRevocationStore(options)) return false;
  await revokeAccessiAccessToken(options, jti, expiresAtMs);
  return true;
}

/** Solo per test: azzera lo store in memoria di default. */
export function clearDefaultAccessTokenRevocations(): void {
  defaultMemoryStore.clear();
}
