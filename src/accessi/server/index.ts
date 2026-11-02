/**
 * Entry point server Accessi.
 *
 * Questo e l'unico entry point che puo importare database, SMTP, migrazioni,
 * console e servizi Nest completi. I backend fratelli devono usare
 * `accessi/resource-server` e `accessi/client`.
 */
export * from "../../accessi-service";
export * from "./standalone";
export * from "./tenants";
export * from "./tenantStores";
export * from "./tenantSupervisor";
export * from "./tenantRouter";
export {
  runWithAccessiTenant,
  getAccessiTenantContext,
  getAccessiTenantId,
} from "../../accessi-service/tenancy/tenantContext";
export type { AccessiTenantContext } from "../../accessi-service/tenancy/tenantContext";
export type { AccessiOptions as AccessiServerOptions } from "../../accessi-service";
export {
  createAccessiOptionsFromEnv,
  createCatalogScriptsOptionsFromEnv,
  parseAccessiPreviousPublicKeys,
} from "../../accessi-service/database-updates/accessiOptionsFromEnv";
