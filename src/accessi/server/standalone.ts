import express from 'express';
import type { Application, Request, Response } from 'express';
import type { Server } from 'http';
import { Logger } from '../../Logger';
import { Orm } from '../../Orm';
import { initializeAccessiModule } from '../../accessi-module';
import type {
  AccessiModuleInitializationResult,
} from '../../accessi-module';
import type { AccessiOptions } from '../../accessi-module/AccessiModule';
import { createAccessiOptionsFromEnv } from '../../accessi-module/database-updates/accessiOptionsFromEnv';
import {
  ACCESSI_SCHEMA_VERSION,
} from '../../accessi-module/database-updates/accessiSchema';
import { AccessiDatabaseUpdater } from '../../accessi-module/database-updates/AccessiDatabaseUpdater';
import { assertValidAccessiOptions, validateAccessiOptions } from '../../accessi-module/security/validateOptions';

export interface AccessiReadinessCheck {
  name: string;
  check: () => boolean | Promise<boolean>;
}

export interface AccessiServiceOptions {
  /** Applicazione Express gia esistente. Default: nuova app. */
  app?: Application;
  /** Configurazione completa. Default: `createAccessiOptionsFromEnv()`. */
  accessiOptions?: AccessiOptions;
  port?: number;
  host?: string;
  /** Path base degli endpoint health. Default: `/health`. */
  healthPath?: string;
  /** Espone `/health/metrics` in formato Prometheus. Default: true. */
  metrics?: boolean;
  /** Check aggiuntivi per la readiness. */
  readinessChecks?: AccessiReadinessCheck[];
  /** Timeout chiusura server. Default: 10000 ms. */
  shutdownTimeoutMs?: number;
}

export interface AccessiService {
  app: Application;
  nestApp: AccessiModuleInitializationResult['nestApp'];
  document: AccessiModuleInitializationResult['document'];
  start(): Promise<Server>;
  stop(): Promise<void>;
}

interface HealthCheckResult {
  ok: boolean;
  detail?: string;
}

function normalizePath(value: string): string {
  return `/${value.replace(/^\/+|\/+$/g, '')}`;
}

function createMetrics() {
  const startedAt = Date.now();
  let requests = 0;
  let inFlight = 0;
  const statuses = new Map<string, number>();

  const middleware = (_req: Request, res: Response, next: () => void): void => {
    requests += 1;
    inFlight += 1;
    res.on('finish', () => {
      inFlight = Math.max(0, inFlight - 1);
      const status = String(res.statusCode);
      statuses.set(status, (statuses.get(status) ?? 0) + 1);
    });
    next();
  };

  const render = (): string => {
    const memory = process.memoryUsage();
    const lines = [
      '# HELP accessi_http_requests_total Richieste HTTP totali.',
      '# TYPE accessi_http_requests_total counter',
      ...[...statuses.entries()].map(
        ([status, count]) => `accessi_http_requests_total{status="${status}"} ${count}`,
      ),
      '# HELP accessi_http_in_flight Richieste HTTP in corso.',
      '# TYPE accessi_http_in_flight gauge',
      `accessi_http_in_flight ${inFlight}`,
      '# HELP accessi_process_uptime_seconds Uptime del processo.',
      '# TYPE accessi_process_uptime_seconds gauge',
      `accessi_process_uptime_seconds ${Math.floor((Date.now() - startedAt) / 1000)}`,
      '# HELP accessi_process_memory_bytes Memoria del processo.',
      '# TYPE accessi_process_memory_bytes gauge',
      `accessi_process_memory_bytes{type="rss"} ${memory.rss}`,
      `accessi_process_memory_bytes{type="heapUsed"} ${memory.heapUsed}`,
      `accessi_process_memory_bytes{type="heapTotal"} ${memory.heapTotal}`,
      '# HELP accessi_http_requests_started_total Richieste HTTP avviate.',
      '# TYPE accessi_http_requests_started_total counter',
      `accessi_http_requests_started_total ${requests}`,
    ];
    return `${lines.join('\n')}\n`;
  };

  return { middleware, render };
}

function collectHealthStores(options: AccessiOptions): Array<{ name: string; store: { healthCheck?: () => Promise<boolean> } }> {
  const stores: Array<{ name: string; store: { healthCheck?: () => Promise<boolean> } }> = [];
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

async function checkDatabase(options: AccessiOptions): Promise<HealthCheckResult> {
  try {
    const version = await AccessiDatabaseUpdater.getCurrentVersion(options);
    if (!version) {
      return { ok: false, detail: 'schema Accessi non inizializzato' };
    }
    return {
      ok: true,
      detail: version === ACCESSI_SCHEMA_VERSION
        ? version
        : `${version} (atteso ${ACCESSI_SCHEMA_VERSION})`,
    };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Crea un servizio Accessi standalone con health, readiness, metriche e shutdown.
 *
 * Non apre la porta finche non viene chiamato `start()`.
 */
export async function createAccessiService(
  options: AccessiServiceOptions = {},
): Promise<AccessiService> {
  const logger = new Logger('AccessiService');
  const accessiOptions = options.accessiOptions ?? createAccessiOptionsFromEnv();
  assertValidAccessiOptions(accessiOptions);
  for (const warning of validateAccessiOptions(accessiOptions).warnings) {
    logger.warning(`Configurazione Accessi: ${warning.code} - ${warning.message}`);
  }

  const app = options.app ?? express();
  const healthPath = normalizePath(options.healthPath ?? '/health');
  const metrics = createMetrics();
  const readinessChecks = options.readinessChecks ?? [];
  let initialized = false;
  let nestApp: AccessiModuleInitializationResult['nestApp'] | undefined;
  let document: AccessiModuleInitializationResult['document'] | undefined;
  let server: Server | undefined;
  let stopping = false;

  app.use(metrics.middleware);

  app.get(`${healthPath}/live`, (_req: Request, res: Response) => {
    res.status(200).json({
      status: 'ok',
      uptimeSeconds: Math.floor(process.uptime()),
    });
  });

  app.get(`${healthPath}/ready`, async (_req: Request, res: Response) => {
    if (!initialized || !nestApp) {
      res.status(503).json({
        status: 'error',
        checks: { bootstrap: { ok: false, detail: 'bootstrap non completato' } },
      });
      return;
    }

    const checks: Record<string, HealthCheckResult> = {
      bootstrap: { ok: true },
      database: await checkDatabase(accessiOptions),
    };

    const stores = collectHealthStores(accessiOptions);
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
        const ok = await check.check();
        checks[check.name] = { ok: Boolean(ok) };
      } catch (error) {
        checks[check.name] = {
          ok: false,
          detail: error instanceof Error ? error.message : String(error),
        };
      }
    }

    const ok = Object.values(checks).every((check) => check.ok);
    res.status(ok ? 200 : 503).json({
      status: ok ? 'ok' : 'error',
      checks,
      timestamp: new Date().toISOString(),
    });
  });

  if (options.metrics !== false) {
    app.get(`${healthPath}/metrics`, (_req: Request, res: Response) => {
      res.setHeader('Content-Type', 'text/plain; version=0.0.4');
      res.status(200).send(metrics.render());
    });
  }

  const result = await initializeAccessiModule(app, accessiOptions);
  nestApp = result.nestApp;
  document = result.document;
  initialized = true;

  const stop = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    const timeout = Math.max(1_000, options.shutdownTimeoutMs ?? 10_000);
    await Promise.race([
      new Promise<void>((resolve) => {
        if (!server) return resolve();
        server.close(() => resolve());
      }),
      new Promise<void>((resolve) => setTimeout(resolve, timeout)),
    ]);
    try {
      await nestApp?.close();
    } finally {
      await Orm.closePools();
    }
  };

  const start = async (): Promise<Server> => {
    if (server) return server;
    const port = options.port ?? Number(process.env.PORT ?? 3000);
    server = await new Promise<Server>((resolve, reject) => {
      const listener = options.host
        ? app.listen(port, options.host, () => resolve(listener))
        : app.listen(port, () => resolve(listener));
      listener.once('error', reject);
    });
    const address = server.address();
    const actualPort = typeof address === 'object' && address ? address.port : port;
    logger.info(`Accessi Service in ascolto su http://${options.host ?? '0.0.0.0'}:${actualPort}`);
    return server;
  };

  return {
    app,
    get nestApp() {
      if (!nestApp) throw new Error('Accessi Service non inizializzato.');
      return nestApp;
    },
    get document() {
      if (!document) throw new Error('Documento OpenAPI non disponibile.');
      return document;
    },
    start,
    stop,
  };
}

/**
 * Avvia Accessi Service e registra SIGTERM/SIGINT per lo shutdown graceful.
 */
export async function startAccessiService(options: AccessiServiceOptions = {}): Promise<AccessiService> {
  const service = await createAccessiService(options);
  await service.start();

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    new Logger('AccessiService').info(`Ricevuto ${signal}: arresto in corso.`);
    await service.stop();
  };

  process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
  process.once('SIGINT', () => { void shutdown('SIGINT'); });
  return service;
}
