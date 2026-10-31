import type { AccessiOptions } from '../../accessi-module/AccessiModule';
import { getAccessiTenantRedisPrefix } from './tenants';
import { createRedisRateLimitStore } from '../../accessi-module/security/rateLimitStore';
import type { RateLimitStore } from '../../accessi-module/security/rateLimitStore';
import { createRedisConsoleEntryStore } from '../../accessi-module/security/consoleEntry';
import type { ConsoleEntryStore } from '../../accessi-module/security/consoleEntry';
import { createRedisSessionRevocationStore } from '../../accessi-module/security/sessionRevocation';
import type { SessionRevocationStore } from '../../accessi-module/security/sessionRevocation';
import { createRedisAccessTokenRevocationStore } from '../../accessi-module/security/accessTokenRevocation';
import type { AccessTokenRevocationStore } from '../../accessi-module/security/accessTokenRevocation';
import { createRedisRefreshTokenRotationStore } from '../../accessi-module/security/refreshTokenRotation';
import type { RefreshTokenRotationStore } from '../../accessi-module/security/refreshTokenRotation';

/** Client Redis minimo accettato dagli store Accessi. */
export interface AccessiTenantRedisClient {
  eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown>;
}

/** Prefissi Redis per singolo store, tutti relativi al tenant. */
export interface AccessiTenantStorePrefixes {
  base?: string;
  rateLimit?: string;
  serviceTokenRateLimit?: string;
  sessionRevocation?: string;
  accessTokenRevocation?: string;
  refreshTokenRotation?: string;
  refreshTokenFamily?: string;
  consoleEntry?: string;
}

export interface ResolvedAccessiTenantStorePrefixes {
  base: string;
  rateLimit: string;
  serviceTokenRateLimit: string;
  sessionRevocation: string;
  accessTokenRevocation: string;
  refreshTokenRotation: string;
  refreshTokenFamily: string;
  consoleEntry: string;
}

export interface CreateAccessiTenantStoresOptions {
  tenantId: string;
  client: AccessiTenantRedisClient;
  /** Segreto per cifrare i ticket console a riposo. Usare un segreto del tenant. */
  encryptionKey: string | Buffer;
  /** Base prefix. Default: `accessi:<tenantId>:`. */
  prefix?: string;
  prefixes?: AccessiTenantStorePrefixes;
  /** TTL revoca sessioni. Default dello store (365 giorni). */
  sessionRevocationTtlMs?: number;
  /** TTL revoca jti. Default dello store (24 ore). */
  accessTokenRevocationTtlMs?: number;
  consoleEntryMaxIssueAttempts?: number;
  /** Attiva la rotazione refresh token nell'options risultante. Default: true. */
  enableRefreshTokenRotation?: boolean;
}

export interface AccessiTenantStores {
  tenantId: string;
  prefixes: ResolvedAccessiTenantStorePrefixes;
  rateLimit: RateLimitStore;
  serviceTokenRateLimit: RateLimitStore;
  sessionRevocation: SessionRevocationStore;
  accessTokenRevocation: AccessTokenRevocationStore;
  refreshTokenRotation: RefreshTokenRotationStore;
  consoleEntry: ConsoleEntryStore;
  /** Collega tutti gli store alle opzioni Accessi del tenant. */
  applyTo(options: AccessiOptions): AccessiOptions;
}

/**
 * Prefissi Redis isolati per tenant.
 *
 * Ogni store ha un namespace distinto: condividere un prefisso tra tenant
 * significherebbe condividere rate limit, revoche o refresh token.
 */
export function getAccessiTenantStorePrefixes(
  tenantId: string,
  overrides: AccessiTenantStorePrefixes = {},
): ResolvedAccessiTenantStorePrefixes {
  const base = overrides.base ?? getAccessiTenantRedisPrefix(tenantId);
  return {
    base,
    rateLimit: overrides.rateLimit ?? `${base}rate:`,
    serviceTokenRateLimit: overrides.serviceTokenRateLimit ?? `${base}service-token-rate:`,
    sessionRevocation: overrides.sessionRevocation ?? `${base}session:`,
    accessTokenRevocation: overrides.accessTokenRevocation ?? `${base}jti:`,
    refreshTokenRotation: overrides.refreshTokenRotation ?? `${base}refresh:`,
    refreshTokenFamily: overrides.refreshTokenFamily ?? `${base}refresh-family:`,
    consoleEntry: overrides.consoleEntry ?? `${base}console-entry:`,
  };
}

/**
 * Crea tutti gli store Redis di un tenant con prefissi gia isolati.
 *
 * `applyTo` restituisce una copia delle opzioni con gli store collegati:
 * `publicAuthRateLimit`, `serviceTokens`, `sessionRevocation`,
 * `accessTokenRevocation`, `refreshTokenRotation` e `consoleEntry`.
 */
export function createAccessiTenantStores(
  options: CreateAccessiTenantStoresOptions,
): AccessiTenantStores {
  if (!options?.tenantId || !/^[a-z0-9][a-z0-9_-]{0,62}$/.test(options.tenantId)) {
    throw new Error('createAccessiTenantStores: tenantId non valido.');
  }
  if (!options.client || typeof options.client.eval !== 'function') {
    throw new Error('createAccessiTenantStores: client.eval non configurato.');
  }
  const encryptionKey = options.encryptionKey;
  if (encryptionKey === undefined || encryptionKey === null || encryptionKey.length === 0) {
    throw new Error('createAccessiTenantStores: encryptionKey obbligatoria per i ticket console.');
  }

  const prefixes = getAccessiTenantStorePrefixes(options.tenantId, {
    ...(options.prefix ? { base: options.prefix } : {}),
    ...(options.prefixes ?? {}),
  });
  const { client } = options;
  const enableRefreshTokenRotation = options.enableRefreshTokenRotation !== false;

  const rateLimit = createRedisRateLimitStore({ client, keyPrefix: prefixes.rateLimit });
  const serviceTokenRateLimit = createRedisRateLimitStore({
    client,
    keyPrefix: prefixes.serviceTokenRateLimit,
  });
  const sessionRevocation = createRedisSessionRevocationStore({
    client,
    keyPrefix: prefixes.sessionRevocation,
    ...(options.sessionRevocationTtlMs !== undefined ? { ttlMs: options.sessionRevocationTtlMs } : {}),
  });
  const accessTokenRevocation = createRedisAccessTokenRevocationStore({
    client,
    keyPrefix: prefixes.accessTokenRevocation,
    ...(options.accessTokenRevocationTtlMs !== undefined ? { ttlMs: options.accessTokenRevocationTtlMs } : {}),
  });
  const refreshTokenRotation = createRedisRefreshTokenRotationStore({
    client,
    keyPrefix: prefixes.refreshTokenRotation,
    familyKeyPrefix: prefixes.refreshTokenFamily,
  });
  const consoleEntry = createRedisConsoleEntryStore({
    client,
    encryptionKey,
    keyPrefix: prefixes.consoleEntry,
    ...(options.consoleEntryMaxIssueAttempts !== undefined
      ? { maxIssueAttempts: options.consoleEntryMaxIssueAttempts }
      : {}),
  });

  return {
    tenantId: options.tenantId,
    prefixes,
    rateLimit,
    serviceTokenRateLimit,
    sessionRevocation,
    accessTokenRevocation,
    refreshTokenRotation,
    consoleEntry,
    applyTo(accessiOptions) {
      return {
        ...accessiOptions,
        tenantId: options.tenantId,
        publicAuthRateLimit: {
          ...accessiOptions.publicAuthRateLimit,
          store: rateLimit,
        },
        serviceTokens: {
          ...accessiOptions.serviceTokens,
          rateLimitStore: serviceTokenRateLimit,
        },
        sessionRevocation: {
          ...accessiOptions.sessionRevocation,
          store: sessionRevocation,
        },
        accessTokenRevocation: {
          ...accessiOptions.accessTokenRevocation,
          store: accessTokenRevocation,
        },
        refreshTokenRotation: {
          ...accessiOptions.refreshTokenRotation,
          enabled: accessiOptions.refreshTokenRotation?.enabled ?? enableRefreshTokenRotation,
          store: refreshTokenRotation,
        },
        consoleEntry: {
          ...accessiOptions.consoleEntry,
          store: consoleEntry,
        },
      };
    },
  };
}
