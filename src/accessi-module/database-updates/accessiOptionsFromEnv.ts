import type { AccessiOptions, CatalogScriptsOptions } from '../AccessiModule';
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

  return {
    databaseOptions,
    confirmationEmailUrl: getEnv("ACCESSI_CONFIRMATION_EMAIL_URL", "http://localhost"),
    confirmationEmailReturnUrl: getEnv("ACCESSI_CONFIRMATION_RETURN_EMAIL_URL", "http://localhost"),
    confirmationEmailPrefix: process.env.ACCESSI_CONFIRMATION_EMAIL_PREFIX,
    customResetPage: process.env.ACCESSI_CUSTOM_RESET_PAGE,
    encryptionKey: getEnv("ACCESSI_ENCRYPTION_KEY", "1234567890ABCDEF"),
    mockDemoUser: getOptionalBoolean("ACCESSI_MOCK_DEMO_USER", false),
    passwordExpiration: getOptionalBoolean("ACCESSI_PASSWORD_EXPIRATION", false),
    autoUpdateDatabase: true,
    jwtOptions: {
      secret: getEnv("ACCESSI_JWT_SECRET", "local-accessi-update"),
      expiresIn: getEnv("ACCESSI_JWT_EXPIRES", "24h"),
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
    extensionFieldsOptions: [],
    catalogScripts: createCatalogScriptsOptionsFromEnv(),
  };
}
