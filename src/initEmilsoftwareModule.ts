import express, { Application, Request } from "express";
import { NestFactory } from "@nestjs/core";
import { ExpressAdapter } from "@nestjs/platform-express";
import { setupSwagger } from "./swagger/SwaggerConfig";
import { Logger } from "./Logger";
import { EmilsoftwareModule, EmilsoftwareOptions } from "./EmilsoftwareModule";
import {
    beginAccessiAuthInitialization,
    failAccessiAuthInitialization,
    setAccessiAuthService
} from "./accessi-module/middleware/authenticateGen";
import { registerAccessiModuleServices } from "./accessi-module/accessiRuntime";
import { logAccessiStartup } from "./accessi-module/startupLog";
import { createAccessiValidationPipe } from './accessi-module/security/accessiValidation';
import { AccessiHttpExceptionFilter } from './accessi-module/security/AccessiHttpExceptionFilter';

/**
 * Initializes the unified module that combines Accessi and Allegati functionality
 * @param app Express application instance
 * @param options Configuration options for both modules
 */
export async function initEmilsoftwareModule(app: Application, options: EmilsoftwareOptions) {
    const logger: Logger = new Logger(initEmilsoftwareModule.name);
    if (options?.accessiOptions) {
        beginAccessiAuthInitialization();
    }

    try {
        // Isolate Nest on a dedicated Express instance and dispatch only module routes.
        // This keeps pre-existing routes/middlewares on the host app untouched.
        // Prefisso OpenAPI configurabile (default `accessi/openapi`), cosi' piu'
        // documentazioni possono convivere (backend su `/openapi`, moduli sotto
        // `/<modulo>/openapi`).
        const swaggerPath = (options?.swagger?.swaggerPath ?? "accessi/openapi").replace(/^\/+|\/+$/g, "");
        const swaggerJsonPath = (options?.swagger?.swaggerJsonPath ?? `${swaggerPath}.json`).replace(/^\/+/, "");
        const legacySwaggerJsonPath = `${swaggerPath}-json`;
        const swaggerRoutePaths = [
            `/${swaggerPath}`,
            `/${swaggerPath}/`,
            `/${swaggerJsonPath}`,
            `/${legacySwaggerJsonPath}`,
        ];

        const nestHostApp = express();
        const isNestRoute = (path: string) =>
            path === "/api" ||
            path.startsWith("/api/") ||
            swaggerRoutePaths.some(
                (routePath) => path === routePath || path.startsWith(`${routePath.replace(/\/$/, "")}/`)
            );

        app.use((req: Request, res, next) => {
            if (!isNestRoute(req.path)) {
                return next();
            }
            return nestHostApp(req, res, next);
        });

        const nestExpressInstance = new ExpressAdapter(nestHostApp);
        const nestApp = await NestFactory.create(EmilsoftwareModule.forRoot(options), nestExpressInstance, {
            bufferLogs: true
        });

        nestApp.enableCors();
        if (options?.accessiOptions) {
            // Keep the Accessi API contract identical for standalone and unified bootstraps.
            nestApp.useGlobalPipes(createAccessiValidationPipe());
            nestApp.useGlobalFilters(new AccessiHttpExceptionFilter());
        }

        nestApp.setGlobalPrefix('api', {
            exclude: [`/${swaggerPath}`, `/${swaggerPath}/(.*)`]
        });

        // Documentazione OpenAPI del modulo unificato (Accessi + Allegati).
        setupSwagger(nestApp, {
            swaggerPath,
            swaggerJsonPath,
            title: options?.swagger?.title,
            description: options?.swagger?.description,
        });

        await nestApp.init();
        if (options?.accessiOptions) {
            const accessiServices = registerAccessiModuleServices(app, nestApp);
            app.locals.accessiAuthService = accessiServices.authenticateGenService;
            setAccessiAuthService(accessiServices.authenticateGenService);
            logAccessiStartup(options.accessiOptions);
        }

        logger.info("Emilsoftware module initialized successfully");

    } catch (error) {
        if (options?.accessiOptions) {
            failAccessiAuthInitialization(error);
        }
        logger.error("Error initializing Emilsoftware Module:", error);
        throw error;
    }
}
