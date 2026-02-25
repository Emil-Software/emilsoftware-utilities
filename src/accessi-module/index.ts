import { Application } from "express";
import { NestFactory } from "@nestjs/core";
import { ExpressAdapter } from "@nestjs/platform-express";
import { AccessiModule, AccessiOptions } from "./AccessiModule";
import { Logger } from "../Logger";
import {
    beginAccessiAuthInitialization,
    failAccessiAuthInitialization,
    AuthenticateGenService,
    setAccessiAuthService
} from "./middleware/authenticateGen";

export async function initializeAccessiModule(app: Application, options: AccessiOptions) {
    const logger: Logger = new Logger("initializeAccessiModule");
    beginAccessiAuthInitialization();

    console.log("Accessi initialized");
    try {
        // Creiamo un'istanza Express separata per NestJS
        const nestExpressInstance = new ExpressAdapter(app);

        // Creiamo l'app NestJS attaccata a Express
        const nestApp = await NestFactory.create(AccessiModule.forRoot(options), nestExpressInstance, {
            bufferLogs: true
        });

        nestApp.enableCors();

        nestApp.setGlobalPrefix('api', {
            exclude: ['/swagger', '/swagger/(.*)']
        });

        // Note: Swagger setup is now handled by the unified module
        await nestApp.init();
        const authService = nestApp.get(AuthenticateGenService);
        app.locals.accessiAuthService = authService;
        setAccessiAuthService(authService);

    } catch (error) {
        failAccessiAuthInitialization(error);
        logger.error("Errore in initialize AccessiModule:", error);
        throw error;
    }
}

export { AccessiModule } from "./AccessiModule";
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
