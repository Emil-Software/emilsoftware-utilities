import type { AccessiOptions, CatalogScriptsOptions, JwtOptions } from '../AccessiModule';
import { DatabaseUtilities } from '../../Utilities';

function getEnv(names: string | string[], fallback?: string): string {
  const candidates = Array.isArray(names) ? names : [names];
  const value = candidates.map((name) => process.env[name]).find((candidate) => candidate !== undefined && candidate !== "") ?? fallback;
  if (!value) {
    throw new Error(`Variabile ambiente mancante: ${candidates.join(" oppure ")}`);
  }
  return value;
}

function getOptionalBoolean(name: string, fallback: boolean): boolean {
  const value = process.env[name];
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

function getJwtAlgorithm(): (typeof JWT_ALGORITHMS)[number] | undefined {
  const value = process.env.ACCESSI_JWT_ALGORITHM?.trim().toUpperCase();
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
export function createCatalogScriptsOptionsFromEnv(): CatalogScriptsOptions | undefined {
  const folder = process.env.ACCESSI_CATALOG_FOLDER;
  if (!folder) {
    return undefined;
  }

  const policy = process.env.ACCESSI_CATALOG_CHECKSUM_POLICY;
  const checksumPolicy = policy === 'warn' || policy === 'reapply' || policy === 'error' ? policy : undefined;

  return {
    enabled: true,
    folder,
    onChecksumMismatch: checksumPolicy,
    stopOnError: getOptionalBoolean('ACCESSI_CATALOG_STOP_ON_ERROR', true),
  };
}

/** Costruisce `AccessiOptions` dalle variabili ambiente (stesse di runAccessiDbUpdate). */
export function createAccessiOptionsFromEnv(): AccessiOptions {
  const databaseOptions = DatabaseUtilities.createOption(
    getEnv(["ACCESSI_DB_HOST", "ACCESSI_FIREBIRD_HOST"]),
    Number(getEnv(["ACCESSI_DB_PORT", "ACCESSI_FIREBIRD_PORT"], "3050")),
    getEnv(["ACCESSI_DB_DATABASE", "ACCESSI_FIREBIRD_DATABASE"]),
    getEnv(["ACCESSI_DB_USER", "ACCESSI_FIREBIRD_USER"], "SYSDBA"),
    getEnv(["ACCESSI_DB_PASSWORD", "ACCESSI_FIREBIRD_PASSWORD"], "masterkey")
  );

  // Firebird 2.5 richiede Legacy_Auth e non supporta la cifratura del wire: override opzionale via env.
  const wireCrypt = process.env.ACCESSI_DB_WIRE_CRYPT;
  const authPlugin = process.env.ACCESSI_DB_AUTH_PLUGIN;
  if (wireCrypt) (databaseOptions as { wireCrypt?: string }).wireCrypt = wireCrypt;
  if (authPlugin) (databaseOptions as { pluginName?: string }).pluginName = authPlugin;

  const previousPublicKeys = parseAccessiPreviousPublicKeys(
    process.env.ACCESSI_JWT_PREVIOUS_PUBLIC_KEYS,
  );

  return {
    databaseOptions,
    confirmationEmailUrl: getEnv("ACCESSI_CONFIRMATION_EMAIL_URL", "http://localhost"),
    confirmationEmailReturnUrl: getEnv("ACCESSI_CONFIRMATION_RETURN_EMAIL_URL", "http://localhost"),
    confirmationEmailPrefix: process.env.ACCESSI_CONFIRMATION_EMAIL_PREFIX,
    customResetPage: process.env.ACCESSI_CUSTOM_RESET_PAGE,
    consoleApiBaseUrl: process.env.ACCESSI_CONSOLE_API_BASE_URL,
    publicBaseUrl: process.env.ACCESSI_PUBLIC_BASE_URL,
    encryptionKey: getEnv("ACCESSI_ENCRYPTION_KEY", "1234567890ABCDEF"),
    mockDemoUser: getOptionalBoolean("ACCESSI_MOCK_DEMO_USER", false),
    passwordExpiration: getOptionalBoolean("ACCESSI_PASSWORD_EXPIRATION", false),
    autoUpdateDatabase: true,
    jwtOptions: {
      secret: getEnv("ACCESSI_JWT_SECRET", "local-accessi-update"),
      expiresIn: getEnv("ACCESSI_JWT_EXPIRES", "24h"),
      ...(process.env.ACCESSI_JWT_REFRESH_EXPIRES ? { refreshExpiresIn: process.env.ACCESSI_JWT_REFRESH_EXPIRES } : {}),
      ...(process.env.ACCESSI_JWT_ISSUER ? { issuer: process.env.ACCESSI_JWT_ISSUER } : {}),
      ...(process.env.ACCESSI_JWT_AUDIENCE ? { audience: process.env.ACCESSI_JWT_AUDIENCE } : {}),
      ...(getJwtAlgorithm() ? { algorithm: getJwtAlgorithm() } : {}),
      ...(process.env.ACCESSI_JWT_PRIVATE_KEY ? { privateKey: process.env.ACCESSI_JWT_PRIVATE_KEY } : {}),
      ...(process.env.ACCESSI_JWT_PUBLIC_KEY ? { publicKey: process.env.ACCESSI_JWT_PUBLIC_KEY } : {}),
      ...(process.env.ACCESSI_JWT_KEY_ID ? { keyId: process.env.ACCESSI_JWT_KEY_ID } : {}),
      ...(process.env.ACCESSI_JWKS_PATH ? { jwksPath: process.env.ACCESSI_JWKS_PATH } : {}),
      ...(previousPublicKeys ? { previousPublicKeys } : {}),
    },
    emailOptions: {
      host: getEnv("ACCESSI_EMAIL_HOST", "localhost"),
      port: Number(getEnv("ACCESSI_EMAIL_PORT", "25")),
      secure: getOptionalBoolean("ACCESSI_EMAIL_SECURE", false),
      requireTLS: getOptionalBoolean("ACCESSI_EMAIL_REQUIRE_TLS", false),
      tls: {
        rejectUnauthorized: getOptionalBoolean("ACCESSI_EMAIL_TLS_REJECT_UNAUTHORIZED", false),
      },
      from: getEnv("ACCESSI_EMAIL_FROM", "noreply@example.local"),
      auth: {
        user: getEnv("ACCESSI_EMAIL_USER", "local-user"),
        pass: getEnv("ACCESSI_EMAIL_PASSWORD", "local-password"),
      },
    },
    ...(process.env.ACCESSI_CONSOLE_ENTRY_TTL_MS
      ? {
          consoleEntry: {
            ttlMs: Number(process.env.ACCESSI_CONSOLE_ENTRY_TTL_MS),
          },
        }
      : {}),
    extensionFieldsOptions: [],
    catalogScripts: createCatalogScriptsOptionsFromEnv(),
  };
}
