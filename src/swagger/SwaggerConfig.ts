import { INestApplication } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { Logger } from "../Logger";

export type SwaggerSetupOptions = {
    swaggerPath?: string;
    swaggerJsonPath?: string;
    title?: string;
    description?: string;
};

export function setupSwagger(app: INestApplication, options?: SwaggerSetupOptions) {
    const logger: Logger = new Logger("SwaggerConfig");
    const swaggerPath = options?.swaggerPath ?? "swagger";
    const defaultSwaggerJsonPath = swaggerPath.includes("/")
        ? `${swaggerPath.substring(0, swaggerPath.lastIndexOf("/") + 1)}swagger.json`
        : "swagger.json";
    const swaggerJsonPath = options?.swaggerJsonPath ?? defaultSwaggerJsonPath;
    const legacySwaggerJsonPath = `${swaggerPath}-json`;

    const config = new DocumentBuilder()
        .setTitle(options?.title ?? "API Documentation")
        .setDescription(options?.description ?? "API per la gestione di accessi utenti e allegati")
        .setVersion("1.0")
        .addBearerAuth() // Per abilitare l'autenticazione JWT
        .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup(swaggerPath, app, document);

    app.use(`/${swaggerJsonPath}`, (_, res) => {
        res.setHeader("Content-Type", "application/json");
        res.send(document);
    });

    if (legacySwaggerJsonPath !== swaggerJsonPath) {
        app.use(`/${legacySwaggerJsonPath}`, (_, res) => {
            res.setHeader("Content-Type", "application/json");
            res.send(document);
        });
    }

    let port = app.getHttpServer()?.address?.port || 3000;

    logger.info(
        `Swagger documentation available at: http://localhost:${port}/${swaggerPath}`
    );
    logger.info(
        `Swagger OpenAPI JSON available at: http://localhost:${port}/${swaggerJsonPath}`
    );
}
