import type { AccessiOptions } from "../AccessiModule";
import { AccessiDatabaseUpdater } from "./AccessiDatabaseUpdater";
import { DatabaseUtilities } from "../../Utilities";
import { Orm } from "../../Orm";

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

function createAccessiOptionsFromEnv(): AccessiOptions {
  return {
    databaseOptions: DatabaseUtilities.createOption(
      getEnv(["ACCESSI_DB_HOST", "ACCESSI_FIREBIRD_HOST"]),
      Number(getEnv(["ACCESSI_DB_PORT", "ACCESSI_FIREBIRD_PORT"], "3050")),
      getEnv(["ACCESSI_DB_DATABASE", "ACCESSI_FIREBIRD_DATABASE"]),
      getEnv(["ACCESSI_DB_USER", "ACCESSI_FIREBIRD_USER"], "SYSDBA"),
      getEnv(["ACCESSI_DB_PASSWORD", "ACCESSI_FIREBIRD_PASSWORD"], "masterkey")
    ),
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
  };
}

async function main(): Promise<void> {
  const options = createAccessiOptionsFromEnv();

  const checkOnly = process.argv.includes('--check');
  console.log(checkOnly ? '[Accessi DB Update] Verifica schema in sola lettura...' : '[Accessi DB Update] Avvio aggiornamento database...');
  console.log(
    `[Accessi DB Update] Target: ${options.databaseOptions.host}:${options.databaseOptions.port} -> ${options.databaseOptions.database}`
  );

  if (checkOnly) await AccessiDatabaseUpdater.assertCompatible(options);
  else await AccessiDatabaseUpdater.run(options);

  const currentVersion = await AccessiDatabaseUpdater.getCurrentVersion(options);
  console.log(
    `[Accessi DB Update] Completato. Versione corrente: ${currentVersion ?? "N/D"} | Ultima disponibile: ${AccessiDatabaseUpdater.getLatestVersion()}`
  );
}

main()
  .then(() => Orm.closePools())
  .then(() => process.exit(0))
  .catch(async (error) => {
    console.error("[Accessi DB Update] Errore durante l'aggiornamento:", error);
    await Orm.closePools().catch(() => undefined);
    process.exit(1);
  });
