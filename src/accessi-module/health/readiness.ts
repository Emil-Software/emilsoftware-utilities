import type { AccessiOptions } from '../AccessiModule';
import { ACCESSI_SCHEMA_VERSION } from '../database-updates/accessiSchema';
import { AccessiDatabaseUpdater } from '../database-updates/AccessiDatabaseUpdater';

/**
 * Health e readiness riutilizzabili.
 *
 * Lo stesso contratto e usato da `createAccessiService` (servizio standalone) e
 * da `createAccessiHealthModule` (host Nest con `AccessiModule.forRoot`):
 * `/health/live` risponde sempre se il processo e vivo, `/health/ready` verifica
 * bootstrap, schema del database, store condivisi e check applicativi.
 */
export interface AccessiReadinessCheck {
  name: string;
  check: () => boolean | Promise<boolean>;
}

export interface AccessiHealthCheckResult {
  ok: boolean;
  detail?: string;
}

export interface AccessiReadinessReport {
  status: 'ok' | 'error';
  checks: Record<string, AccessiHealthCheckResult>;
  timestamp: string;
}

export interface AccessiLiveReport {
  status: 'ok';
  uptimeSeconds: number;
}

/** Store condivisi con health check, senza duplicati. */
export interface AccessiHealthStore {
  name: string;
  store: { healthCheck?: () => Promise<boolean> };
}

export interface AccessiReadinessDependencies {
  /** Override del check database (usato dai test o da host con pool esterni). */
  databaseVersion?: (options: AccessiOptions) => Promise<string | null | undefined>;
}

/** Stato liveness: il processo risponde, nessun accesso a DB o store. */
export function createAccessiLiveReport(): AccessiLiveReport {
  return { status: 'ok', uptimeSeconds: Math.floor(process.uptime()) };
}

/** Store con health check configurati nelle opzioni Accessi. */
export function collectAccessiHealthStores(options: AccessiOptions): AccessiHealthStore[] {
  const stores: AccessiHealthStore[] = [];
  const seen = new Set<unknown>();

  const add = (name: string, store: { healthCheck?: () => Promise<boolean> } | undefined): void => {
    if (!store || seen.has(store) || typeof store.healthCheck !== 'function') return;
    seen.add(store);
    stores.push({ name, store });
  };

  add('publicAuthRateLimit', options.publicAuthRateLimit?.store);
  add('serviceTokenRateLimit', options.serviceTokens?.rateLimitStore);
  add('consoleEntry', options.consoleEntry?.store);
  add('edgeRateLimit', options.edgeRateLimit?.store);
  add('sessionRevocation', options.sessionRevocation?.store);
  add('accessTokenRevocation', options.accessTokenRevocation?.store);
  add('refreshTokenRotation', options.refreshTokenRotation?.store);
  return stores;
}

/** Verifica che lo schema Accessi sia inizializzato e alla versione attesa. */
export async function checkAccessiDatabase(
  options: AccessiOptions,
  resolveVersion: AccessiReadinessDependencies['databaseVersion'] = (value) =>
    AccessiDatabaseUpdater.getCurrentVersion(value),
): Promise<AccessiHealthCheckResult> {
  try {
    const version = await resolveVersion(options);
    if (!version) {
      return { ok: false, detail: 'schema Accessi non inizializzato' };
    }
    return {
      ok: true,
      detail: version === ACCESSI_SCHEMA_VERSION ? version : `${version} (atteso ${ACCESSI_SCHEMA_VERSION})`,
    };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Report di readiness con lo stesso formato del servizio standalone.
 *
 * `bootstrap` e considerato completato: chi chiama questa funzione ha gia
 * inizializzato il modulo. Il servizio standalone mantiene il proprio stato di
 * bootstrap prima di delegare qui.
 */
export async function checkAccessiReadiness(
  options: AccessiOptions,
  readinessChecks: AccessiReadinessCheck[] = [],
  dependencies: AccessiReadinessDependencies = {},
): Promise<AccessiReadinessReport> {
  const checks: Record<string, AccessiHealthCheckResult> = {
    bootstrap: { ok: true },
    database: await checkAccessiDatabase(options, dependencies.databaseVersion),
  };

  const stores = collectAccessiHealthStores(options);
  await Promise.all(stores.map(async ({ name, store }) => {
    try {
      checks[name] = { ok: Boolean(await store.healthCheck?.()) };
    } catch (error) {
      checks[name] = {
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }));

  for (const check of readinessChecks) {
    try {
      checks[check.name] = { ok: Boolean(await check.check()) };
    } catch (error) {
      checks[check.name] = {
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }

  const ok = Object.values(checks).every((check) => check.ok);
  return {
    status: ok ? 'ok' : 'error',
    checks,
    timestamp: new Date().toISOString(),
  };
}

/** Status HTTP da usare per un report di readiness: 200 o 503. */
export function readinessHttpStatus(report: AccessiReadinessReport): 200 | 503 {
  return report.status === 'ok' ? 200 : 503;
}
