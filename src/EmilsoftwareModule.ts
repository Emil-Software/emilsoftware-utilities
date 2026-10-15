import { DynamicModule, Module } from "@nestjs/common";
import { AccessiModule, AccessiOptions } from "./accessi-module/AccessiModule";
import { AllegatiModule, AllegatiOptions } from "./allegati-module/AllegatiModule";
import { Logger } from "./Logger";
import type { SwaggerSetupOptions } from "./swagger/SwaggerConfig";

/**
 * Configuration options for the unified module that combines Accessi and Allegati functionality
 */
export interface EmilsoftwareOptions {
    accessiOptions: AccessiOptions;
    allegatiOptions: AllegatiOptions;
    /**
     * Documentazione OpenAPI del modulo unificato. Default: `accessi/openapi`
     * (UI) e `accessi/openapi.json` (spec).
     */
    swagger?: SwaggerSetupOptions;
}

/**
 * Unified module that combines user access management (Accessi) and file attachment management (Allegati)
 * into a single NestJS module with shared Swagger documentation
 */
@Module({})
export class EmilsoftwareModule {
    static forRoot(options: EmilsoftwareOptions): DynamicModule {

        const logger: Logger = new Logger(EmilsoftwareModule.name);
        let imports = [];
        let exports = [];

        if (!options) {
            throw new Error("EmilsoftwareModule requires valid accessiOptions and allegatiOptions");
        }


        if (options.accessiOptions) {
            logger.info("Initializing AccessiModule with provided options.");
            imports.push(AccessiModule.forRoot(options.accessiOptions));
            exports.push(AccessiModule);
        }
        else {
            logger.warning("Accessi options are not provided. AccessiModule will not be initialized.");
        }

        if (options.allegatiOptions) {
            logger.info("Initializing AllegatiModule with provided options.");
            imports.push(AllegatiModule.forRoot(options.allegatiOptions));
            exports.push(AllegatiModule);
        }
        else {
            logger.warning("Allegati options are not provided. AllegatiModule will not be initialized.");
        }

        return {
            module: EmilsoftwareModule,
            imports,
            exports
        };
    }
} 