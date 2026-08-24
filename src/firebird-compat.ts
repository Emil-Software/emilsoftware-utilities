import * as Firebird from "es-node-firebird";
import { Options } from "es-node-firebird";

export type FirebirdWireCryptMode = "disabled" | "enabled" | "required";
export type FirebirdAuthPlugin = "Legacy_Auth" | "Srp" | "Srp256";

export type FirebirdOptions = Options & {
    wireCrypt?: FirebirdWireCryptMode;
    pluginName?: FirebirdAuthPlugin;
    authPlugins?: FirebirdAuthPlugin[];
    connectTimeoutMs?: number;
    connectTimeout?: number;
    compatibilityProbeTimeoutMs?: number;
    compatibilityTotalTimeoutMs?: number;
};

const CNCT_PLUGIN_NAME = 8;
const CNCT_PLUGIN_LIST = 10;
const CNCT_CLIENT_CRYPT = 11;
const WIRE_CRYPT_DISABLE = 0;
const WIRE_CRYPT_ENABLE = 1;
const WIRE_CRYPT_REQUIRED = 2;
const DEFAULT_AUTH_PLUGIN_LIST: FirebirdAuthPlugin[] = ["Srp256", "Srp", "Legacy_Auth"];

type BlrWriterLike = {
    addBytes: (bytes: number[], ...args: unknown[]) => unknown;
    addString: (code: number, value: string, encoding?: string) => unknown;
};

type ConnectionLike = {
    _blr?: BlrWriterLike;
    accept?: {
        protocolMinimumType?: number;
        pluginName?: string;
    };
};

type FirebirdModuleLike = {
    Connection?: {
        prototype?: {
            connect?: (this: ConnectionLike, options: FirebirdOptions, callback: unknown) => unknown;
            __emilsoftwareWireCryptPatched?: boolean;
        };
    };
};

function normalizeWireCryptMode(value: unknown): FirebirdWireCryptMode {
    const normalized = String(value ?? "").trim().toLowerCase();
    if (normalized === "required") {
        return "required";
    }

    if (normalized === "disabled") {
        return "disabled";
    }

    return "enabled";
}

function normalizeAuthPlugin(value: unknown): FirebirdAuthPlugin {
    const normalized = String(value ?? "").trim().toLowerCase();

    if (normalized === "legacy_auth" || normalized === "legacy") {
        return "Legacy_Auth";
    }

    if (normalized === "srp256") {
        return "Srp256";
    }

    return "Srp";
}

function toWireCryptFlag(mode: FirebirdWireCryptMode): number {
    switch (mode) {
        case "required":
            return WIRE_CRYPT_REQUIRED;
        case "disabled":
            return WIRE_CRYPT_DISABLE;
        default:
            return WIRE_CRYPT_ENABLE;
    }
}

function normalizeAuthPluginList(value: unknown): FirebirdAuthPlugin[] {
    if (!Array.isArray(value) || value.length === 0) {
        return [...DEFAULT_AUTH_PLUGIN_LIST];
    }

    const normalized = value
        .map((entry: unknown) => normalizeAuthPlugin(entry))
        .filter((entry: FirebirdAuthPlugin, index: number, source: FirebirdAuthPlugin[]) => source.indexOf(entry) === index);

    return normalized.length > 0 ? normalized : [...DEFAULT_AUTH_PLUGIN_LIST];
}

export function normalizeFirebirdOptions(options: Options): FirebirdOptions {
    const compatibilityOptions = options as FirebirdOptions;
    return {
        ...options,
        wireCrypt: compatibilityOptions.wireCrypt === undefined
            ? undefined
            : normalizeWireCryptMode(compatibilityOptions.wireCrypt),
        pluginName: compatibilityOptions.pluginName === undefined
            ? undefined
            : normalizeAuthPlugin(compatibilityOptions.pluginName),
        authPlugins: normalizeAuthPluginList(compatibilityOptions.authPlugins),
    };
}

function isRetryableCompatibilityError(error: unknown): boolean {
    const message = String((error as { message?: unknown })?.message ?? error ?? "").toLowerCase();
    return message.includes("incompatible wire encryption")
        || message.includes("no matching plugins on server")
        || message.includes("server don't accept plugin")
        || message.includes("unknown auth plugin")
        || message.includes("unknow auth plugin")
        || message.includes("timeout during firebird attach");
}

function pushUniqueCandidate(target: FirebirdOptions[], candidate: FirebirdOptions): void {
    const normalized = normalizeFirebirdOptions(candidate);
    const key = `${normalized.pluginName}|${normalized.wireCrypt}|${(normalized.authPlugins ?? []).join(",")}`;
    const alreadyPresent = target.some((entry) => {
        const normalizedEntry = normalizeFirebirdOptions(entry);
        return `${normalizedEntry.pluginName}|${normalizedEntry.wireCrypt}|${(normalizedEntry.authPlugins ?? []).join(",")}` === key;
    });

    if (!alreadyPresent) {
        target.push(normalized);
    }
}

function appendPluginCandidates(
    target: FirebirdOptions[],
    base: FirebirdOptions,
    pluginName: FirebirdAuthPlugin,
    wireCryptModes: FirebirdWireCryptMode[],
): void {
    wireCryptModes.forEach((wireCrypt) => {
        pushUniqueCandidate(target, { ...base, pluginName, wireCrypt });
    });
}

export function buildFirebirdCompatibilityCandidates(options: Options): FirebirdOptions[] {
    const normalized = normalizeFirebirdOptions(options);
    const compatibilityOptions = options as FirebirdOptions;
    const hasExplicitPlugin = compatibilityOptions.pluginName !== undefined;
    const hasExplicitWireCrypt = compatibilityOptions.wireCrypt !== undefined;
    const candidates: FirebirdOptions[] = [];

    if (hasExplicitPlugin && hasExplicitWireCrypt) {
        pushUniqueCandidate(candidates, normalized);
        return candidates;
    }

    if (hasExplicitPlugin) {
        const wireCryptModes = normalized.pluginName === "Legacy_Auth"
            ? ["disabled", "enabled"] as FirebirdWireCryptMode[]
            : ["enabled", "required", "disabled"] as FirebirdWireCryptMode[];

        appendPluginCandidates(candidates, normalized, normalized.pluginName!, wireCryptModes);
        return candidates;
    }

    if (hasExplicitWireCrypt) {
        appendPluginCandidates(candidates, normalized, "Srp256", [normalized.wireCrypt!]);
        appendPluginCandidates(candidates, normalized, "Srp", [normalized.wireCrypt!]);
        appendPluginCandidates(candidates, normalized, "Legacy_Auth", [normalized.wireCrypt!]);
        return candidates;
    }

    appendPluginCandidates(candidates, normalized, "Srp256", ["required", "enabled", "disabled"]);
    appendPluginCandidates(candidates, normalized, "Srp", ["enabled", "required", "disabled"]);
    appendPluginCandidates(candidates, normalized, "Legacy_Auth", ["disabled", "enabled"]);
    return candidates;
}

export function shouldRetryFirebirdCompatibility(error: unknown): boolean {
    return isRetryableCompatibilityError(error);
}

export function describeFirebirdCompatibilityOptions(options: Options): string {
    const normalized = normalizeFirebirdOptions(options);
    return `plugin=${normalized.pluginName}, wireCrypt=${normalized.wireCrypt}, authPlugins=${(normalized.authPlugins ?? []).join("/")}`;
}

export function ensureEsNodeFirebirdCompatibilityPatch(): void {
    const firebird = Firebird as FirebirdModuleLike;
    const connectionPrototype = firebird.Connection?.prototype;

    if (!connectionPrototype?.connect || connectionPrototype.__emilsoftwareWireCryptPatched) {
        return;
    }

    const originalConnect = connectionPrototype.connect;

    connectionPrototype.connect = function patchedConnect(
        this: ConnectionLike,
        options: FirebirdOptions,
        callback: unknown,
    ) {
        const normalizedOptions = normalizeFirebirdOptions(options);
        const wireCryptFlag = toWireCryptFlag(normalizedOptions.wireCrypt);
        const authPlugin = normalizedOptions.pluginName;
        const authPlugins = normalizedOptions.authPlugins ?? DEFAULT_AUTH_PLUGIN_LIST;

        this.accept ??= { protocolMinimumType: 0, pluginName: authPlugin };

        const blr = this._blr;
        const originalAddBytes = blr?.addBytes;
        const originalAddString = blr?.addString;

        if (!blr || !originalAddBytes || !originalAddString) {
            return originalConnect.call(this, normalizedOptions, callback);
        }

        const patchedOptions = authPlugin === "Srp256"
            ? { ...normalizedOptions, pluginName: "Srp" as FirebirdAuthPlugin }
            : normalizedOptions;

        blr.addBytes = function patchedAddBytes(bytes: number[], ...args: unknown[]) {
            if (Array.isArray(bytes) && bytes.length === 6 && bytes[0] === CNCT_CLIENT_CRYPT && bytes[1] === 4) {
                return originalAddBytes.call(this, [bytes[0], bytes[1], wireCryptFlag, 0, 0, 0], ...args);
            }

            return originalAddBytes.call(this, bytes, ...args);
        };

        blr.addString = function patchedAddString(code: number, value: string, encoding?: string) {
            if (code === CNCT_PLUGIN_NAME) {
                return originalAddString.call(this, code, authPlugin, encoding);
            }

            if (code === CNCT_PLUGIN_LIST) {
                return originalAddString.call(this, code, authPlugins.join(","), encoding);
            }

            return originalAddString.call(this, code, value, encoding);
        };

        try {
            return originalConnect.call(this, patchedOptions, callback);
        } finally {
            blr.addBytes = originalAddBytes;
            blr.addString = originalAddString;
        }
    };

    connectionPrototype.__emilsoftwareWireCryptPatched = true;
}

ensureEsNodeFirebirdCompatibilityPatch();
