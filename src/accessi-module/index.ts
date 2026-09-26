import express, { Application, Request } from "express";
import { NestFactory } from "@nestjs/core";
import { ExpressAdapter } from "@nestjs/platform-express";
import { AccessiModule, AccessiOptions } from "./AccessiModule";
import { Logger } from "../Logger";
import { AuthService } from "./Services/AuthService/AuthService";
import { setupSwagger } from "../swagger/SwaggerConfig";
import {
    beginAccessiAuthInitialization,
    failAccessiAuthInitialization,
    setAccessiAuthService
} from "./middleware/authenticateGen";
import { registerAccessiModuleServices } from "./accessiRuntime";
import { createAccessiValidationPipe } from './security/accessiValidation';
import { AccessiHttpExceptionFilter } from './security/AccessiHttpExceptionFilter';
import { assertEmailConfigured } from './security/emailConfiguration';

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
 * Il bootstrap crea un host Nest isolato per le rotte `/api/accessi`, inizializza Swagger,
 * validazione ed error handler, quindi rende disponibile `authorizeAccessi` al resto dell'app.
 * Attendere questa Promise prima di aprire la porta HTTP: durante il bootstrap il middleware
 * restituisce `ACCESSI_AUTH_INITIALIZING` invece di autorizzare richieste parzialmente inizializzate.
 *
 * @param app Applicazione Express ospitante. Non viene sostituita ne vengono intercettate rotte estranee ad Accessi.
 * @param options Configurazione riservata del modulo; proviene normalmente da variabili d'ambiente o secret manager.
 */
export async function initializeAccessiModule(app: Application, options: AccessiOptions): Promise<void> {
    // Il servizio email e obbligatorio: reset password, 2FA e creazione utente ne dipendono.
    assertEmailConfigured(options);
    const logger: Logger = new Logger("initializeAccessiModule");
    beginAccessiAuthInitialization();
    const startedAt = performance.now();

    try {
        logger.info("Inizializzazione modulo accessi avviata.");
        logger.info(`Target database accessi: ${describeDatabaseTarget(options)}`);
        logger.info(
            `Configurazione accessi: autoUpdateDatabase=${options.autoUpdateDatabase !== false}, legacyPasswordMigrationOnStartup=${options.legacyPasswordMigrationOnStartup !== false}`
        );
        const nestHostApp = express();
        const isNestRoute = (path: string) =>
            path === "/api/accessi" ||
            path.startsWith("/api/accessi/") ||
            path === "/accessi/swagger" ||
            path.startsWith("/accessi/swagger/") ||
            path === "/accessi/swagger.json" ||
            path === "/accessi/swagger-json";

        app.use((req: Request, res, next) => {
            if (!isNestRoute(req.path)) {
                return next();
            }

            return nestHostApp(req, res, next);
        });

        const nestExpressInstance = new ExpressAdapter(nestHostApp);

        const nestApp = await NestFactory.create(AccessiModule.forRoot(options), nestExpressInstance, {
            bufferLogs: true
        });
        logger.info("Applicazione Nest accessi creata.");

        nestApp.enableCors({ exposedHeaders: ['X-Total-Count'] });
        nestApp.useGlobalPipes(createAccessiValidationPipe());
        nestApp.useGlobalFilters(new AccessiHttpExceptionFilter());

        nestApp.setGlobalPrefix('api', {
            exclude: ['/swagger', '/swagger/(.*)']
        });

        setupSwagger(nestApp, {
            swaggerPath: "accessi/swagger",
            swaggerJsonPath: "accessi/swagger.json",
            title: "Accessi API Documentation",
            description: "API del modulo accessi",
        });
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
        const elapsedMs = performance.now() - startedAt;
        logger.info(`Accessi initialized. Tempo totale bootstrap: ${elapsedMs.toFixed(2)} ms`);

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
export { AccessiDatabaseUpdater } from "./database-updates/AccessiDatabaseUpdater";
export type { AccessiOptions, EmailOptions, JwtOptions, ExtensionFieldsOptions, PublicAuthRateLimitOptions, PublicAuthRateLimitRuleOptions } from "./AccessiModule";
export type { PublicRegistrationOptions, FederatedAuthenticationOptions, ServiceTokenOptions } from "./AccessiModule";
export type { CatalogScriptsOptions, CatalogScriptChecksumPolicy } from "./AccessiModule";
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
export { ServiceTokenGuard, RequireServiceTokenScopes, getAccessiServiceToken } from './security/serviceTokenGuard';
export { assertEmailConfigured, isEmailConfigured, AccessiEmailNotConfiguredError, ACCESSI_EMAIL_NOT_CONFIGURED } from './security/emailConfiguration';
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
