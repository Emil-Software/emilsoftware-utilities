import type { AccessiOptions } from '../AccessiModule';

/**
 * Store di rotazione refresh token.
 *
 * `consume` e atomico: restituisce true una sola volta per `jti`, poi il token
 * e considerato usato fino alla sua scadenza. In multi-istanza usare Redis.
 */
export interface RefreshTokenRotationStore {
  consume(jti: string, expiresAtMs: number): Promise<boolean>;
  /**
   * Come `consume`, ma restituisce anche quando il token era gia stato
   * consumato: serve a distinguere un retry concorrente da un possibile furto.
   */
  consumeWithMetadata?(jti: string, expiresAtMs: number): Promise<RefreshTokenConsumeResult>;
  /** Revoca l'intera famiglia di refresh token (stesso login). */
  revokeFamily?(familyId: string, expiresAtMs: number): Promise<void>;
  /** True se la famiglia e stata revocata per riuso sospetto. */
  isFamilyRevoked?(familyId: string): Promise<boolean>;
  /** Health check opzionale per readiness del servizio. */
  healthCheck?(): Promise<boolean>;
}

/** Esito del consumo atomico di un refresh token. */
export interface RefreshTokenConsumeResult {
  consumed: boolean;
  /** Quando il token era gia stato consumato, il timestamp del primo consumo. */
  consumedAtMs?: number;
}

export interface RefreshTokenRotationOptions {
  /** Default: disabilitata se non viene fornito uno store. */
  enabled?: boolean;
  /** Store condiviso (es. Redis) per il monouso tra istanze. */
  store?: RefreshTokenRotationStore;
  /**
   * Finestra entro cui il riuso di un token appena consumato e trattato come
   * retry concorrente (nessuna revoca famiglia). Default: 10000 ms.
   */
  reuseGraceMs?: number;
  /**
   * Se true, dopo un riuso rilevato revoca anche tutte le sessioni utente.
   * Default: false, per non disconnettere dispositivi legittimi.
   */
  revokeUserSessionsOnReuse?: boolean;
}

export interface MemoryRefreshTokenRotationStore extends RefreshTokenRotationStore {
  clear(): void;
}

const CONSUME_SCRIPT = `
local ttl = tonumber(ARGV[2])
if not ttl or ttl <= 0 then return nil end
local stored = redis.call('GET', KEYS[1])
if not stored then
  redis.call('SET', KEYS[1], ARGV[1], 'PX', ttl)
  return {1, 0}
end
return {0, tonumber(stored) or 0}
`;
const REVOKE_FAMILY_SCRIPT =
  "if tonumber(ARGV[1]) > 0 then return redis.call('SET', KEYS[1], '1', 'PX', ARGV[1]) else return redis.call('SET', KEYS[1], '1') end";
const IS_FAMILY_REVOKED_SCRIPT = "return redis.call('EXISTS', KEYS[1])";

function parseConsumeResult(result: unknown): RefreshTokenConsumeResult {
  if (Array.isArray(result)) {
    const consumed = Number(result[0]) === 1 || result[0] === true;
    const consumedAtMs = Number(result[1]);
    return {
      consumed,
      ...(Number.isFinite(consumedAtMs) && consumedAtMs > 0 ? { consumedAtMs } : {}),
    };
  }
  // Client minimali (o store precedenti) rispondono 'OK' / null.
  return { consumed: result !== null && result !== undefined && result !== false };
}

export function createMemoryRefreshTokenRotationStore(): MemoryRefreshTokenRotationStore {
  const used = new Map<string, { expiresAtMs: number; consumedAtMs: number }>();
  const revokedFamilies = new Map<string, number>();

  const prune = (now: number) => {
    for (const [jti, entry] of used) {
      if (entry.expiresAtMs <= now) used.delete(jti);
    }
    for (const [familyId, expiresAt] of revokedFamilies) {
      if (expiresAt <= now) revokedFamilies.delete(familyId);
    }
  };

  const consumeWithMetadata = async (
    jti: string,
    expiresAtMs: number,
  ): Promise<RefreshTokenConsumeResult> => {
    const now = Date.now();
    prune(now);
    const existing = used.get(jti);
    if (existing && existing.expiresAtMs > now) {
      return { consumed: false, consumedAtMs: existing.consumedAtMs };
    }
    used.set(jti, { expiresAtMs, consumedAtMs: now });
    return { consumed: true };
  };

  return {
    async consume(jti, expiresAtMs) {
      return (await consumeWithMetadata(jti, expiresAtMs)).consumed;
    },
    consumeWithMetadata,
    async revokeFamily(familyId, expiresAtMs) {
      revokedFamilies.set(familyId, Math.max(expiresAtMs, Date.now() + 1));
    },
    async isFamilyRevoked(familyId) {
      const expiresAt = revokedFamilies.get(familyId);
      if (expiresAt === undefined) return false;
      if (expiresAt <= Date.now()) {
        revokedFamilies.delete(familyId);
        return false;
      }
      return true;
    },
    async healthCheck() {
      return true;
    },
    clear() {
      used.clear();
      revokedFamilies.clear();
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
  /** Default: `accessi:refresh-family-revoked:`. */
  familyKeyPrefix?: string;
}

/**
 * Store Redis per refresh token monouso.
 *
 * Il consumo e atomico: due refresh concorrenti dello stesso token producono
 * un solo successo. La famiglia viene revocata con una chiave separata che
 * scade insieme ai token che ne fanno parte.
 */
export function createRedisRefreshTokenRotationStore(
  options: RedisRefreshTokenRotationStoreOptions,
): RefreshTokenRotationStore {
  if (!options?.client || typeof options.client.eval !== 'function') {
    throw new Error('Redis refresh rotation store: client.eval non configurato.');
  }

  const keyPrefix = (options.keyPrefix ?? 'accessi:refresh-used:').replace(/:+$/, ':');
  const familyKeyPrefix = (options.familyKeyPrefix ?? 'accessi:refresh-family-revoked:').replace(/:+$/, ':');

  return {
    async consume(jti, expiresAtMs) {
      const ttlMs = Math.max(1, Math.trunc(expiresAtMs - Date.now()));
      const result = await options.client.eval(
        CONSUME_SCRIPT,
        1,
        `${keyPrefix}${jti}`,
        Date.now(),
        ttlMs,
      );
      return parseConsumeResult(result).consumed;
    },

    async consumeWithMetadata(jti, expiresAtMs) {
      const ttlMs = Math.max(1, Math.trunc(expiresAtMs - Date.now()));
      const result = await options.client.eval(
        CONSUME_SCRIPT,
        1,
        `${keyPrefix}${jti}`,
        Date.now(),
        ttlMs,
      );
      return parseConsumeResult(result);
    },

    async revokeFamily(familyId, expiresAtMs) {
      const ttlMs = Math.max(0, Math.trunc(expiresAtMs - Date.now()));
      await options.client.eval(REVOKE_FAMILY_SCRIPT, 1, `${familyKeyPrefix}${familyId}`, ttlMs);
    },

    async isFamilyRevoked(familyId) {
      const result = await options.client.eval(IS_FAMILY_REVOKED_SCRIPT, 1, `${familyKeyPrefix}${familyId}`);
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

const defaultMemoryStore = createMemoryRefreshTokenRotationStore();

export function getRefreshTokenRotationStore(
  options: AccessiOptions,
): RefreshTokenRotationStore | undefined {
  if (options.refreshTokenRotation?.enabled === false) return undefined;
  if (options.refreshTokenRotation?.store) return options.refreshTokenRotation.store;
  return options.refreshTokenRotation?.enabled === true ? defaultMemoryStore : undefined;
}

/**
 * True se la famiglia di refresh token e stata revocata. Ritorna false se lo
 * store non supporta le famiglie (implementazioni legacy).
 */
export async function isRefreshTokenFamilyRevoked(
  options: AccessiOptions,
  familyId: unknown,
): Promise<boolean> {
  if (typeof familyId !== 'string' || familyId.trim() === '') return false;
  const store = getRefreshTokenRotationStore(options);
  if (!store?.isFamilyRevoked) return false;
  return store.isFamilyRevoked(familyId);
}

/**
 * Revoca la famiglia di refresh token fino alla scadenza indicata. Ritorna
 * false se lo store non supporta le famiglie.
 */
export async function revokeRefreshTokenFamily(
  options: AccessiOptions,
  familyId: string,
  expiresAtMs: number,
): Promise<boolean> {
  const store = getRefreshTokenRotationStore(options);
  if (!store?.revokeFamily) return false;
  await store.revokeFamily(familyId, expiresAtMs);
  return true;
}

/** Consumo atomico con metadati, se lo store li supporta. */
export async function consumeRefreshToken(
  options: AccessiOptions,
  jti: string,
  expiresAtMs: number,
): Promise<RefreshTokenConsumeResult | undefined> {
  const store = getRefreshTokenRotationStore(options);
  if (!store) return undefined;
  if (store.consumeWithMetadata) {
    return store.consumeWithMetadata(jti, expiresAtMs);
  }
  return { consumed: await store.consume(jti, expiresAtMs) };
}

/** Solo per test: azzera lo store in memoria di default. */
export function clearDefaultRefreshTokenRotations(): void {
  defaultMemoryStore.clear();
}
