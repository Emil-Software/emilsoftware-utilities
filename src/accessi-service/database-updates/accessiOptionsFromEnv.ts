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

function getOptionalBoolean(env: NodeJS.ProcessEnv, name: string, fallback: boolean): boolean {
  const value = env[name];
  if (value === undefined) {
    return fallback;
  }
  return value.toLowerCase() === "true";
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

  return {
    databaseOptions,
    confirmationEmailUrl: getEnv(env, "ACCESSI_CONFIRMATION_EMAIL_URL", "http://localhost"),
    confirmationEmailReturnUrl: getEnv(env, "ACCESSI_CONFIRMATION_RETURN_EMAIL_URL", "http://localhost"),
    confirmationEmailPrefix: env.ACCESSI_CONFIRMATION_EMAIL_PREFIX,
    customResetPage: env.ACCESSI_CUSTOM_RESET_PAGE,
    consoleApiBaseUrl: env.ACCESSI_CONSOLE_API_BASE_URL,
    publicBaseUrl: env.ACCESSI_PUBLIC_BASE_URL,
    encryptionKey: getEnv(env, "ACCESSI_ENCRYPTION_KEY", "1234567890ABCDEF"),
    mockDemoUser: getOptionalBoolean(env, "ACCESSI_MOCK_DEMO_USER", false),
    passwordExpiration: getOptionalBoolean(env, "ACCESSI_PASSWORD_EXPIRATION", false),
    autoUpdateDatabase: true,
    jwtOptions: {
      secret: getEnv(env, "ACCESSI_JWT_SECRET", "local-accessi-update"),
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
    ...(env.ACCESSI_CONSOLE_ENTRY_TTL_MS
      ? {
          consoleEntry: {
            ttlMs: Number(env.ACCESSI_CONSOLE_ENTRY_TTL_MS),
          },
        }
      : {}),
    extensionFieldsOptions: [],
    catalogScripts: createCatalogScriptsOptionsFromEnv(env),
  };
}
