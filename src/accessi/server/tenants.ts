import { readdirSync, readFileSync } from 'fs';
import { basename, join, resolve } from 'path';
import type { AccessiOptions } from '../../accessi-module/AccessiModule';
import { createAccessiOptionsFromEnv } from '../../accessi-module/database-updates/accessiOptionsFromEnv';

/** Variabili usate dal manifest del tenant (oltre alle normali `ACCESSI_*`). */
export interface AccessiTenantEnv extends NodeJS.ProcessEnv {
  ACCESSI_TENANT_ID?: string;
  /** Host separati da virgola; supporta `*.example.com`. */
  ACCESSI_TENANT_HOSTS?: string;
  /** Prefisso path, es. `/tenant-a`. */
  ACCESSI_TENANT_PATH?: string;
  ACCESSI_TENANT_ENABLED?: string;
  /** Porta del servizio quando si usa `startAccessiTenants`. */
  ACCESSI_TENANT_PORT?: string;
  ACCESSI_TENANT_DESCRIPTION?: string;
}

export interface AccessiTenant {
  id: string;
  hosts: string[];
  path?: string;
  enabled: boolean;
  description?: string;
  port?: number;
  /** Nome del file `.env` di origine (mai il contenuto). */
  file: string;
  /** Variabili risolte del tenant (base + file); non serializzarle nei log. */
  env: NodeJS.ProcessEnv;
  options: AccessiOptions;
}

export interface AccessiTenantSummary {
  id: string;
  hosts: string[];
  path?: string;
  enabled: boolean;
  description?: string;
  port?: number;
  file: string;
  database: {
    host?: string;
    port?: number;
    database?: string;
    user?: string;
  };
  issuer?: string;
  audience?: string;
  jwtAlgorithm: string;
  refreshEnabled: boolean;
}

export interface AccessiTenantResolution {
  tenant: AccessiTenant;
  matchedBy: 'host' | 'path' | 'header';
}

export interface AccessiTenantRegistry {
  directory: string;
  tenants: AccessiTenant[];
  warnings: string[];
  allowHeader: boolean;
  byId: ReadonlyMap<string, AccessiTenant>;
  resolve(input: { host?: string; path?: string; header?: string }, options?: { allowHeader?: boolean }): AccessiTenantResolution | undefined;
  summary(): AccessiTenantSummary[];
}

export interface LoadAccessiTenantsOptions {
  /** Cartella con `<tenant>.env`. */
  directory: string;
  /** Variabili base (default `process.env`); il file tenant vince. */
  env?: NodeJS.ProcessEnv;
  /** Abilita la risoluzione via header `x-accessi-tenant`. Default: false. */
  allowHeader?: boolean;
  /** Consente issuer/audience uguali tra tenant (sconsigliato). Default: false. */
  allowSharedIssuer?: boolean;
}

/** Errore aggregato di configurazione tenant. */
export class AccessiTenantConfigurationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Configurazione tenant non valida:\n${issues.map((issue) => `- ${issue}`).join('\n')}`);
    this.name = 'AccessiTenantConfigurationError';
    this.issues = issues;
  }
}

/**
 * Parser minimale di un file `.env`.
 *
 * Supporta commenti, `export KEY=...`, valori tra apici singoli o doppi e le
 * sequenze `\n`, `\r`, `\t`, `\"` e `\\` nei valori tra doppi apici. Non
 * interpreta variabili annidate: la configurazione tenant deve restare esplicita.
 */
export function parseAccessiTenantEnvFile(content: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) throw new Error(`Riga .env non valida: "${rawLine}"`);
    const key = match[1] ?? '';
    let value = match[2] ?? '';
    if (value.startsWith('"')) {
      if (!value.endsWith('"') || value.length < 2) throw new Error(`${key}: virgolette non chiuse.`);
      value = value.slice(1, -1)
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '\r')
        .replace(/\\t/g, '\t')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
    } else if (value.startsWith("'")) {
      if (!value.endsWith("'") || value.length < 2) throw new Error(`${key}: virgolette non chiuse.`);
      value = value.slice(1, -1);
    } else {
      const comment = value.indexOf(' #');
      if (comment >= 0) value = value.slice(0, comment);
      value = value.trim();
    }
    env[key] = value;
  }
  return env;
}

function splitList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
}

function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/\.$/, '');
}

function normalizeTenantPath(path: string | undefined): string | undefined {
  if (path === undefined || path.trim() === '') return undefined;
  const normalized = `/${path.trim().replace(/^\/+|\/+$/g, '')}`;
  return normalized === '/' ? '/' : normalized;
}

function matchesHost(tenant: AccessiTenant, host: string): boolean {
  return tenant.hosts.some((candidate) => {
    if (candidate === host) return true;
    if (candidate.startsWith('*.')) {
      const suffix = candidate.slice(1);
      return host.endsWith(suffix) && host.length > suffix.length;
    }
    return false;
  });
}

function matchesPath(tenant: AccessiTenant, path: string): boolean {
  if (!tenant.path) return false;
  if (tenant.path === '/') return true;
  return path === tenant.path || path.startsWith(`${tenant.path}/`);
}

/** Prefisso Redis consigliato per isolare gli store del tenant. */
export function getAccessiTenantRedisPrefix(tenantId: string): string {
  return `accessi:${tenantId}:`;
}

function tenantSummary(tenant: AccessiTenant): AccessiTenantSummary {
  const database = tenant.options.databaseOptions as {
    host?: string;
    port?: number;
    database?: string;
    user?: string;
  };
  return {
    id: tenant.id,
    hosts: [...tenant.hosts],
    ...(tenant.path ? { path: tenant.path } : {}),
    enabled: tenant.enabled,
    ...(tenant.description ? { description: tenant.description } : {}),
    ...(tenant.port ? { port: tenant.port } : {}),
    file: tenant.file,
    database: {
      host: database.host,
      port: database.port,
      database: database.database,
      user: database.user,
    },
    issuer: tenant.options.jwtOptions.issuer,
    ...(tenant.options.jwtOptions.audience
      ? { audience: typeof tenant.options.jwtOptions.audience === 'string' ? tenant.options.jwtOptions.audience : tenant.options.jwtOptions.audience.join(',') }
      : {}),
    jwtAlgorithm: tenant.options.jwtOptions.algorithm ?? 'HS256',
    refreshEnabled: Boolean(tenant.options.jwtOptions.refreshExpiresIn),
  };
}

/**
 * Carica i tenant da una cartella di file `<id>.env`.
 *
 * Non modifica `process.env`: ogni tenant riceve una copia isolata delle
 * variabili. Un errore in un file blocca l'intero caricamento, cosi non si
 * avvia un tenant con configurazione parziale.
 */
export function loadAccessiTenants(options: LoadAccessiTenantsOptions): AccessiTenantRegistry {
  if (!options?.directory) throw new Error('loadAccessiTenants: directory obbligatoria.');
  const directory = resolve(options.directory);
  const baseEnv = options.env ?? process.env;
  const issues: string[] = [];
  const warnings: string[] = [];

  let files: string[];
  try {
    files = readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.env'))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    throw new AccessiTenantConfigurationError([
      `Cartella tenant non leggibile (${directory}): ${error instanceof Error ? error.message : String(error)}`,
    ]);
  }
  if (files.length === 0) {
    throw new AccessiTenantConfigurationError([`Nessun file .env nella cartella ${directory}.`]);
  }

  const tenants: AccessiTenant[] = [];
  for (const file of files) {
    let fileEnv: Record<string, string>;
    try {
      fileEnv = parseAccessiTenantEnvFile(readFileSync(join(directory, file), 'utf8'));
    } catch (error) {
      issues.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }

    const env: NodeJS.ProcessEnv = { ...baseEnv, ...fileEnv };
    const id = (env.ACCESSI_TENANT_ID ?? basename(file, '.env')).trim();
    if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(id)) {
      issues.push(`${file}: ACCESSI_TENANT_ID "${id}" non valido (minuscole, numeri, - e _, max 63).`);
      continue;
    }
    const hosts = splitList(env.ACCESSI_TENANT_HOSTS).map(normalizeHost);
    const path = normalizeTenantPath(env.ACCESSI_TENANT_PATH);
    if (hosts.length === 0 && !path) {
      issues.push(`${file}: configurare ACCESSI_TENANT_HOSTS oppure ACCESSI_TENANT_PATH.`);
      continue;
    }
    const portValue = env.ACCESSI_TENANT_PORT;
    const port = portValue ? Number(portValue) : undefined;
    if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) {
      issues.push(`${file}: ACCESSI_TENANT_PORT non valida ("${portValue}").`);
      continue;
    }

    try {
      const accessiOptions = createAccessiOptionsFromEnv(env);
      tenants.push({
        id,
        hosts,
        ...(path ? { path } : {}),
        enabled: env.ACCESSI_TENANT_ENABLED !== 'false',
        ...(env.ACCESSI_TENANT_DESCRIPTION ? { description: env.ACCESSI_TENANT_DESCRIPTION } : {}),
        ...(port ? { port } : {}),
        file,
        env,
        options: { ...accessiOptions, tenantId: id },
      });
    } catch (error) {
      issues.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const byId = new Map<string, AccessiTenant>();
  const hostsSeen = new Map<string, string>();
  const pathsSeen = new Map<string, string>();
  const jwtSecrets = new Map<string, string>();
  const issuerAudience = new Map<string, string>();
  for (const tenant of tenants) {
    if (byId.has(tenant.id)) {
      issues.push(`Tenant duplicato "${tenant.id}" (${tenant.file} e ${byId.get(tenant.id)?.file}).`);
    } else {
      byId.set(tenant.id, tenant);
    }
    for (const host of tenant.hosts) {
      const existing = hostsSeen.get(host);
      if (existing) issues.push(`Host "${host}" assegnato a "${existing}" e "${tenant.id}".`);
      else hostsSeen.set(host, tenant.id);
    }
    if (tenant.path) {
      const existing = pathsSeen.get(tenant.path);
      if (existing) issues.push(`Path "${tenant.path}" assegnato a "${existing}" e "${tenant.id}".`);
      else pathsSeen.set(tenant.path, tenant.id);
    }

    // Un segreto JWT condiviso rende un token valido su piu tenant.
    const signingKey = tenant.options.jwtOptions.privateKey ?? tenant.options.jwtOptions.secret;
    const fingerprintKey = `${tenant.options.jwtOptions.algorithm ?? 'HS256'}|${signingKey}`;
    const existingKey = jwtSecrets.get(fingerprintKey);
    if (existingKey) {
      issues.push(`Chiave JWT condivisa tra "${existingKey}" e "${tenant.id}": usare segreti distinti.`);
    } else {
      jwtSecrets.set(fingerprintKey, tenant.id);
    }

    const issuer = tenant.options.jwtOptions.issuer ?? '(assente)';
    const audience = Array.isArray(tenant.options.jwtOptions.audience)
      ? tenant.options.jwtOptions.audience.join(',')
      : (tenant.options.jwtOptions.audience ?? '(assente)');
    const issuerKey = `${issuer}|${audience}`;
    const existingIssuer = issuerAudience.get(issuerKey);
    if (existingIssuer && options.allowSharedIssuer !== true) {
      warnings.push(`Issuer/audience "${issuerKey}" condivisi tra "${existingIssuer}" e "${tenant.id}".`);
    } else {
      issuerAudience.set(issuerKey, tenant.id);
    }
  }

  const enabled = tenants.filter((tenant) => tenant.enabled);
  if (enabled.length > 1) {
    const defaultTenant = enabled.find((tenant) => tenant.hosts.length === 0 && tenant.path === '/');
    if (defaultTenant) {
      issues.push(`Tenant "${defaultTenant.id}" intercetta tutte le richieste (path "/") insieme ad altri tenant.`);
    }
  }

  if (issues.length > 0) throw new AccessiTenantConfigurationError(issues);

  const registry: AccessiTenantRegistry = {
    directory,
    tenants,
    warnings,
    allowHeader: options.allowHeader === true,
    byId,
    resolve(input, resolveOptions) {
      const allowHeader = resolveOptions?.allowHeader ?? registry.allowHeader;
      const host = input.host ? normalizeHost(input.host.split(':')[0] ?? input.host) : undefined;
      if (host) {
        const byHost = enabled.find((tenant) => matchesHost(tenant, host));
        if (byHost) return { tenant: byHost, matchedBy: 'host' };
      }

      const requestPath = input.path ?? '/';
      const byPath = enabled
        .filter((tenant) => matchesPath(tenant, requestPath))
        .sort((left, right) => (right.path?.length ?? 0) - (left.path?.length ?? 0))[0];
      if (byPath && byPath.path !== '/') return { tenant: byPath, matchedBy: 'path' };

      if (allowHeader && input.header) {
        const headerId = input.header.trim().toLowerCase();
        const tenant = byId.get(headerId);
        if (tenant?.enabled) return { tenant, matchedBy: 'header' };
      }

      if (byPath) return { tenant: byPath, matchedBy: 'path' };
      return undefined;
    },
    summary() {
      return tenants.map(tenantSummary);
    },
  };

  return registry;
}

