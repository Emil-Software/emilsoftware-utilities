/**
 * Entry point server Accessi.
 *
 * Questo e l'unico entry point che puo importare database, SMTP, migrazioni,
 * console e servizi Nest completi. I backend fratelli devono usare
 * `accessi/resource-server` e `accessi/client`.
 */
export * from "../../accessi-module";
export * from "./standalone";
export * from "./tenants";
export type { AccessiOptions as AccessiServerOptions } from "../../accessi-module";
export {
  createAccessiOptionsFromEnv,
  createCatalogScriptsOptionsFromEnv,
  parseAccessiPreviousPublicKeys,
} from "../../accessi-module/database-updates/accessiOptionsFromEnv";
