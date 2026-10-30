import type { AccessiOptions } from '../AccessiModule';
import { instrumentAccessiRedisClient } from '../observability/redisMetrics';
import { auditAccessi } from './audit';
import { countAccessiMetric } from '../observability/metrics';
import { isAccessiAccessTokenRevoked } from './accessTokenRevocation';
import { isRefreshTokenFamilyRevoked } from './refreshTokenRotation';

/**
 * Revoca delle sessioni per utente.
 *
 * La revoca e un timestamp: un token emesso prima del cutoff viene rifiutato.
 * I token emessi dopo il cutoff restano validi. I token includono `iatMs`
 * (millisecondi) per rendere la revoca deterministica anche quando il cambio
 * password e il login avvengono nello stesso secondo; per i token legacy senza
 * `iatMs` si usa `iat` in secondi.
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
  const client = instrumentAccessiRedisClient('session_revocation', options.client);

  return {
    async revokeUser(codiceUtente, revokedAtMs) {
      await client.eval(
        REVOKE_USER_SCRIPT,
        1,
        `${keyPrefix}${codiceUtente}`,
        String(revokedAtMs),
        ttlMs,
      );
    },

    async getUserRevocation(codiceUtente) {
      const value = await client.eval(
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
        const result = await client.eval("return redis.call('PING')", 0);
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

/**
 * Issued-at in millisecondi. I token emessi da questa versione includono `iatMs`;
 * per quelli legacy si ricade su `iat` (secondi) per restare compatibili.
 */
export function resolveAccessiTokenIssuedAtMs(payload: Record<string, unknown>): number | null {
  const issuedAtMs = Number(payload.iatMs);
  if (Number.isFinite(issuedAtMs) && issuedAtMs > 0) return issuedAtMs;

  const issuedAt = Number(payload.iat);
  if (!Number.isFinite(issuedAt)) return null;
  return issuedAt * 1000;
}

/**
 * True se il token e stato revocato: famiglia refresh revocata, `jti` revocato
 * oppure sessione utente revocata prima dell'emissione del token.
 */
export async function isAccessiTokenRevoked(
  options: AccessiOptions,
  payload: Record<string, unknown>,
  codiceUtente: number,
): Promise<boolean> {
  if (await isRefreshTokenFamilyRevoked(options, payload.fid)) return true;
  if (await isAccessiAccessTokenRevoked(options, payload)) return true;

  const store = getSessionRevocationStore(options);
  if (!store) return false;

  const issuedAtMs = resolveAccessiTokenIssuedAtMs(payload);
  if (issuedAtMs === null) return true;

  const revokedAt = await store.getUserRevocation(codiceUtente);
  if (revokedAt === null) return false;

  // I token emessi da questa versione hanno `iatMs`: un token emesso nello
  // stesso millisecondo della revoca e considerato revocato. Per i token
  // legacy (solo `iat`, secondi) si mantiene il confronto per secondo.
  const preciseIssuedAtMs = Number(payload.iatMs);
  if (Number.isFinite(preciseIssuedAtMs) && preciseIssuedAtMs > 0) {
    return issuedAtMs <= revokedAt;
  }
  return issuedAtMs < Math.floor(revokedAt / 1000) * 1000;
}

/** Revoca tutte le sessioni dell'utente. Richiede uno store configurato. */
export async function revokeAccessiUserSessions(
  options: AccessiOptions,
  codiceUtente: number,
  revokedAtMs: number = Date.now(),
  reason: string = 'manual',
): Promise<void> {
  const store = getSessionRevocationStore(options);
  if (!store) {
    throw new Error('Session revocation store non configurato.');
  }
  await store.revokeUser(codiceUtente, revokedAtMs);
  auditAccessi('accessi_sessions_revoked', { codiceUtente, revokedAtMs, reason });
  countAccessiMetric(options, 'sessions_revoked_total', { reason });
}

/**
 * Variante per i flussi applicativi (cambio password, blocco, cancellazione):
 * se la revoca non e configurata non fallisce, perche quei flussi devono
 * continuare a funzionare anche senza store condiviso.
 */
export async function revokeAccessiUserSessionsIfConfigured(
  options: AccessiOptions,
  codiceUtente: number,
  reason: string = 'manual',
  revokedAtMs: number = Date.now(),
): Promise<boolean> {
  if (!getSessionRevocationStore(options)) return false;
  await revokeAccessiUserSessions(options, codiceUtente, revokedAtMs, reason);
  return true;
}

/** Solo per test: azzera lo store in memoria di default. */
export function clearDefaultSessionRevocations(): void {
  defaultMemoryStore.clear();
}
