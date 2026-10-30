import type { AccessiOptions } from '../AccessiModule';

/**
 * Store di rotazione refresh token.
 *
 * `consume` e atomico: restituisce true una sola volta per `jti`, poi il token
 * e considerato usato fino alla sua scadenza. In multi-istanza usare Redis.
 */
export interface RefreshTokenRotationStore {
  consume(jti: string, expiresAtMs: number): Promise<boolean>;
  /** Health check opzionale per readiness del servizio. */
  healthCheck?(): Promise<boolean>;
}

export interface RefreshTokenRotationOptions {
  /** Default: disabilitata se non viene fornito uno store. */
  enabled?: boolean;
  /** Store condiviso (es. Redis) per il monouso tra istanze. */
  store?: RefreshTokenRotationStore;
}

export interface MemoryRefreshTokenRotationStore extends RefreshTokenRotationStore {
  clear(): void;
}

const CONSUME_SCRIPT = `
local ttl = tonumber(ARGV[2])
if not ttl or ttl <= 0 then return nil end
return redis.call('SET', KEYS[1], '1', 'PX', ttl, 'NX')
`;

export function createMemoryRefreshTokenRotationStore(): MemoryRefreshTokenRotationStore {
  const used = new Map<string, number>();
  return {
    async consume(jti, expiresAtMs) {
      const now = Date.now();
      const existing = used.get(jti);
      if (existing !== undefined && existing > now) {
        return false;
      }
      used.set(jti, expiresAtMs);
      return true;
    },
    async healthCheck() {
      return true;
    },
    clear() {
      used.clear();
    },
  };
}

export interface RefreshTokenRotationRedisClient {
  eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown>;
}

export interface RedisRefreshTokenRotationStoreOptions {
  client: RefreshTokenRotationRedisClient;
  /** Default: `accessi:refresh-used:`. */
  keyPrefix?: string;
}

/**
 * Store Redis per refresh token monouso.
 *
 * Usa `SET ... PX ... NX` atomico: due refresh concorrenti dello stesso token
 * producono un solo successo.
 */
export function createRedisRefreshTokenRotationStore(
  options: RedisRefreshTokenRotationStoreOptions,
): RefreshTokenRotationStore {
  if (!options?.client || typeof options.client.eval !== 'function') {
    throw new Error('Redis refresh rotation store: client.eval non configurato.');
  }

  const keyPrefix = (options.keyPrefix ?? 'accessi:refresh-used:').replace(/:+$/, ':');

  return {
    async consume(jti, expiresAtMs) {
      const ttlMs = Math.max(1, Math.trunc(expiresAtMs - Date.now()));
      const result = await options.client.eval(
        CONSUME_SCRIPT,
        1,
        `${keyPrefix}${jti}`,
        ttlMs,
      );
      return result !== null && result !== undefined && result !== false;
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

const defaultMemoryStore = createMemoryRefreshTokenRotationStore();

export function getRefreshTokenRotationStore(
  options: AccessiOptions,
): RefreshTokenRotationStore | undefined {
  if (options.refreshTokenRotation?.enabled === false) return undefined;
  if (options.refreshTokenRotation?.store) return options.refreshTokenRotation.store;
  return options.refreshTokenRotation?.enabled === true ? defaultMemoryStore : undefined;
}

/** Solo per test: azzera lo store in memoria di default. */
export function clearDefaultRefreshTokenRotations(): void {
  defaultMemoryStore.clear();
}
