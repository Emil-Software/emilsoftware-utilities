import { INestApplication } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { Logger } from "../Logger";

export type SwaggerSetupOptions = {
    swaggerPath?: string;
    title?: string;
    description?: string;
};

export function setupSwagger(app: INestApplication, options?: SwaggerSetupOptions) {
    const logger: Logger = new Logger("SwaggerConfig");
    const swaggerPath = options?.swaggerPath ?? "swagger";
    const swaggerJsonPath = `${swaggerPath}-json`;

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

    let port = app.getHttpServer()?.address?.port || 3000;

    logger.info(
        `Swagger documentation available at: http://localhost:${port}/${swaggerPath}`
    );
}
