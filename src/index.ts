/**
 * Root barrel legacy.
 *
 * Supportato fino alla prossima major per retrocompatibilita. I nuovi consumer
 * devono usare gli entry point dichiarati in `package.json#exports`
 * (`accessi/server`, `accessi/resource-server`, `accessi/client*`,
 * `accessi/contracts*`, `accessi/openapi`, `accessi/console`, `accessi/ui`).
 * Migrazione: `docs/import-migration.md`.
 */
import { DatabaseUpdater } from "./DatabaseUpdater";
import { ExecutionTimeLogger } from "./ExecutionTimeLogger"
import * as Firebird from "node-firebird";
import { LogLevels, Logger } from "./Logger";
import { Orm } from "./Orm";
import { DateUtilities, RestUtilities, DatabaseUtilities, StatusCode } from "./Utilities";
import { autobind } from "./autobind";
import { DocumentGenerator } from "./ContractGenerator";
import "./firebird-compat";

export * from "./Orm";
export * from "./Utilities";
export * from "./Logger";
export * from "./autobind";
export * from "./ExecutionTimeLogger";
export * from "./RoutesLoggerMiddleware";
export * from "./ContractGenerator";
export * from "./DatabaseUpdater";
export * from "./firebird-compat";

export * from "./accessi-module";
export * from "./allegati-module";
export * from "node-firebird";
export { autobind, ExecutionTimeLogger, Logger, LogLevels, Orm, DateUtilities, RestUtilities, DatabaseUtilities, DatabaseUpdater, StatusCode, DocumentGenerator, Firebird };
// Unified module exports
export * from "./openapi/OpenApiConfig";
export * from "./openapi/OpenApiMerge";
export * from "./initEmilsoftwareModule";
