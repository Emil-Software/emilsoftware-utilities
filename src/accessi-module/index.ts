import { Application } from "express";
import { NestFactory } from "@nestjs/core";
import { ExpressAdapter } from "@nestjs/platform-express";
import { AccessiModule, AccessiOptions } from "./AccessiModule";
import { Logger } from "../Logger";
import {
    AuthenticateGenService,
    setAccessiAuthOptions,
    setAccessiAuthService
} from "./middleware/authenticateGen";

export async function initializeAccessiModule(app: Application, options: AccessiOptions) {
    const logger: Logger = new Logger("initializeAccessiModule");

    console.log("Accessi initialized");
    try {
        // Inizializza subito il fallback middleware con le options.
        // Il servizio DI viene registrato dopo nestApp.init().
        setAccessiAuthOptions(options);

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
        setAccessiAuthService(nestApp.get(AuthenticateGenService));

    } catch (error) {
        logger.error("Errore in initialize AccessiModule:", error);
        throw error;
    }
}

export { AccessiModule } from "./AccessiModule";
export * from "./Dtos";
export {
    authorizeAccessi,
    authenticateGen,
    setAccessiAuthOptions,
    setAccessiAuthService
} from "./middleware/authenticateGen";
export { accessiRequirement } from "./middleware/accessiRequirements";
export type {
    AccessiAuthorizationOptions,
    AccessiRequirementNode,
    AccessiCustomRequirementContext,
    AccessiCustomRequirementHandler
} from "./middleware/accessiRequirements";
