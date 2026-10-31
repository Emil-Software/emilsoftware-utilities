import { createHash } from 'crypto';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import type { AccessiTenant, AccessiTenantRegistry } from './tenants';
import { loadAccessiTenants } from './tenants';

/** Handle minimo di un processo figlio (compatibile con `child_process.ChildProcess`). */
export interface AccessiTenantProcessHandle {
  readonly pid?: number;
  kill(signal?: NodeJS.Signals | number): boolean;
  once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
}

export type AccessiTenantSpawn = (tenant: AccessiTenant, port: number) => AccessiTenantProcessHandle;

export interface AccessiTenantSupervisorLoggerEvent {
  level: 'info' | 'warn' | 'error';
  message: string;
}

export interface AccessiTenantSupervisorOptions {
  directory: string;
  basePort: number;
  spawn: AccessiTenantSpawn;
  allowHeader?: boolean;
  /** Intervallo di polling della cartella quando `watch()` e attivo. Default 1000 ms. */
  pollIntervalMs?: number;
  /** Attesa prima di applicare un reload dopo una modifica. Default 200 ms. */
  debounceMs?: number;
  /** Timeout per SIGTERM prima di SIGKILL. Default 5000 ms. */
  stopTimeoutMs?: number;
  logger?: (event: AccessiTenantSupervisorLoggerEvent) => void;
}

export interface AccessiTenantSupervisorState {
  id: string;
  port: number;
  file: string;
  signature: string;
}

export interface AccessiTenantReloadResult {
  added: string[];
  removed: string[];
  restarted: string[];
  unchanged: string[];
}

export interface AccessiTenantSupervisor {
  start(): Promise<void>;
  reload(): Promise<AccessiTenantReloadResult>;
  stop(): Promise<void>;
  state(): AccessiTenantSupervisorState[];
  watch(): void;
  unwatch(): void;
}

interface RunningTenant {
  tenant: AccessiTenant;
  port: number;
  signature: string;
  process: AccessiTenantProcessHandle;
}

const ENVIRONMENT_FILE = /\.environment\.(ts|mts|cts|js|mjs|cjs)$/;

function fileSignature(file: string): string {
  try {
    return createHash('sha256').update(readFileSync(file)).digest('hex');
  } catch {
    return 'unreadable';
  }
}

/** Firma della cartella: file + contenuto, ordinata per nome. */
export function accessiTenantDirectorySignature(directory: string): string {
  let files: string[];
  try {
    files = readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && ENVIRONMENT_FILE.test(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    return `error:${error instanceof Error ? error.message : String(error)}`;
  }
  return createHash('sha256')
    .update(files.map((file) => `${file}:${fileSignature(join(directory, file))}`).join('|'))
    .digest('hex');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function stopProcess(
  handle: AccessiTenantProcessHandle,
  timeoutMs: number,
): Promise<void> {
  await new Promise<void>((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    handle.once('exit', done);
    try {
      if (!handle.kill('SIGTERM')) done();
    } catch {
      done();
    }
    const timer = setTimeout(() => {
      if (settled) return;
      try {
        handle.kill('SIGKILL');
      } catch {
        // Il processo potrebbe essere gia terminato.
      }
      done();
    }, Math.max(50, timeoutMs));
    if (typeof timer.unref === 'function') timer.unref();
  });
}

/**
 * Supervisore multi-tenant: avvia un processo per tenant e, con `watch()`,
 * riapplica la configurazione quando i file `*.environment.ts` cambiano.
 *
 * Regole di reload:
 * - un file invalido non tocca i tenant attivi;
 * - i tenant invariati non vengono riavviati;
 * - aggiunte/rimozioni/modifiche producono spawn/stop/restart;
 * - la porta di un tenant esistente non cambia durante un restart.
 */
export function createAccessiTenantSupervisor(
  options: AccessiTenantSupervisorOptions,
): AccessiTenantSupervisor {
  if (!options?.directory) throw new Error('createAccessiTenantSupervisor: directory obbligatoria.');
  if (!Number.isInteger(options.basePort) || options.basePort < 1) {
    throw new Error('createAccessiTenantSupervisor: basePort non valida.');
  }
  if (typeof options.spawn !== 'function') {
    throw new Error('createAccessiTenantSupervisor: spawn obbligatorio.');
  }

  const log = options.logger ?? (() => undefined);
  const running = new Map<string, RunningTenant>();
  let lastSignature = '';
  let watchTimer: NodeJS.Timeout | undefined;
  let reloading = false;
  let stopping = false;
  let pendingReload: NodeJS.Timeout | undefined;

  const nextPort = (): number => {
    const used = new Set([...running.values()].map((entry) => entry.port));
    let port = options.basePort;
    while (used.has(port)) port += 1;
    return port;
  };

  const spawnTenant = (tenant: AccessiTenant, port: number, signature: string): RunningTenant | undefined => {
    try {
      const process = options.spawn(tenant, port);
      return { tenant, port, signature, process };
    } catch (error) {
      log({
        level: 'error',
        message: `Avvio tenant ${tenant.id} fallito: ${error instanceof Error ? error.message : String(error)}`,
      });
      return undefined;
    }
  };

  const load = (): { registry: AccessiTenantRegistry; signatures: Map<string, string> } => {
    const registry = loadAccessiTenants({
      directory: options.directory,
      ...(options.allowHeader !== undefined ? { allowHeader: options.allowHeader } : {}),
    });
    const signatures = new Map<string, string>();
    for (const tenant of registry.tenants) {
      signatures.set(tenant.id, fileSignature(tenant.environmentFile));
    }
    return { registry, signatures };
  };

  const remove = async (id: string): Promise<void> => {
    const entry = running.get(id);
    if (!entry) return;
    running.delete(id);
    log({ level: 'info', message: `Stop tenant ${id} (porta ${entry.port}).` });
    await stopProcess(entry.process, options.stopTimeoutMs ?? 5000);
  };

  const startTenant = (tenant: AccessiTenant, signatures: Map<string, string>, port?: number): boolean => {
    const assignedPort = port ?? tenant.port ?? nextPort();
    if ([...running.values()].some((entry) => entry.port === assignedPort)) {
      log({ level: 'error', message: `Porta ${assignedPort} gia in uso: tenant ${tenant.id} non avviato.` });
      return false;
    }
    const entry = spawnTenant(tenant, assignedPort, signatures.get(tenant.id) ?? '');
    if (!entry) return false;
    running.set(tenant.id, entry);
    log({
      level: 'info',
      message: `Avvio tenant ${tenant.id} sulla porta ${assignedPort} (pid ${entry.process.pid ?? '?'}).`,
    });
    return true;
  };

  const apply = async (registry: AccessiTenantRegistry, signatures: Map<string, string>): Promise<AccessiTenantReloadResult> => {
    const desired = new Map(registry.tenants.filter((tenant) => tenant.enabled).map((tenant) => [tenant.id, tenant]));
    const result: AccessiTenantReloadResult = { added: [], removed: [], restarted: [], unchanged: [] };

    for (const id of [...running.keys()]) {
      if (!desired.has(id)) {
        await remove(id);
        result.removed.push(id);
      }
    }

    for (const [id, tenant] of desired) {
      const current = running.get(id);
      if (!current) {
        if (startTenant(tenant, signatures)) result.added.push(id);
        continue;
      }
      const signature = signatures.get(id) ?? '';
      if (signature === current.signature) {
        result.unchanged.push(id);
        continue;
      }

      // Riavvio sulla stessa porta: il proxy non cambia configurazione.
      const port = current.port;
      await remove(id);
      if (startTenant(tenant, signatures, port)) result.restarted.push(id);
    }

    return result;
  };

  const unwatch = (): void => {
    if (watchTimer) clearInterval(watchTimer);
    if (pendingReload) clearTimeout(pendingReload);
    watchTimer = undefined;
    pendingReload = undefined;
  };

  const reload = async (): Promise<AccessiTenantReloadResult> => {
    if (reloading || stopping) return { added: [], removed: [], restarted: [], unchanged: [] };
    reloading = true;
    try {
      const signature = accessiTenantDirectorySignature(options.directory);
      let loaded;
      try {
        loaded = load();
      } catch (error) {
        log({
          level: 'error',
          message: `Reload annullato, configurazione non valida: ${error instanceof Error ? error.message : String(error)}`,
        });
        lastSignature = signature;
        return { added: [], removed: [], restarted: [], unchanged: [] };
      }
      const result = await apply(loaded.registry, loaded.signatures);
      lastSignature = signature;
      log({
        level: 'info',
        message: `Reload tenant: +${result.added.length} -${result.removed.length} ~${result.restarted.length} =${result.unchanged.length}.`,
      });
      return result;
    } finally {
      reloading = false;
    }
  };

  const stop = async (): Promise<void> => {
    if (stopping) return;
    stopping = true;
    unwatch();
    await Promise.all([...running.keys()].map((id) => remove(id)));
  };

  const watch = (): void => {
    if (watchTimer) return;
    const interval = Math.max(100, options.pollIntervalMs ?? 1000);
    const debounce = Math.max(0, options.debounceMs ?? 200);
    watchTimer = setInterval(() => {
      if (stopping || reloading) return;
      const signature = accessiTenantDirectorySignature(options.directory);
      if (signature === lastSignature) return;
      if (pendingReload) clearTimeout(pendingReload);
      pendingReload = setTimeout(() => {
        pendingReload = undefined;
        void reload();
      }, debounce);
    }, interval);
    if (typeof watchTimer.unref === 'function') watchTimer.unref();
    log({ level: 'info', message: `Watch attivo su ${options.directory} (${interval} ms).` });
  };

  return {
    async start() {
      const { registry, signatures } = load();
      lastSignature = accessiTenantDirectorySignature(options.directory);
      await apply(registry, signatures);
      for (const tenant of registry.tenants.filter((entry) => !entry.enabled)) {
        log({ level: 'info', message: `Tenant ${tenant.id} disabilitato: non avviato.` });
      }
    },
    reload,
    stop,
    state() {
      return [...running.values()].map((entry) => ({
        id: entry.tenant.id,
        port: entry.port,
        file: entry.tenant.file,
        signature: entry.signature,
      }));
    },
    watch,
    unwatch,
  };
}

/** Attende che una condizione diventi vera (utile nei test e nei runbook). */
export async function waitForTenantState(
  supervisor: AccessiTenantSupervisor,
  predicate: (state: AccessiTenantSupervisorState[]) => boolean,
  timeoutMs = 5000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate(supervisor.state())) {
    if (Date.now() > deadline) throw new Error('timeout in attesa dello stato tenant');
    await delay(25);
  }
}
