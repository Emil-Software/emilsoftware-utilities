import express, { Application, Request } from "express";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { ExpressAdapter } from "@nestjs/platform-express";
import { AccessiModule, AccessiOptions } from "./AccessiModule";
import { Logger } from "../Logger";
import { AuthService } from "./Services/AuthService/AuthService";
import { setupSwagger } from "../swagger/SwaggerConfig";
import {
    beginAccessiAuthInitialization,
    failAccessiAuthInitialization,
    AuthenticateGenService,
    setAccessiAuthService
} from "./middleware/authenticateGen";

function describeDatabaseTarget(options: AccessiOptions): string {
    const dbOptions = options.databaseOptions as {
        host?: string;
        port?: number;
        database?: string;
        user?: string;
    };

    return `${dbOptions.host ?? "?"}:${dbOptions.port ?? "?"} -> ${dbOptions.database ?? "?"} as ${dbOptions.user ?? "?"}`;
}

export async function initializeAccessiModule(app: Application, options: AccessiOptions) {
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

        nestApp.enableCors();
        nestApp.useGlobalPipes(
            new ValidationPipe({
                whitelist: true,
                forbidNonWhitelisted: true,
                transform: true,
                transformOptions: {
                    enableImplicitConversion: true,
                },
            }),
        );

        nestApp.setGlobalPrefix('api', {
            exclude: ['/swagger', '/swagger/(.*)']
        });

        setupSwagger(nestApp, {
            swaggerPath: "accessi/swagger",
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

        const accessiAuthService = nestApp.get(AuthenticateGenService);
        app.locals.accessiAuthService = accessiAuthService;
        setAccessiAuthService(accessiAuthService);
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
export * from "./Dtos";
export {
    authorizeAccessi,
    authenticateGen
} from "./middleware/authenticateGen";
export { accessiRequirement } from "./middleware/accessiRequirements";
export type {
    AccessiAuthorizationOptions,
    AccessiRequirementNode,
    AccessiCustomRequirementContext,
    AccessiCustomRequirementHandler
} from "./middleware/accessiRequirements";
