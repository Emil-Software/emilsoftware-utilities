import { AccessiOptions } from "../AccessiModule";
import { AccessiDatabaseUpdater } from "./AccessiDatabaseUpdater";
import { DatabaseUtilities } from "../../Utilities";

function getEnv(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) {
    throw new Error(`Variabile ambiente mancante: ${name}`);
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
      getEnv("ACCESSI_DB_HOST"),
      Number(getEnv("ACCESSI_DB_PORT", "3050")),
      getEnv("ACCESSI_DB_DATABASE"),
      getEnv("ACCESSI_DB_USER", "SYSDBA"),
      getEnv("ACCESSI_DB_PASSWORD", "masterkey")
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

  console.log("[Accessi DB Update] Avvio aggiornamento database...");
  console.log(
    `[Accessi DB Update] Target: ${options.databaseOptions.host}:${options.databaseOptions.port} -> ${options.databaseOptions.database}`
  );

  await AccessiDatabaseUpdater.run(options);

  const currentVersion = await AccessiDatabaseUpdater.getCurrentVersion(options);
  console.log(
    `[Accessi DB Update] Completato. Versione corrente: ${currentVersion ?? "N/D"} | Ultima disponibile: ${AccessiDatabaseUpdater.getLatestVersion()}`
  );
}

main().catch((error) => {
  console.error("[Accessi DB Update] Errore durante l'aggiornamento:", error);
  process.exit(1);
});
