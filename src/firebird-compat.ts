import * as Firebird from "node-firebird";
import type { Options } from "node-firebird";

export type FirebirdWireCryptMode = "disabled" | "enabled" | "required";
export type FirebirdAuthPlugin = "Legacy_Auth" | "Srp" | "Srp256" | "Srp384" | "Srp512";
export type FirebirdDriverStrategy = "modern";

export type FirebirdOptions = Options & {
    wireCrypt?: FirebirdWireCryptMode | number;
    pluginName?: FirebirdAuthPlugin;
    authPlugins?: FirebirdAuthPlugin[];
    connectTimeoutMs?: number;
    compatibilityProbeTimeoutMs?: number;
    compatibilityTotalTimeoutMs?: number;
    firebirdDriver?: FirebirdDriverStrategy;
};

type FirebirdErrorContext = {
    stage: "attach" | "query" | "execute" | "transaction";
    sql?: string;
};

type EnhancedFirebirdError = Error & {
    cause?: unknown;
    gdscode?: number;
    gdsparams?: unknown;
    __emilsoftwareFirebirdEnhanced?: boolean;
};

function isBlank(value: unknown): boolean {
    return value === undefined || value === null || (typeof value === "string" && value.trim() === "");
}

function normalizeWireCryptMode(value: FirebirdOptions["wireCrypt"]): number | undefined {
    if (isBlank(value)) {
        return undefined;
    }

    if (typeof value === "number") {
        return value;
    }

    const normalized = String(value).trim().toLowerCase();
    if (normalized === "disabled") {
        return Firebird.WIRE_CRYPT_DISABLE;
    }

    return Firebird.WIRE_CRYPT_ENABLE;
}

function normalizeAuthPlugin(value: unknown): FirebirdAuthPlugin | undefined {
    if (isBlank(value)) {
        return undefined;
    }

    const normalized = String(value).trim().toLowerCase();
    if (normalized === "legacy" || normalized === "legacy_auth") {
        return "Legacy_Auth";
    }

    if (normalized === "srp256") {
        return "Srp256";
    }

    if (normalized === "srp384") {
        return "Srp384";
    }

    if (normalized === "srp512") {
        return "Srp512";
    }

    return "Srp";
}

function formatWireCryptValue(value: FirebirdOptions["wireCrypt"]): string {
    if (isBlank(value)) {
        return "auto";
    }

    if (typeof value === "number") {
        if (value === Firebird.WIRE_CRYPT_DISABLE) {
            return "disabled";
        }

        if (value === Firebird.WIRE_CRYPT_ENABLE) {
            return "enabled";
        }

        return String(value);
    }

    return String(value);
}

function formatTarget(options: Options): string {
    return `${options.host ?? "?"}:${options.port ?? "?"} -> ${options.database ?? "?"}`;
}

function uniqueDiagnostics(values: string[]): string[] {
    return values.filter((value, index) => values.indexOf(value) === index);
}

function buildDiagnostics(message: string, options: FirebirdOptions): string[] {
    const diagnostics: string[] = [];
    const pluginMismatch = message.match(/Server don't accept plugin\s*:\s*([^,]+),\s*but support\s*:\s*(.+)$/i);

    if (pluginMismatch) {
        const supportedPlugins = pluginMismatch[2]
            .split(",")
            .map((plugin) => plugin.trim())
            .filter((plugin) => plugin.length > 0);
        const supportedMessage = supportedPlugins.length === 1
            ? `The server explicitly reported that only the "${supportedPlugins[0]}" authentication plugin is supported.`
            : `The server explicitly reported the supported authentication plugins: ${supportedPlugins.join(", ")}.`;
        diagnostics.push(supportedMessage);
    }

    if (/Incompatible wire encryption levels requested on client and server/i.test(message)) {
        diagnostics.push("The server rejected the requested wire encryption mode. Keep wire encryption auto-enabled unless the server is known to allow disabled encryption.");
    }

    if (/No matching plugins on server/i.test(message)) {
        diagnostics.push("The server did not find a common authentication plugin with the client configuration.");
    }

    if (/Connection timeout after \d+ms/i.test(message) || /Timeout during Firebird attach after \d+ ms/i.test(message)) {
        diagnostics.push("The TCP connection was accepted but the Firebird wire-protocol attach did not complete in time.");
    }

    if (options.pluginName) {
        diagnostics.push(`Client authentication plugin was forced to "${options.pluginName}". Leave pluginName empty to let the driver auto-negotiate when possible.`);
    }

    if (!isBlank(options.wireCrypt)) {
        diagnostics.push(`Client wire encryption was forced to "${formatWireCryptValue(options.wireCrypt)}".`);
    }

    return uniqueDiagnostics(diagnostics);
}

function copyFirebirdMetadata(target: EnhancedFirebirdError, source: unknown): void {
    if (!source || typeof source !== "object") {
        return;
    }

    const firebirdSource = source as Record<string, unknown>;
    if ("gdscode" in firebirdSource) {
        target.gdscode = firebirdSource.gdscode as number;
    }

    if ("gdsparams" in firebirdSource) {
        target.gdsparams = firebirdSource.gdsparams;
    }
}

function formatFirebirdMetadata(source: unknown): string {
    if (!source || typeof source !== "object") {
        return "";
    }

    const firebirdSource = source as Record<string, unknown>;
    const metadata: string[] = [];

    if (typeof firebirdSource.gdscode === "number") {
        metadata.push(`gdscode=${firebirdSource.gdscode}`);
    }

    if (firebirdSource.gdsparams !== undefined) {
        try {
            metadata.push(`gdsparams=${JSON.stringify(firebirdSource.gdsparams)}`);
        } catch {
            metadata.push(`gdsparams=${String(firebirdSource.gdsparams)}`);
        }
    }

    return metadata.length > 0 ? ` Metadata: ${metadata.join(", ")}.` : "";
}

export function normalizeFirebirdOptions(options: Options): FirebirdOptions {
    const compatibilityOptions = options as FirebirdOptions;
    const {
        authPlugins: _authPlugins,
        compatibilityProbeTimeoutMs: _compatibilityProbeTimeoutMs,
        compatibilityTotalTimeoutMs,
        connectTimeoutMs,
        firebirdDriver: _firebirdDriver,
        ...baseOptions
    } = compatibilityOptions;

    const normalizedOptions: FirebirdOptions = {
        ...baseOptions,
        pluginName: normalizeAuthPlugin(compatibilityOptions.pluginName),
        wireCrypt: normalizeWireCryptMode(compatibilityOptions.wireCrypt),
    };

    const timeoutCandidate = compatibilityOptions.connectTimeout
        ?? connectTimeoutMs
        ?? compatibilityTotalTimeoutMs;

    if (Number.isFinite(timeoutCandidate) && Number(timeoutCandidate) > 0) {
        normalizedOptions.connectTimeout = Math.trunc(Number(timeoutCandidate));
    }

    return normalizedOptions;
}

export function describeFirebirdCompatibilityOptions(options: Options): string {
    const normalized = normalizeFirebirdOptions(options);
    return `plugin=${normalized.pluginName ?? "auto"}, wireCrypt=${formatWireCryptValue(normalized.wireCrypt)}, connectTimeout=${normalized.connectTimeout ?? "default"}`;
}

export function enhanceFirebirdError(error: unknown, options: Options, context: FirebirdErrorContext): Error {
    if (error instanceof Error && (error as EnhancedFirebirdError).__emilsoftwareFirebirdEnhanced) {
        return error;
    }

    const normalizedOptions = normalizeFirebirdOptions(options);
    const target = formatTarget(normalizedOptions);
    const original = error instanceof Error ? error : new Error(String(error));
    const diagnostics = buildDiagnostics(original.message, normalizedOptions);
    const sqlSuffix = context.sql ? ` SQL: ${context.sql.replace(/\s+/g, " ").trim()}` : "";
    const diagnosticsSuffix = diagnostics.length > 0 ? ` Diagnostics: ${diagnostics.join(" ")}` : "";
    const metadataSuffix = formatFirebirdMetadata(original);
    const enhanced = new Error(
        `Firebird ${context.stage} failed on ${target}: ${original.message}.${diagnosticsSuffix}${metadataSuffix}${sqlSuffix}`
    ) as EnhancedFirebirdError;

    enhanced.cause = original;
    enhanced.__emilsoftwareFirebirdEnhanced = true;
    copyFirebirdMetadata(enhanced, original);
    enhanced.stack = `${enhanced.name}: ${enhanced.message}\nCaused by: ${original.stack ?? original.message}`;
    return enhanced;
}

export function buildFirebirdCompatibilityCandidates(options: Options): FirebirdOptions[] {
    return [normalizeFirebirdOptions(options)];
}

export function shouldRetryFirebirdCompatibility(): boolean {
    return false;
}

export function ensureEsNodeFirebirdCompatibilityPatch(): void {
    // No-op kept for backward compatibility. The library now relies on the
    // official node-firebird driver, which handles Firebird 2.5+ protocol
    // negotiation natively.
}
