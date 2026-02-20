import { Application } from "express";
import { NestFactory } from "@nestjs/core";
import { ExpressAdapter } from "@nestjs/platform-express";
import { AccessiModule, AccessiOptions } from "./AccessiModule";
import { Logger } from "../Logger";
import { setAccessiAuthOptions } from "./middleware/authenticateGen";

export async function initializeAccessiModule(app: Application, options: AccessiOptions) {
    const logger: Logger = new Logger("initializeAccessiModule");

    console.log("Accessi initialized");
    try {
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

    } catch (error) {
        logger.error("Errore in initialize AccessiModule:", error);
        throw error;
    }
}

export { AccessiModule } from "./AccessiModule";
export * from "./Dtos";
export { authorizeAccessi, authenticateGen, setAccessiAuthOptions } from "./middleware/authenticateGen";
