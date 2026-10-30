/** Esito di un controllo di rate limit. */
export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

/** Store pluggable per rate limit: memoria per singola istanza, Redis per cluster. */
export interface RateLimitStore {
  consume(key: string, windowMs: number, maxAttempts: number): Promise<RateLimitDecision>;
  /** Health check opzionale per readiness del servizio. */
  healthCheck?(): Promise<boolean>;
}

export interface MemoryRateLimitStore extends RateLimitStore {
  reset(): void;
}

interface RateLimitBucket {
  count: number;
  resetAt: number;
  lastSeenAt: number;
}

const DEFAULT_MAX_BUCKETS = 20_000;

function normalizeLimits(windowMs: number, maxAttempts: number): { windowMs: number; maxAttempts: number } {
  return {
    windowMs: Math.max(1, Math.trunc(windowMs)),
    maxAttempts: Math.max(1, Math.trunc(maxAttempts)),
  };
}

/** Store in memoria con finestra fissa e limite di bucket. */
export function createMemoryRateLimitStore(
  maxBuckets: number = DEFAULT_MAX_BUCKETS,
): MemoryRateLimitStore {
  const buckets = new Map<string, RateLimitBucket>();
  const safeMaxBuckets = Math.max(1, Math.trunc(maxBuckets));

  const prune = (now: number): void => {
    if (buckets.size < safeMaxBuckets) return;
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  };

  const enforceCap = (): void => {
    while (buckets.size >= safeMaxBuckets) {
      let oldestKey: string | undefined;
      let oldestSeen = Number.POSITIVE_INFINITY;
      for (const [key, bucket] of buckets) {
        if (bucket.lastSeenAt < oldestSeen) {
          oldestSeen = bucket.lastSeenAt;
          oldestKey = key;
        }
      }
      if (oldestKey === undefined) return;
      buckets.delete(oldestKey);
    }
  };

  return {
    async consume(key: string, windowMs: number, maxAttempts: number): Promise<RateLimitDecision> {
      const limits = normalizeLimits(windowMs, maxAttempts);
      const now = Date.now();
      prune(now);

      const existing = buckets.get(key);
      if (!existing || existing.resetAt <= now) {
        enforceCap();
        buckets.set(key, {
          count: 1,
          resetAt: now + limits.windowMs,
          lastSeenAt: now,
        });
        return { allowed: true, retryAfterSeconds: 0 };
      }

      existing.lastSeenAt = now;
      if (existing.count >= limits.maxAttempts) {
        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
        };
      }

      existing.count += 1;
      return { allowed: true, retryAfterSeconds: 0 };
    },
    reset() {
      buckets.clear();
    },
    async healthCheck() {
      return true;
    },
  };
}

const defaultStore = createMemoryRateLimitStore();

/** Store di default in memoria, usato quando non viene configurato uno store condiviso. */
export function getDefaultRateLimitStore(): MemoryRateLimitStore {
  return defaultStore;
}

/** Client Redis minimale: compatibile con ioredis (`redis.eval(script, numKeys, ...args)`). */
export interface RateLimitRedisClient {
  eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown>;
}

export interface RedisRateLimitStoreOptions {
  client: RateLimitRedisClient;
  /** Default: `accessi:rate:`. */
  keyPrefix?: string;
}

const REDIS_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('PTTL', KEYS[1])
if current > tonumber(ARGV[2]) then
  return {0, ttl}
end
return {1, ttl}
`;

/**
 * Store Redis per rate limit distribuito.
 *
 * Usa `INCR` + `PEXPIRE` atomici. Adatto a login, reset password, 2FA,
 * console entry e service token in deployment multi-istanza.
 */
export function createRedisRateLimitStore(
  options: RedisRateLimitStoreOptions,
): RateLimitStore {
  if (!options?.client || typeof options.client.eval !== 'function') {
    throw new Error('Redis rate limit store: client.eval non configurato.');
  }

  const keyPrefix = (options.keyPrefix ?? 'accessi:rate:').replace(/:+$/, ':');

  return {
    async consume(key, windowMs, maxAttempts) {
      const limits = normalizeLimits(windowMs, maxAttempts);
      const raw = await options.client.eval(
        REDIS_SCRIPT,
        1,
        `${keyPrefix}${key}`,
        limits.windowMs,
        limits.maxAttempts,
      );

      if (!Array.isArray(raw) || raw.length < 2) {
        throw new Error('Redis rate limit store: risposta non valida.');
      }

      const allowed = Number(raw[0]) === 1;
      const ttlMs = Number(raw[1]);
      return {
        allowed,
        retryAfterSeconds: allowed
          ? 0
          : Math.max(1, Number.isFinite(ttlMs) && ttlMs > 0 ? Math.ceil(ttlMs / 1000) : 1),
      };
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
