import type { AccessiOptions, CatalogScriptsOptions, JwtOptions } from '../AccessiModule';
import { DatabaseUtilities } from '../../Utilities';

function getEnv(env: NodeJS.ProcessEnv, names: string | string[], fallback?: string): string {
  const candidates = Array.isArray(names) ? names : [names];
  const value = candidates.map((name) => env[name]).find((candidate) => candidate !== undefined && candidate !== "") ?? fallback;
  if (!value) {
    throw new Error(`Variabile ambiente mancante: ${candidates.join(" oppure ")}`);
  }
  return value;
}

function parseBoolean(value: string, name: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "off"].includes(normalized)) {
    return false;
  }
  throw new Error(
    `Variabile ambiente ${name}: valore booleano non valido "${value}". Usare true/false (oppure 1/0, yes/no, on/off).`,
  );
}

function getOptionalBoolean(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const value = env[name];
  if (value === undefined || value.trim() === "") {
    return fallback;
  }
  return parseBoolean(value, name);
}

function getOptionalNumber(env: NodeJS.ProcessEnv, name: string): number | undefined {
  const value = env[name];
  if (value === undefined || value.trim() === "") {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Variabile ambiente ${name}: atteso un numero, ricevuto "${value}".`);
  }
  return parsed;
}

function getOptionalPositiveInteger(env: NodeJS.ProcessEnv, name: string): number | undefined {
  const value = getOptionalNumber(env, name);
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Variabile ambiente ${name}: atteso un intero positivo, ricevuto "${env[name]}".`);
  }
  return value;
}

function getOptionalEnum<T extends string>(
  env: NodeJS.ProcessEnv,
  name: string,
  allowed: readonly T[],
): T | undefined {
  const value = env[name];
  if (value === undefined || value.trim() === "") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  const match = allowed.find((candidate) => candidate === normalized);
  if (!match) {
    throw new Error(
      `Variabile ambiente ${name}: valore "${value}" non valido. Ammessi: ${allowed.join(', ')}.`,
    );
  }
  return match;
}

const LOCAL_JWT_SECRET = "local-accessi-update";
const LOCAL_ENCRYPTION_KEY = "1234567890ABCDEF";

function isProduction(env: NodeJS.ProcessEnv): boolean {
  return (env.NODE_ENV ?? "").toLowerCase() === "production";
}

/**
 * Legge un segreto obbligatorio in produzione.
 *
 * In sviluppo mantiene i default locali storici; in produzione un valore
 * mancante o uguale al default pubblico blocca l'avvio invece di firmare token
 * con una chiave nota.
 */
function getRequiredSecret(
  env: NodeJS.ProcessEnv,
  name: string,
  localFallback: string,
): string {
  const value = env[name];
  if (value !== undefined && value.trim() !== "") {
    if (isProduction(env) && value === localFallback) {
      throw new Error(
        `Variabile ambiente ${name}: il valore di default locale non e ammesso in produzione.`,
      );
    }
    return value;
  }
  if (isProduction(env)) {
    throw new Error(
      `Variabile ambiente mancante: ${name} (obbligatoria con NODE_ENV=production).`,
    );
  }
  return localFallback;
}

const JWT_ALGORITHMS = [
  "HS256", "HS384", "HS512",
  "RS256", "RS384", "RS512",
  "ES256", "ES384", "ES512",
] as const;

function getJwtAlgorithm(env: NodeJS.ProcessEnv): (typeof JWT_ALGORITHMS)[number] | undefined {
  const value = env.ACCESSI_JWT_ALGORITHM?.trim().toUpperCase();
  return JWT_ALGORITHMS.find((algorithm) => algorithm === value);
}

/** Normalizza una chiave PEM incollata in una variabile a riga singola. */
function normalizePem(value: string): string {
  return value.includes('\\n') ? value.replace(/\\n/g, '\n') : value;
}

/**
 * Legge `ACCESSI_JWT_PREVIOUS_PUBLIC_KEYS`: array JSON di chiavi pubbliche.
 *
 * Sono accettate sia stringhe PEM sia oggetti `{ publicKey, keyId, algorithm }`.
 * Gli errori indicano l'indice e il nome della variabile, perché una rotazione
 * malformata deve fermare il boot invece di lasciare token non verificabili.
 */
export function parseAccessiPreviousPublicKeys(
  value: string | undefined,
  variableName = 'ACCESSI_JWT_PREVIOUS_PUBLIC_KEYS',
): NonNullable<JwtOptions['previousPublicKeys']> | undefined {
  if (value === undefined || value.trim() === '') return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`${variableName}: JSON non valido (${detail}).`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`${variableName}: atteso un array JSON di chiavi pubbliche.`);
  }

  return parsed.map((entry, index) => {
    const position = `${variableName}[${index}]`;

    if (typeof entry === 'string') {
      if (entry.trim() === '') {
        throw new Error(`${position}: chiave pubblica PEM vuota.`);
      }
      return { publicKey: normalizePem(entry) };
    }

    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new Error(`${position}: atteso un PEM oppure un oggetto { publicKey, keyId, algorithm }.`);
    }

    const record = entry as Record<string, unknown>;
    if (typeof record.publicKey !== 'string' || record.publicKey.trim() === '') {
      throw new Error(`${position}: publicKey deve essere una stringa PEM non vuota.`);
    }
    if (record.keyId !== undefined && (typeof record.keyId !== 'string' || record.keyId.trim() === '')) {
      throw new Error(`${position}: keyId, se presente, deve essere una stringa non vuota.`);
    }
    const algorithm = typeof record.algorithm === 'string' ? record.algorithm.trim().toUpperCase() : undefined;
    if (algorithm !== undefined && !JWT_ALGORITHMS.some((supported) => supported === algorithm)) {
      throw new Error(`${position}: algoritmo ${algorithm} non supportato.`);
    }

    return {
      publicKey: normalizePem(record.publicKey),
      ...(typeof record.keyId === 'string' ? { keyId: record.keyId.trim() } : {}),
      ...(algorithm ? { algorithm: algorithm as (typeof JWT_ALGORITHMS)[number] } : {}),
    };
  });
}

/** Catalog migrations lette dall'ambiente: cartella in ACCESSI_CATALOG_FOLDER. */
export function createCatalogScriptsOptionsFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): CatalogScriptsOptions | undefined {
  const folder = env.ACCESSI_CATALOG_FOLDER;
  if (!folder) {
    return undefined;
  }

  const policy = env.ACCESSI_CATALOG_CHECKSUM_POLICY;
  const checksumPolicy = policy === 'warn' || policy === 'reapply' || policy === 'error' ? policy : undefined;

  return {
    enabled: true,
    folder,
    onChecksumMismatch: checksumPolicy,
    stopOnError: getOptionalBoolean(env, 'ACCESSI_CATALOG_STOP_ON_ERROR', true),
  };
}

/**
 * Costruisce `AccessiOptions` dalle variabili ambiente (stesse di runAccessiDbUpdate).
 *
 * `env` permette di leggere un file tenant senza mutare `process.env`.
 */
export function createAccessiOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): AccessiOptions {
  const databaseOptions = DatabaseUtilities.createOption(
    getEnv(env, ["ACCESSI_DB_HOST", "ACCESSI_FIREBIRD_HOST"]),
    Number(getEnv(env, ["ACCESSI_DB_PORT", "ACCESSI_FIREBIRD_PORT"], "3050")),
    getEnv(env, ["ACCESSI_DB_DATABASE", "ACCESSI_FIREBIRD_DATABASE"]),
    getEnv(env, ["ACCESSI_DB_USER", "ACCESSI_FIREBIRD_USER"], "SYSDBA"),
    getEnv(env, ["ACCESSI_DB_PASSWORD", "ACCESSI_FIREBIRD_PASSWORD"], "masterkey")
  );

  // Firebird 2.5 richiede Legacy_Auth e non supporta la cifratura del wire: override opzionale via env.
  const wireCrypt = env.ACCESSI_DB_WIRE_CRYPT;
  const authPlugin = env.ACCESSI_DB_AUTH_PLUGIN;
  if (wireCrypt) (databaseOptions as { wireCrypt?: string }).wireCrypt = wireCrypt;
  if (authPlugin) (databaseOptions as { pluginName?: string }).pluginName = authPlugin;

  const previousPublicKeys = parseAccessiPreviousPublicKeys(
    env.ACCESSI_JWT_PREVIOUS_PUBLIC_KEYS,
  );
  const mockDemoUser = getOptionalBoolean(env, "ACCESSI_MOCK_DEMO_USER", false);
  if (mockDemoUser && isProduction(env)) {
    throw new Error(
      "ACCESSI_MOCK_DEMO_USER non puo essere true con NODE_ENV=production: gli utenti demo non devono esistere in produzione.",
    );
  }

  const authCookieConfigured =
    env.ACCESSI_AUTH_COOKIE_ENABLED !== undefined ||
    env.ACCESSI_AUTH_COOKIE_SECURE !== undefined ||
    env.ACCESSI_AUTH_COOKIE_SAME_SITE !== undefined ||
    env.ACCESSI_AUTH_COOKIE_DOMAIN !== undefined ||
    env.ACCESSI_AUTH_COOKIE_CSRF !== undefined ||
    env.ACCESSI_AUTH_COOKIE_EXPOSE_TOKENS !== undefined;
  const authCookieSameSite = getOptionalEnum(
    env,
    "ACCESSI_AUTH_COOKIE_SAME_SITE",
    ["strict", "lax", "none"] as const,
  );
  const authCookieCsrf = getOptionalEnum(
    env,
    "ACCESSI_AUTH_COOKIE_CSRF",
    ["double-submit", "off"] as const,
  );
  const authCookieDomain = env.ACCESSI_AUTH_COOKIE_DOMAIN?.trim();
  const authCookie = authCookieConfigured
    ? {
        enabled: getOptionalBoolean(env, "ACCESSI_AUTH_COOKIE_ENABLED", true),
        secure: getOptionalBoolean(env, "ACCESSI_AUTH_COOKIE_SECURE", true),
        ...(authCookieSameSite ? { sameSite: authCookieSameSite } : {}),
        ...(authCookieDomain ? { domain: authCookieDomain } : {}),
        ...(authCookieCsrf ? { csrf: authCookieCsrf } : {}),
        exposeTokens: getOptionalBoolean(env, "ACCESSI_AUTH_COOKIE_EXPOSE_TOKENS", false),
      }
    : undefined;

  const auditRetentionDays = getOptionalPositiveInteger(env, "ACCESSI_AUDIT_RETENTION_DAYS");
  const auditConfigured =
    env.ACCESSI_AUDIT_ENABLED !== undefined ||
    auditRetentionDays !== undefined ||
    env.ACCESSI_AUDIT_LOGGER !== undefined;
  const audit = auditConfigured
    ? {
        enabled: getOptionalBoolean(env, "ACCESSI_AUDIT_ENABLED", true),
        ...(auditRetentionDays !== undefined ? { retentionDays: auditRetentionDays } : {}),
        logger: getOptionalBoolean(env, "ACCESSI_AUDIT_LOGGER", true),
      }
    : undefined;

  const metricsPrefix = env.ACCESSI_METRICS_PREFIX?.trim();
  const metricsConfigured =
    env.ACCESSI_METRICS_ENABLED !== undefined || (metricsPrefix !== undefined && metricsPrefix !== "");
  const metrics = metricsConfigured
    ? {
        enabled: getOptionalBoolean(env, "ACCESSI_METRICS_ENABLED", true),
        ...(metricsPrefix ? { prefix: metricsPrefix } : {}),
      }
    : undefined;

  const serviceTokenTtlDays = getOptionalPositiveInteger(
    env,
    "ACCESSI_SERVICE_TOKENS_DEFAULT_TTL_DAYS",
  );
  const serviceTokensConfigured =
    env.ACCESSI_SERVICE_TOKENS_ENABLED !== undefined || serviceTokenTtlDays !== undefined;
  const serviceTokens = serviceTokensConfigured
    ? {
        enabled: getOptionalBoolean(env, "ACCESSI_SERVICE_TOKENS_ENABLED", true),
        ...(serviceTokenTtlDays !== undefined ? { defaultTtlDays: serviceTokenTtlDays } : {}),
      }
    : undefined;

  const federatedConfigured =
    env.ACCESSI_FEDERATED_AUTH_ENABLED !== undefined ||
    env.ACCESSI_FEDERATED_SELF_REGISTRATION !== undefined;
  const federatedAuthentication = federatedConfigured
    ? {
        enabled: getOptionalBoolean(env, "ACCESSI_FEDERATED_AUTH_ENABLED", false),
        allowSelfRegistration: getOptionalBoolean(
          env,
          "ACCESSI_FEDERATED_SELF_REGISTRATION",
          false,
        ),
      }
    : undefined;

  const publicRegistrationConfigured = env.ACCESSI_PUBLIC_REGISTRATION_ENABLED !== undefined;
  const publicRegistration = publicRegistrationConfigured
    ? {
        enabled: getOptionalBoolean(env, "ACCESSI_PUBLIC_REGISTRATION_ENABLED", false),
      }
    : undefined;

  const tenantId = env.ACCESSI_TENANT_ID?.trim();
  const consoleEntryTtlMs = getOptionalPositiveInteger(env, "ACCESSI_CONSOLE_ENTRY_TTL_MS");

  return {
    databaseOptions,
    confirmationEmailUrl: getEnv(env, "ACCESSI_CONFIRMATION_EMAIL_URL", "http://localhost"),
    confirmationEmailReturnUrl: getEnv(env, "ACCESSI_CONFIRMATION_RETURN_EMAIL_URL", "http://localhost"),
    confirmationEmailPrefix: env.ACCESSI_CONFIRMATION_EMAIL_PREFIX,
    customResetPage: env.ACCESSI_CUSTOM_RESET_PAGE,
    consoleApiBaseUrl: env.ACCESSI_CONSOLE_API_BASE_URL,
    publicBaseUrl: env.ACCESSI_PUBLIC_BASE_URL,
    encryptionKey: getRequiredSecret(env, "ACCESSI_ENCRYPTION_KEY", LOCAL_ENCRYPTION_KEY),
    mockDemoUser,
    passwordExpiration: getOptionalBoolean(env, "ACCESSI_PASSWORD_EXPIRATION", false),
    legacyPasswordMigrationOnStartup: getOptionalBoolean(env, "ACCESSI_LEGACY_PASSWORD_MIGRATION", true),
    autoUpdateDatabase: getOptionalBoolean(env, "ACCESSI_AUTO_UPDATE_DATABASE", true),
    systemSeeds: {
      enabled: getOptionalBoolean(env, "ACCESSI_SYSTEM_SEEDS_ENABLED", true),
    },
    ...(env.ACCESSI_ADMIN_BOOTSTRAP_ENABLED
      ? {
          adminBootstrap: {
            enabled: getOptionalBoolean(env, "ACCESSI_ADMIN_BOOTSTRAP_ENABLED", false),
          },
        }
      : {}),
    ...(tenantId ? { tenantId } : {}),
    ...(authCookie ? { authCookie } : {}),
    ...(audit ? { audit } : {}),
    ...(metrics ? { metrics } : {}),
    ...(serviceTokens ? { serviceTokens } : {}),
    ...(federatedAuthentication ? { federatedAuthentication } : {}),
    ...(publicRegistration ? { publicRegistration } : {}),
    jwtOptions: {
      secret: getRequiredSecret(env, "ACCESSI_JWT_SECRET", LOCAL_JWT_SECRET),
      expiresIn: getEnv(env, "ACCESSI_JWT_EXPIRES", "24h"),
      ...(env.ACCESSI_JWT_REFRESH_EXPIRES ? { refreshExpiresIn: env.ACCESSI_JWT_REFRESH_EXPIRES } : {}),
      ...(env.ACCESSI_JWT_ISSUER ? { issuer: env.ACCESSI_JWT_ISSUER } : {}),
      ...(env.ACCESSI_JWT_AUDIENCE ? { audience: env.ACCESSI_JWT_AUDIENCE } : {}),
      ...(getJwtAlgorithm(env) ? { algorithm: getJwtAlgorithm(env) } : {}),
      ...(env.ACCESSI_JWT_PRIVATE_KEY ? { privateKey: env.ACCESSI_JWT_PRIVATE_KEY } : {}),
      ...(env.ACCESSI_JWT_PUBLIC_KEY ? { publicKey: env.ACCESSI_JWT_PUBLIC_KEY } : {}),
      ...(env.ACCESSI_JWT_KEY_ID ? { keyId: env.ACCESSI_JWT_KEY_ID } : {}),
      ...(env.ACCESSI_JWKS_PATH ? { jwksPath: env.ACCESSI_JWKS_PATH } : {}),
      ...(previousPublicKeys ? { previousPublicKeys } : {}),
    },
    emailOptions: {
      host: getEnv(env, "ACCESSI_EMAIL_HOST", "localhost"),
      port: Number(getEnv(env, "ACCESSI_EMAIL_PORT", "25")),
      secure: getOptionalBoolean(env, "ACCESSI_EMAIL_SECURE", false),
      requireTLS: getOptionalBoolean(env, "ACCESSI_EMAIL_REQUIRE_TLS", false),
      tls: {
        rejectUnauthorized: getOptionalBoolean(env, "ACCESSI_EMAIL_TLS_REJECT_UNAUTHORIZED", false),
      },
      from: getEnv(env, "ACCESSI_EMAIL_FROM", "noreply@example.local"),
      auth: {
        user: getEnv(env, "ACCESSI_EMAIL_USER", "local-user"),
        pass: getEnv(env, "ACCESSI_EMAIL_PASSWORD", "local-password"),
      },
    },
    ...(consoleEntryTtlMs !== undefined
      ? {
          consoleEntry: {
            ttlMs: consoleEntryTtlMs,
          },
        }
      : {}),
    extensionFieldsOptions: [],
    catalogScripts: createCatalogScriptsOptionsFromEnv(env),
  };
}
