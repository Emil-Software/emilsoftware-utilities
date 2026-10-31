import { readdirSync } from 'fs';
import { basename, join, resolve } from 'path';
import { WIRE_CRYPT_DISABLE, WIRE_CRYPT_ENABLE } from 'node-firebird';
import type { Options } from 'node-firebird';
import type {
  AccessiOptions,
  AccessiHttpOptions,
  AdminBootstrapOptions,
  CatalogScriptsOptions,
  ConsoleEntryOptions,
  EmailOptions,
  ExtensionFieldsOptions,
  FederatedAuthenticationOptions,
  JwtOptions,
  PublicAuthRateLimitOptions,
  PublicRegistrationOptions,
  ServiceTokenOptions,
  SystemSeedsOptions,
} from '../../accessi-module/AccessiModule';
import type { AccessiEdgeRateLimitOptions } from '../../accessi-module/security/edgeRateLimit';
import type { AccessiAuthCookieOptions } from '../../accessi-module/security/authCookies';
import type { AccessiMetricsOptions } from '../../accessi-module/observability/metrics';
import type { AccessiAuditOptions } from '../../accessi-module/security/audit';
import type { SessionRevocationOptions } from '../../accessi-module/security/sessionRevocation';
import type { AccessTokenRevocationOptions } from '../../accessi-module/security/accessTokenRevocation';
import type { RefreshTokenRotationOptions } from '../../accessi-module/security/refreshTokenRotation';
import type { OpenApiSetupOptions } from '../../openapi/OpenApiConfig';
import { validateAccessiOptions } from '../../accessi-module/security/validateOptions';

/** Identita e routing del tenant. */
export interface AccessiTenantSettings {
  /** Minuscole, numeri, `-` e `_`; max 63 caratteri. */
  id: string;
  /** Host esatti o wildcard `*.example.com`. */
  hosts?: string[];
  /** Prefisso path, es. `/acme`. */
  path?: string;
  /** Porta del processo quando si usa il supervisore. */
  port?: number;
  /** Default `true`. */
  enabled?: boolean;
  description?: string;
}

/** Connessione Firebird del tenant, tipizzata senza callback. */
export interface AccessiTenantDatabaseOptions {
  host: string;
  port?: number;
  database: string;
  user?: string;
  password?: string;
  /** `disabled`/`optional`; `required` e il default del driver. */
  wireCrypt?: 'required' | 'optional' | 'disabled';
  pluginName?: string;
}

/**
 * Configurazione serializzabile di un tenant.
 *
 * I campi che contengono store, callback o logger (`store`, `sink`, `match`,
 * `onDocument`, `logger`, ...) sono esclusi: vanno collegati dal backend
 * ospitante, non da un file di configurazione.
 */
export interface AccessiTenantEnvironment {
  tenant: AccessiTenantSettings;
  database: AccessiTenantDatabaseOptions;
  jwt: JwtOptions;
  email: EmailOptions;
  encryptionKey: string;
  confirmationEmailUrl: string;
  confirmationEmailReturnUrl: string;
  confirmationEmailPrefix?: string;
  customResetPage?: string;
  publicBaseUrl?: string;
  consoleApiBaseUrl?: string;
  mockDemoUser?: boolean;
  passwordExpiration?: boolean;
  passwordExpirationDays?: number;
  legacyPasswordMigrationOnStartup?: boolean;
  autoUpdateDatabase?: boolean;
  http?: AccessiHttpOptions;
  authCookie?: AccessiAuthCookieOptions;
  publicAuthRateLimit?: Omit<PublicAuthRateLimitOptions, 'store'>;
  publicRegistration?: PublicRegistrationOptions;
  federatedAuthentication?: FederatedAuthenticationOptions;
  extensionFieldsOptions?: ExtensionFieldsOptions[];
  serviceTokens?: Omit<ServiceTokenOptions, 'rateLimitStore'>;
  catalogScripts?: CatalogScriptsOptions;
  systemSeeds?: SystemSeedsOptions;
  adminBootstrap?: AdminBootstrapOptions;
  openapi?: Omit<OpenApiSetupOptions, 'onDocument'>;
  consoleEntry?: Omit<ConsoleEntryOptions, 'store'>;
  edgeRateLimit?: Omit<AccessiEdgeRateLimitOptions, 'store' | 'match'>;
  sessionRevocation?: Omit<SessionRevocationOptions, 'store'>;
  accessTokenRevocation?: Omit<AccessTokenRevocationOptions, 'store'>;
  refreshTokenRotation?: Omit<RefreshTokenRotationOptions, 'store'>;
  metrics?: Omit<AccessiMetricsOptions, 'sink'>;
  audit?: Omit<AccessiAuditOptions, 'sinks' | 'store' | 'tenantId'>;
  bufferLogs?: boolean;
}

export interface AccessiTenant {
  id: string;
  hosts: string[];
  path?: string;
  enabled: boolean;
  description?: string;
  port?: number;
  /** Nome del file `*.environment.ts` di origine (mai il contenuto). */
  file: string;
  environmentFile: string;
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
  /** Cartella con `<id>.environment.ts`. */
  directory: string;
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
 * Helper di tipizzazione per i file tenant.
 *
 * ```ts
 * import type { AccessiTenantEnvironment } from 'emilsoftware-utilities/accessi/server';
 * import { defineAccessiTenantEnvironment } from 'emilsoftware-utilities/accessi/server';
 *
 * export default defineAccessiTenantEnvironment({
 *   tenant: { id: 'acme', hosts: ['accessi.acme.example.com'] },
 *   database: { host: 'db-acme', database: '/data/acme.fdb' },
 *   jwt: { secret: process.env.ACME_JWT_SECRET!, expiresIn: '1h' },
 *   email: { ... },
 *   encryptionKey: process.env.ACME_ENCRYPTION_KEY!,
 *   confirmationEmailUrl: 'https://accessi.acme.example.com',
 *   confirmationEmailReturnUrl: 'https://accessi.acme.example.com',
 * });
 * ```
 */
export function defineAccessiTenantEnvironment<const T extends AccessiTenantEnvironment>(
  environment: T,
): T {
  return environment;
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

/**
 * Converte la configurazione tipizzata in `AccessiOptions`.
 *
 * Applica i default di Firebird e collega `tenantId`; non crea store o sink,
 * che restano responsabilita del backend ospitante.
 */
export function accessiOptionsFromTenantEnvironment(
  environment: AccessiTenantEnvironment,
): AccessiOptions {
  const database = environment.database;
  const databaseOptions: Options = {
    host: database.host,
    port: database.port ?? 3050,
    database: database.database,
    user: database.user ?? 'SYSDBA',
    password: database.password ?? 'masterkey',
    ...(database.pluginName ? { pluginName: database.pluginName } : {}),
    ...(database.wireCrypt === 'disabled'
      ? { wireCrypt: WIRE_CRYPT_DISABLE }
      : database.wireCrypt === 'optional'
        ? { wireCrypt: WIRE_CRYPT_ENABLE }
        : {}),
  };

  return {
    databaseOptions,
    confirmationEmailUrl: environment.confirmationEmailUrl,
    confirmationEmailReturnUrl: environment.confirmationEmailReturnUrl,
    ...(environment.confirmationEmailPrefix ? { confirmationEmailPrefix: environment.confirmationEmailPrefix } : {}),
    ...(environment.customResetPage ? { customResetPage: environment.customResetPage } : {}),
    ...(environment.publicBaseUrl ? { publicBaseUrl: environment.publicBaseUrl } : {}),
    ...(environment.consoleApiBaseUrl ? { consoleApiBaseUrl: environment.consoleApiBaseUrl } : {}),
    encryptionKey: environment.encryptionKey,
    mockDemoUser: environment.mockDemoUser ?? false,
    ...(environment.passwordExpiration !== undefined ? { passwordExpiration: environment.passwordExpiration } : {}),
    ...(environment.passwordExpirationDays !== undefined ? { passwordExpirationDays: environment.passwordExpirationDays } : {}),
    ...(environment.legacyPasswordMigrationOnStartup !== undefined
      ? { legacyPasswordMigrationOnStartup: environment.legacyPasswordMigrationOnStartup }
      : {}),
    ...(environment.autoUpdateDatabase !== undefined ? { autoUpdateDatabase: environment.autoUpdateDatabase } : {}),
    jwtOptions: environment.jwt,
    emailOptions: environment.email,
    ...(environment.http ? { http: environment.http } : {}),
    ...(environment.authCookie ? { authCookie: environment.authCookie } : {}),
    ...(environment.publicAuthRateLimit ? { publicAuthRateLimit: environment.publicAuthRateLimit } : {}),
    ...(environment.publicRegistration ? { publicRegistration: environment.publicRegistration } : {}),
    ...(environment.federatedAuthentication ? { federatedAuthentication: environment.federatedAuthentication } : {}),
    ...(environment.extensionFieldsOptions ? { extensionFieldsOptions: environment.extensionFieldsOptions } : {}),
    ...(environment.serviceTokens ? { serviceTokens: environment.serviceTokens } : {}),
    ...(environment.catalogScripts ? { catalogScripts: environment.catalogScripts } : {}),
    ...(environment.systemSeeds ? { systemSeeds: environment.systemSeeds } : {}),
    ...(environment.adminBootstrap ? { adminBootstrap: environment.adminBootstrap } : {}),
    ...(environment.openapi ? { openapi: environment.openapi } : {}),
    ...(environment.consoleEntry ? { consoleEntry: environment.consoleEntry } : {}),
    ...(environment.edgeRateLimit ? { edgeRateLimit: environment.edgeRateLimit } : {}),
    ...(environment.sessionRevocation ? { sessionRevocation: environment.sessionRevocation } : {}),
    ...(environment.accessTokenRevocation ? { accessTokenRevocation: environment.accessTokenRevocation } : {}),
    ...(environment.refreshTokenRotation ? { refreshTokenRotation: environment.refreshTokenRotation } : {}),
    ...(environment.metrics ? { metrics: environment.metrics } : {}),
    ...(environment.audit ? { audit: environment.audit } : {}),
    ...(environment.bufferLogs !== undefined ? { bufferLogs: environment.bufferLogs } : {}),
    tenantId: environment.tenant.id,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function runtimeIssues(environment: unknown, file: string): string[] {
  const issues: string[] = [];
  if (!isRecord(environment)) {
    return [`${file}: il file deve esportare un oggetto (default export o export environment).`];
  }
  const tenant = environment.tenant;
  if (!isRecord(tenant)) {
    issues.push(`${file}: tenant mancante.`);
  } else {
    if (typeof tenant.id !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,62}$/.test(tenant.id)) {
      issues.push(`${file}: tenant.id non valido (minuscole, numeri, - e _, max 63).`);
    }
    if (tenant.hosts !== undefined && (!Array.isArray(tenant.hosts) || tenant.hosts.some((host) => typeof host !== 'string'))) {
      issues.push(`${file}: tenant.hosts deve essere un array di stringhe.`);
    }
    if (tenant.path !== undefined && typeof tenant.path !== 'string') {
      issues.push(`${file}: tenant.path deve essere una stringa.`);
    }
    if (
      tenant.port !== undefined
      && (typeof tenant.port !== 'number' || !Number.isInteger(tenant.port) || tenant.port < 1 || tenant.port > 65535)
    ) {
      issues.push(`${file}: tenant.port non valida.`);
    }
  }

  const database = environment.database;
  if (!isRecord(database)) {
    issues.push(`${file}: database mancante.`);
  } else {
    if (typeof database.host !== 'string' || database.host.trim() === '') {
      issues.push(`${file}: database.host obbligatorio.`);
    }
    if (typeof database.database !== 'string' || database.database.trim() === '') {
      issues.push(`${file}: database.database obbligatorio.`);
    }
    if (
      database.port !== undefined
      && (typeof database.port !== 'number' || !Number.isInteger(database.port) || database.port < 1 || database.port > 65535)
    ) {
      issues.push(`${file}: database.port non valida.`);
    }
  }

  if (!isRecord(environment.jwt)) issues.push(`${file}: jwt mancante.`);
  else {
    if (typeof environment.jwt.secret !== 'string' || environment.jwt.secret === '') {
      issues.push(`${file}: jwt.secret obbligatorio.`);
    }
    if (typeof environment.jwt.expiresIn !== 'string' || environment.jwt.expiresIn === '') {
      issues.push(`${file}: jwt.expiresIn obbligatorio.`);
    }
  }

  if (!isRecord(environment.email)) issues.push(`${file}: email mancante.`);
  if (typeof environment.encryptionKey !== 'string' || environment.encryptionKey === '') {
    issues.push(`${file}: encryptionKey obbligatoria.`);
  }
  if (typeof environment.confirmationEmailUrl !== 'string') {
    issues.push(`${file}: confirmationEmailUrl obbligatoria.`);
  }
  if (typeof environment.confirmationEmailReturnUrl !== 'string') {
    issues.push(`${file}: confirmationEmailReturnUrl obbligatoria.`);
  }
  return issues;
}

function loadEnvironmentModule(file: string): unknown {
  if (/\.(ts|mts|cts)$/i.test(file)) {
    // Caricamento lazy: jiti serve solo ai file tenant TypeScript.
    const { createJiti } = require('jiti') as {
      createJiti: (
        id: string,
        options?: { interopDefault?: boolean; moduleCache?: boolean; fsCache?: boolean },
      ) => (id: string) => unknown;
    };
    const jiti = createJiti(file, { interopDefault: true, moduleCache: false, fsCache: false });
    return jiti(file);
  }
  return require(file);
}

/**
 * Carica un singolo file `*.environment.ts`.
 *
 * Usa jiti per eseguire TypeScript anche nel pacchetto compilato, senza
 * richiedere un passo di build separato per i file tenant.
 */
export function loadAccessiTenantEnvironmentFile(file: string): { tenant: AccessiTenant; environment: AccessiTenantEnvironment } {
  const absolute = resolve(file);
  let loaded: unknown;
  try {
    loaded = loadEnvironmentModule(absolute);
  } catch (error) {
    throw new AccessiTenantConfigurationError([
      `${basename(file)}: impossibile caricare il file (${error instanceof Error ? error.message : String(error)}).`,
    ]);
  }

  const record = isRecord(loaded) ? loaded : {};
  const environment = (record.default ?? record.environment ?? loaded) as unknown;
  const issues = runtimeIssues(environment, basename(file));
  if (issues.length > 0) throw new AccessiTenantConfigurationError(issues);

  const typed = environment as AccessiTenantEnvironment;
  const settings = typed.tenant;
  const options = accessiOptionsFromTenantEnvironment(typed);
  const validation = validateAccessiOptions(options);
  const validationIssues = validation.errors.map((issue) => `${basename(file)}: ${issue.code}: ${issue.message}`);
  if (validationIssues.length > 0) throw new AccessiTenantConfigurationError(validationIssues);

  const hosts = (settings.hosts ?? []).map(normalizeHost).filter(Boolean);
  const path = normalizeTenantPath(settings.path);
  if (hosts.length === 0 && !path) {
    throw new AccessiTenantConfigurationError([
      `${basename(file)}: configurare tenant.hosts oppure tenant.path.`,
    ]);
  }

  const tenant: AccessiTenant = {
    id: settings.id,
    hosts,
    ...(path ? { path } : {}),
    enabled: settings.enabled !== false,
    ...(settings.description ? { description: settings.description } : {}),
    ...(settings.port ? { port: settings.port } : {}),
    file: basename(file),
    environmentFile: absolute,
    options,
  };
  return { tenant, environment: typed };
}

/**
 * Carica i tenant da una cartella di file `<id>.environment.ts`.
 *
 * La validazione e aggregata: un errore blocca l'intera cartella, cosi non si
 * avvia un tenant con configurazione parziale. Nessun segreto viene stampato.
 */
export function loadAccessiTenants(options: LoadAccessiTenantsOptions): AccessiTenantRegistry {
  if (!options?.directory) throw new Error('loadAccessiTenants: directory obbligatoria.');
  const directory = resolve(options.directory);
  const issues: string[] = [];
  const warnings: string[] = [];

  let files: string[];
  try {
    files = readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.environment\.(ts|mts|cts|js|mjs|cjs)$/.test(entry.name))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    throw new AccessiTenantConfigurationError([
      `Cartella tenant non leggibile (${directory}): ${error instanceof Error ? error.message : String(error)}`,
    ]);
  }
  if (files.length === 0) {
    throw new AccessiTenantConfigurationError([`Nessun file *.environment.ts nella cartella ${directory}.`]);
  }

  const tenants: AccessiTenant[] = [];
  for (const file of files) {
    try {
      tenants.push(loadAccessiTenantEnvironmentFile(join(directory, file)).tenant);
    } catch (error) {
      if (error instanceof AccessiTenantConfigurationError) issues.push(...error.issues);
      else issues.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const byId = new Map<string, AccessiTenant>();
  const hostsSeen = new Map<string, string>();
  const pathsSeen = new Map<string, string>();
  const jwtSecrets = new Map<string, string>();
  const issuerAudience = new Map<string, string>();
  const portsSeen = new Map<number, string>();
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
    if (tenant.port !== undefined) {
      const existing = portsSeen.get(tenant.port);
      if (existing) issues.push(`Porta ${tenant.port} assegnata a "${existing}" e "${tenant.id}".`);
      else portsSeen.set(tenant.port, tenant.id);
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
      return tenants.map((tenant) => {
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
            ? {
                audience: typeof tenant.options.jwtOptions.audience === 'string'
                  ? tenant.options.jwtOptions.audience
                  : tenant.options.jwtOptions.audience.join(','),
              }
            : {}),
          jwtAlgorithm: tenant.options.jwtOptions.algorithm ?? 'HS256',
          refreshEnabled: Boolean(tenant.options.jwtOptions.refreshExpiresIn),
        };
      });
    },
  };

  return registry;
}
