import express, { Application, Request } from "express";
import { NestFactory } from "@nestjs/core";
import { ExpressAdapter } from "@nestjs/platform-express";
import type { INestApplication } from "@nestjs/common";
import type { OpenAPIObject } from "@nestjs/swagger";
import { AccessiModule, AccessiOptions } from "./AccessiModule";
import { Logger } from "../Logger";
import { AuthService } from "./Services/AuthService/AuthService";
import {
    buildOpenApiExcludePaths,
    isOpenApiRequestPath,
    resolveAccessiOpenApiOptions,
    setupOpenApi
} from "../openapi/OpenApiConfig";
import {
    beginAccessiAuthInitialization,
    failAccessiAuthInitialization,
    setAccessiAuthService
} from "./middleware/authenticateGen";
import { registerAccessiModuleServices } from "./accessiRuntime";
import { logAccessiStartup } from "./startupLog";
import { createAccessiValidationPipe } from './security/accessiValidation';
import { AccessiHttpExceptionFilter } from './security/AccessiHttpExceptionFilter';
import { assertEmailConfigured } from './security/emailConfiguration';
import { getAccessiJwksPath, setupAccessiJwks } from './security/jwks';
import { createAccessiEdgeRateLimitMiddleware } from './security/edgeRateLimit';

/** Esito del bootstrap Express di Accessi. */
export interface AccessiModuleInitializationResult {
    /** Sotto-app Nest che serve `/api/accessi/*` e la documentazione. */
    nestApp: INestApplication;
    /** Documento OpenAPI generato, mergiabile nel documento unico dell'host. */
    document: OpenAPIObject;
}

function describeDatabaseTarget(options: AccessiOptions): string {
    const dbOptions = options.databaseOptions as {
        host?: string;
        port?: number;
        database?: string;
        user?: string;
    };

    return `${dbOptions.host ?? "?"}:${dbOptions.port ?? "?"} -> ${dbOptions.database ?? "?"} as ${dbOptions.user ?? "?"}`;
}

/**
 * Monta il modulo Accessi in un'applicazione Express gia esistente.
 *
 * Il bootstrap crea un host Nest isolato per le rotte `/api/accessi`, inizializza la
 * documentazione OpenAPI, validazione ed error handler, quindi rende disponibile
 * `authorizeAccessi` al resto dell'app.
 * Attendere questa Promise prima di aprire la porta HTTP: durante il bootstrap il middleware
 * restituisce `ACCESSI_AUTH_INITIALIZING` invece di autorizzare richieste parzialmente inizializzate.
 *
 * @param app Applicazione Express ospitante. Non viene sostituita ne vengono intercettate rotte estranee ad Accessi.
 * @param options Configurazione riservata del modulo; proviene normalmente da variabili d'ambiente o secret manager.
 * @returns Il sotto-app Nest e il documento OpenAPI generato (utile per il merge nell'host).
 */
export async function initializeAccessiModule(
    app: Application,
    options: AccessiOptions
): Promise<AccessiModuleInitializationResult> {
    // Il servizio email e obbligatorio: reset password, 2FA e creazione utente ne dipendono.
    assertEmailConfigured(options);
    const logger: Logger = new Logger("initializeAccessiModule");
    beginAccessiAuthInitialization();
    const startedAt = performance.now();
    const resolvedOpenApi = resolveAccessiOpenApiOptions(options.openapi);

    try {
        logger.info("Inizializzazione modulo accessi avviata.");
        logger.info(`Target database accessi: ${describeDatabaseTarget(options)}`);
        logger.info(
            `Configurazione accessi: autoUpdateDatabase=${options.autoUpdateDatabase !== false}, legacyPasswordMigrationOnStartup=${options.legacyPasswordMigrationOnStartup !== false}`
        );
        const nestHostApp = express();
        if (options.http?.trustProxy !== undefined) {
            app.set('trust proxy', options.http.trustProxy);
            nestHostApp.set('trust proxy', options.http.trustProxy);
        }
        const jwksPath = getAccessiJwksPath(options);
        const isAccessiRoute = (path: string) =>
            path === "/api/accessi" ||
            path.startsWith("/api/accessi/") ||
            isOpenApiRequestPath(path, resolvedOpenApi) ||
            (jwksPath !== undefined && path === jwksPath);
        const edgeRateLimit = options.edgeRateLimit
            ? createAccessiEdgeRateLimitMiddleware({
                ...options.edgeRateLimit,
                match: options.edgeRateLimit.match ?? ((path) => isAccessiRoute(path)),
            })
            : undefined;
        if (edgeRateLimit) {
            app.use(edgeRateLimit);
        }
        if (options.http?.securityHeaders !== false) {
            app.use((req: Request, res, next) => {
                if (!isAccessiRoute(req.path)) {
                    return next();
                }
                res.setHeader('X-Content-Type-Options', 'nosniff');
                res.setHeader('X-Frame-Options', 'SAMEORIGIN');
                res.setHeader('Referrer-Policy', 'no-referrer');
                res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
                return next();
            });
        }

        app.use((req: Request, res, next) => {
            if (!isAccessiRoute(req.path)) {
                return next();
            }

            return nestHostApp(req, res, next);
        });

        setupAccessiJwks(app, options);
        if (jwksPath) {
            logger.info(`JWKS accessi disponibile su: ${jwksPath}`);
        }

        const nestExpressInstance = new ExpressAdapter(nestHostApp);

        const nestApp = await NestFactory.create(AccessiModule.forRoot(options), nestExpressInstance, {
            bufferLogs: options.bufferLogs !== false,
            ...(options.logger ? { logger: options.logger } : {})
        });
        logger.info("Applicazione Nest accessi creata.");

        if (options.http?.cors !== false) {
            nestApp.enableCors(options.http?.cors ?? { exposedHeaders: ['X-Total-Count'] });
        }
        nestApp.useGlobalPipes(createAccessiValidationPipe());
        nestApp.useGlobalFilters(new AccessiHttpExceptionFilter());

        nestApp.setGlobalPrefix('api', {
            exclude: buildOpenApiExcludePaths(resolvedOpenApi)
        });

        const document = setupOpenApi(nestApp, resolvedOpenApi);
        logger.info("Avvio init del modulo accessi.");
        await nestApp.init();
        logger.info("Init del modulo accessi completata.");
        if (options.legacyPasswordMigrationOnStartup !== false) {
            logger.info("Avvio migrazione password legacy accessi.");
            const passwordMigrationService = nestApp.get(AuthService);
            await passwordMigrationService.migrateLegacyEncryptedPasswords();
            logger.info("Migrazione password legacy accessi completata.");
        }

        const accessiServices = registerAccessiModuleServices(app, nestApp);
        app.locals.accessiAuthService = accessiServices.authenticateGenService;
        setAccessiAuthService(accessiServices.authenticateGenService);
        logAccessiStartup(options, resolvedOpenApi);
        const elapsedMs = performance.now() - startedAt;
        logger.info(`Accessi initialized. Tempo totale bootstrap: ${elapsedMs.toFixed(2)} ms`);

        return { nestApp, document };
    } catch (error) {
        failAccessiAuthInitialization(error);
        logger.error(
            "Errore in initialize AccessiModule:",
            error instanceof Error
                ? { name: error.name, message: error.message, stack: error.stack }
                : { error: String(error) }
        );
        throw error;
    }
}

export { AccessiModule } from "./AccessiModule";
export { AccessiIntrospectionController } from "./Controllers/AccessiIntrospectionController";
export { FederatedAuthExchangeController } from "./federated-auth/FederatedAuthExchangeController";
export type { AccessiTokenIntrospectionResult } from "./Services/AuthService/AuthService";
export { AccessiDatabaseUpdater } from "./database-updates/AccessiDatabaseUpdater";
export type { AccessiOptions, EmailOptions, JwtOptions, ExtensionFieldsOptions, PublicAuthRateLimitOptions, PublicAuthRateLimitRuleOptions } from "./AccessiModule";
export type { PublicRegistrationOptions, FederatedAuthenticationOptions, ServiceTokenOptions } from "./AccessiModule";
export type { CatalogScriptsOptions, CatalogScriptChecksumPolicy, ConsoleEntryOptions } from "./AccessiModule";
export {
    createMemoryConsoleEntryStore,
    createRedisConsoleEntryStore,
    getDefaultConsoleEntryStore
} from './security/consoleEntry';
export type {
    ConsoleEntryRedisClient,
    ConsoleEntryRecord,
    ConsoleEntryStore,
    ConsoleEntryTicket,
    MemoryConsoleEntryStore,
    RedisConsoleEntryStoreOptions
} from './security/consoleEntry';
export {
    createMemoryRateLimitStore,
    createRedisRateLimitStore,
    getDefaultRateLimitStore
} from './security/rateLimitStore';
export type {
    MemoryRateLimitStore,
    RateLimitDecision,
    RateLimitRedisClient,
    RateLimitStore,
    RedisRateLimitStoreOptions
} from './security/rateLimitStore';
export { createAccessiEdgeRateLimitMiddleware } from './security/edgeRateLimit';
export type {
    AccessiEdgeRateLimitMiddleware,
    AccessiEdgeRateLimitOptions
} from './security/edgeRateLimit';
export {
    assertValidAccessiOptions,
    validateAccessiOptions
} from './security/validateOptions';
export { auditAccessi } from './security/audit';
export {
    createMemorySessionRevocationStore,
    createRedisSessionRevocationStore,
    revokeAccessiUserSessions,
    isAccessiTokenRevoked,
    getSessionRevocationStore
} from './security/sessionRevocation';
export type {
    MemorySessionRevocationStore,
    RedisSessionRevocationStoreOptions,
    SessionRevocationOptions,
    SessionRevocationRedisClient,
    SessionRevocationStore
} from './security/sessionRevocation';
export {
    createMemoryRefreshTokenRotationStore,
    createRedisRefreshTokenRotationStore,
    getRefreshTokenRotationStore
} from './security/refreshTokenRotation';
export type {
    MemoryRefreshTokenRotationStore,
    RedisRefreshTokenRotationStoreOptions,
    RefreshTokenRotationOptions,
    RefreshTokenRotationRedisClient,
    RefreshTokenRotationStore
} from './security/refreshTokenRotation';
export type {
    AccessiOptionsValidationIssue,
    AccessiOptionsValidationResult
} from './security/validateOptions';
export {
    AccessiCatalogMigrator,
    applyCatalogScripts,
    listPendingCatalogScripts,
    splitSqlStatements,
    analyzeCatalogScript,
    leadingStatementKeyword,
    computeCatalogScriptChecksum,
    discoverCatalogScripts
} from "./database-updates/AccessiCatalogMigrator";
export type { CatalogMigrationReport, CatalogScriptMigration } from "./database-updates/AccessiCatalogMigrator";
export { ServiceTokenService } from './Services/ServiceTokenService/ServiceTokenService';
export type {
    ServiceTokenMetadata,
    IssuedServiceToken,
    VerifiedServiceToken,
    IssueServiceTokenInput
} from './Services/ServiceTokenService/ServiceTokenService';
export { SchemaExportService } from './Services/SchemaExportService/SchemaExportService';
export type { SchemaDdlResult, SchemaDdlSection, SchemaEntitiesResult } from './Services/SchemaExportService/SchemaExportService';
export { AdminBootstrapService } from './Services/AdminBootstrapService/AdminBootstrapService';
export type { BootstrapAdminResult } from './Services/AdminBootstrapService/AdminBootstrapService';
export {
    getOrCreateAdminBootstrapToken,
    getAdminBootstrapToken,
    clearAdminBootstrapToken,
    isValidAdminBootstrapToken
} from './security/adminBootstrap';
export { ServiceTokenGuard, RequireServiceTokenScopes, getAccessiServiceToken } from './security/serviceTokenGuard';
export { assertEmailConfigured, isEmailConfigured, AccessiEmailNotConfiguredError, ACCESSI_EMAIL_NOT_CONFIGURED } from './security/emailConfiguration';
export { buildLoginAsUrl, LOGIN_AS_QUERY_PARAM } from './security/loginAs';
export {
    buildAccessiJwks,
    createAccessiJwksHandler,
    getAccessiJwksPath,
    setupAccessiJwks
} from './security/jwks';
export type { AccessiJwksDocument, AccessiJwksKey } from './security/jwks';
export { FederatedAuthService } from './federated-auth/FederatedAuthService';
export type { FederatedAuthenticationResult, FederatedIdentity, FederatedProvider, VerifiedFederatedIdentity } from './federated-auth/FederatedAuthTypes';
export * from "./Dtos";
export {
    authorizeAccessi,
    authenticateGen
} from "./middleware/authenticateGen";
export { accessiRequirement } from "./middleware/accessiRequirements";
export {
    registerAccessiModuleServices,
    getAccessiModuleServices,
    ACCESSI_MODULE_SERVICES_LOCALS_KEY
} from "./accessiRuntime";
export type { AccessiModuleServices } from "./accessiRuntime";
export type {
    AccessiAuthorizationOptions,
    AccessiRequirementNode,
    AccessiCustomRequirementContext,
    AccessiCustomRequirementHandler
} from "./middleware/accessiRequirements";
