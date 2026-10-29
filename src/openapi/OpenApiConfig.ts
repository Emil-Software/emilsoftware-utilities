import { INestApplication } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { Request, Response } from "express";
import { AddressInfo } from "net";
import { Logger } from "../Logger";

export type SwaggerSetupOptions = {
    swaggerPath?: string;
    swaggerJsonPath?: string;
    title?: string;
    description?: string;
};

export function setupSwagger(app: INestApplication, options?: SwaggerSetupOptions) {
    const logger: Logger = new Logger("SwaggerConfig");
    // Naming industriale OpenAPI: `/openapi` (UI) e `/openapi.json` (spec).
    // Il path e' configurabile per consentire piu' documentazioni sotto prefissi
    // dedicati (es. `accessi/openapi`).
    const swaggerPath = (options?.swaggerPath ?? "openapi").replace(/^\/+|\/+$/g, "");
    const swaggerJsonPath = (options?.swaggerJsonPath ?? `${swaggerPath}.json`).replace(/^\/+/, "");
    // Manteniamo l'alias storico `<path>-json` per non rompere i consumer esistenti.
    const legacySwaggerJsonPath = `${swaggerPath}-json`;

    const config = new DocumentBuilder()
        .setTitle(options?.title ?? "API Documentation")
        .setDescription(options?.description ?? "API per la gestione di accessi utenti e allegati")
        .setVersion("1.0")
        .addBearerAuth() // Per abilitare l'autenticazione JWT
        .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup(swaggerPath, app, document);

    app.use(`/${swaggerJsonPath}`, (_req: Request, res: Response) => {
        res.setHeader("Content-Type", "application/json");
        res.send(document);
    });

    if (legacySwaggerJsonPath !== swaggerJsonPath) {
        app.use(`/${legacySwaggerJsonPath}`, (_req: Request, res: Response) => {
            res.setHeader("Content-Type", "application/json");
            res.send(document);
        });
    }

    const serverAddress = app.getHttpServer()?.address?.();
    const port = serverAddress && typeof serverAddress === "object"
        ? (serverAddress as AddressInfo).port
        : 3000;

    logger.info(
        `Swagger documentation available at: http://localhost:${port}/${swaggerPath}`
    );
    logger.info(
        `Swagger OpenAPI JSON available at: http://localhost:${port}/${swaggerJsonPath}`
    );
}
