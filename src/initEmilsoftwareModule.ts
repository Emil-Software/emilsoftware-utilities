import express, { Application, Request } from "express";
import { NestFactory } from "@nestjs/core";
import { ExpressAdapter } from "@nestjs/platform-express";
import type { INestApplication } from "@nestjs/common";
import type { OpenAPIObject } from "@nestjs/swagger";
import {
    buildOpenApiExcludePaths,
    isOpenApiRequestPath,
    resolveAccessiOpenApiOptions,
    setupOpenApi
} from "./openapi/OpenApiConfig";
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

/** Esito del bootstrap del modulo unificato. */
export interface EmilsoftwareModuleInitializationResult {
    /** Sotto-app Nest che serve Accessi, Allegati e la documentazione. */
    nestApp: INestApplication;
    /** Documento OpenAPI generato, mergiabile nel documento unico dell'host. */
    document: OpenAPIObject;
}

/**
 * Initializes the unified module that combines Accessi and Allegati functionality
 * @param app Express application instance
 * @param options Configuration options for both modules
 * @returns Il sotto-app Nest e il documento OpenAPI generato.
 */
export async function initEmilsoftwareModule(
    app: Application,
    options: EmilsoftwareOptions
): Promise<EmilsoftwareModuleInitializationResult> {
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
        // Precedenza: EmilsoftwareOptions.openapi > AccessiOptions.openapi > default.
        const resolvedOpenApi = resolveAccessiOpenApiOptions(
            options?.accessiOptions?.openapi,
            options?.openapi
        );

        const nestHostApp = express();
        const isNestRoute = (path: string) =>
            path === "/api" ||
            path.startsWith("/api/") ||
            isOpenApiRequestPath(path, resolvedOpenApi);

        app.use((req: Request, res, next) => {
            if (!isNestRoute(req.path)) {
                return next();
            }
            return nestHostApp(req, res, next);
        });

        const nestExpressInstance = new ExpressAdapter(nestHostApp);
        const nestApp = await NestFactory.create(EmilsoftwareModule.forRoot(options), nestExpressInstance, {
            bufferLogs: options?.bufferLogs !== false,
            ...(options?.logger ? { logger: options.logger } : {})
        });

        nestApp.enableCors();
        if (options?.accessiOptions) {
            // Keep the Accessi API contract identical for standalone and unified bootstraps.
            nestApp.useGlobalPipes(createAccessiValidationPipe());
            nestApp.useGlobalFilters(new AccessiHttpExceptionFilter());
        }

        nestApp.setGlobalPrefix('api', {
            exclude: buildOpenApiExcludePaths(resolvedOpenApi)
        });

        // Documentazione OpenAPI del modulo unificato (Accessi + Allegati).
        const document = setupOpenApi(nestApp, resolvedOpenApi);

        await nestApp.init();
        if (options?.accessiOptions) {
            const accessiServices = registerAccessiModuleServices(app, nestApp);
            app.locals.accessiAuthService = accessiServices.authenticateGenService;
            setAccessiAuthService(accessiServices.authenticateGenService);
            logAccessiStartup(options.accessiOptions, resolvedOpenApi);
        }

        logger.info("Emilsoftware module initialized successfully");

        return { nestApp, document };
    } catch (error) {
        if (options?.accessiOptions) {
            failAccessiAuthInitialization(error);
        }
        logger.error("Error initializing Emilsoftware Module:", error);
        throw error;
    }
}
