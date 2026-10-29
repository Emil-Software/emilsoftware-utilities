import { INestApplication } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import type { OpenAPIObject } from "@nestjs/swagger";
import { Request, Response } from "express";
import { AddressInfo } from "net";
import { Logger } from "../Logger";

/**
 * Opzioni di setup della documentazione OpenAPI.
 *
 * `enabled: false` disabilita UI e JSON ma non il documento generato, che resta
 * disponibile al chiamante per essere mergiato nel documento OpenAPI dell'host.
 */
export type OpenApiSetupOptions = {
    enabled?: boolean;
    openApiPath?: string;
    openApiJsonPath?: string;
    title?: string;
    description?: string;
    /** Callback invocata subito dopo la generazione del documento OpenAPI. */
    onDocument?: (document: OpenAPIObject) => void;
};

/** Opzioni OpenAPI risolte: nessun campo opzionale salvo il callback. */
export interface ResolvedOpenApiSetupOptions {
    enabled: boolean;
    openApiPath: string;
    openApiJsonPath: string;
    title: string;
    description: string;
    onDocument?: (document: OpenAPIObject) => void;
}

/**
 * Default storici della documentazione Accessi.
 *
 * I consumer esistenti non devono cambiare comportamento: senza override la UI
 * resta su `accessi/openapi` e la spec su `accessi/openapi.json`.
 */
export const DEFAULT_ACCESSI_OPENAPI = {
    enabled: true,
    openApiPath: "accessi/openapi",
    openApiJsonPath: "accessi/openapi.json",
    title: "Accessi API Documentation",
    description: "API del modulo accessi",
} as const satisfies ResolvedOpenApiSetupOptions;

/** Default del setup OpenAPI generico (usato direttamente da `setupOpenApi`). */
const DEFAULT_OPENAPI_SETUP = {
    enabled: true,
    openApiPath: "openapi",
    openApiJsonPath: "openapi.json",
    title: "API Documentation",
    description: "API per la gestione di accessi utenti e allegati",
} as const satisfies ResolvedOpenApiSetupOptions;

function normalizeOpenApiPath(value: string): string {
    return value.replace(/^\/+|\/+$/g, "");
}

function normalizeOpenApiJsonPath(value: string): string {
    return value.replace(/^\/+|\/+$/g, "");
}

/**
 * Unisce i livelli di configurazione ignorando le proprieta `undefined`.
 *
 * A differenza dello spread semplice, un `{ openApiPath: undefined }` esplicito
 * non cancella il default del livello precedente.
 */
function mergeOpenApiSetupOptions(
    defaults: OpenApiSetupOptions,
    ...overrides: Array<OpenApiSetupOptions | undefined>
): OpenApiSetupOptions {
    const merged: OpenApiSetupOptions = { ...defaults };
    for (const override of overrides) {
        if (!override) continue;
        if (override.enabled !== undefined) merged.enabled = override.enabled;
        if (override.openApiPath !== undefined) merged.openApiPath = override.openApiPath;
        if (override.openApiJsonPath !== undefined) merged.openApiJsonPath = override.openApiJsonPath;
        if (override.title !== undefined) merged.title = override.title;
        if (override.description !== undefined) merged.description = override.description;
        if (override.onDocument !== undefined) merged.onDocument = override.onDocument;
    }
    return merged;
}

/**
 * Risolve i default e i vari livelli di override in un'unica configurazione.
 *
 * L'ordine dei livelli e esplicito: i parametri successivi vincono sui precedenti.
 */
export function resolveOpenApiSetupOptions(
    defaults: OpenApiSetupOptions = DEFAULT_OPENAPI_SETUP,
    ...overrides: Array<OpenApiSetupOptions | undefined>
): ResolvedOpenApiSetupOptions {
    const merged = mergeOpenApiSetupOptions(defaults, ...overrides);
    const defaultOpenApiPath = normalizeOpenApiPath(defaults.openApiPath ?? "openapi") || "openapi";
    const openApiPath = normalizeOpenApiPath(merged.openApiPath ?? defaultOpenApiPath) || defaultOpenApiPath;

    // Storico: se si cambia solo `openApiPath`, il JSON segue il nuovo path
    // (`<path>.json`). Un `openApiJsonPath` esplicito in un override vince sempre.
    const explicitJsonPath = [...overrides]
        .reverse()
        .find((override) => override?.openApiJsonPath !== undefined)
        ?.openApiJsonPath;
    const hasOverrides = overrides.some((override) => override !== undefined);
    const jsonPathCandidate = explicitJsonPath
        ?? (hasOverrides ? `${openApiPath}.json` : (merged.openApiJsonPath ?? `${openApiPath}.json`));
    const openApiJsonPath = normalizeOpenApiJsonPath(jsonPathCandidate) || `${openApiPath}.json`;

    return {
        enabled: merged.enabled !== false,
        openApiPath,
        openApiJsonPath,
        title: merged.title ?? "API Documentation",
        description: merged.description ?? "API per la gestione di accessi utenti e allegati",
        ...(merged.onDocument ? { onDocument: merged.onDocument } : {}),
    };
}

/**
 * Risolve la configurazione OpenAPI di Accessi.
 *
 * I livelli successivi vincono sui precedenti, quindi la variante unificata puo
 * usare `resolveAccessiOpenApiOptions(accessiOptions.openapi, emilsoftwareOptions.openapi)`.
 */
export function resolveAccessiOpenApiOptions(
    ...overrides: Array<OpenApiSetupOptions | undefined>
): ResolvedOpenApiSetupOptions {
    return resolveOpenApiSetupOptions(DEFAULT_ACCESSI_OPENAPI, ...overrides);
}

/**
 * Path da passare a `setGlobalPrefix` per escludere la documentazione.
 *
 * Usa la sintassi wildcard di path-to-regexp v8 (`{*path}`) per evitare il
 * LegacyRouteConverter warning di Nest.
 */
export function buildOpenApiExcludePaths(options: ResolvedOpenApiSetupOptions): string[] {
    if (!options.enabled) return [];
    return [`/${options.openApiPath}`, `/${options.openApiPath}/{*path}`];
}

/** True se il path Express appartiene alla documentazione OpenAPI configurata. */
export function isOpenApiRequestPath(path: string, options: ResolvedOpenApiSetupOptions): boolean {
    if (!options.enabled) return false;

    const uiPath = `/${options.openApiPath}`;
    if (path === uiPath || path.startsWith(`${uiPath}/`)) return true;

    return path === `/${options.openApiJsonPath}` || path === `/${options.openApiPath}-json`;
}

/**
 * Genera il documento OpenAPI e, se `enabled` non e false, monta UI e JSON.
 *
 * Il documento viene sempre restituito: questo permette all'host di mergiarlo
 * nel proprio documento unico anche quando la UI del modulo e disabilitata.
 */
export function setupOpenApi(app: INestApplication, options?: OpenApiSetupOptions): OpenAPIObject {
    const logger: Logger = new Logger("OpenApiConfig");
    const resolved = resolveOpenApiSetupOptions(DEFAULT_OPENAPI_SETUP, options);

    const config = new DocumentBuilder()
        .setTitle(resolved.title)
        .setDescription(resolved.description)
        .setVersion("1.0")
        .addBearerAuth() // Per abilitare l'autenticazione JWT
        .build();

    const document = SwaggerModule.createDocument(app, config);
    resolved.onDocument?.(document);

    if (!resolved.enabled) {
        logger.info("OpenAPI disabilitato: UI e JSON non montati.");
        return document;
    }

    SwaggerModule.setup(resolved.openApiPath, app, document);

    app.use(`/${resolved.openApiJsonPath}`, (_req: Request, res: Response) => {
        res.setHeader("Content-Type", "application/json");
        res.send(document);
    });

    // Manteniamo l'alias storico `<path>-json` per non rompere i consumer esistenti.
    const legacyOpenApiJsonPath = `${resolved.openApiPath}-json`;
    if (legacyOpenApiJsonPath !== resolved.openApiJsonPath) {
        app.use(`/${legacyOpenApiJsonPath}`, (_req: Request, res: Response) => {
            res.setHeader("Content-Type", "application/json");
            res.send(document);
        });
    }

    const serverAddress = app.getHttpServer()?.address?.();
    const port = serverAddress && typeof serverAddress === "object"
        ? (serverAddress as AddressInfo).port
        : 3000;

    logger.info(
        `OpenAPI documentation available at: http://localhost:${port}/${resolved.openApiPath}`
    );
    logger.info(
        `OpenAPI JSON available at: http://localhost:${port}/${resolved.openApiJsonPath}`
    );

    return document;
}
