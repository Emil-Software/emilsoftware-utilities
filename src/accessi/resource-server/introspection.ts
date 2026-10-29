import { createHash } from "crypto";
import { accessiAuthError } from "./errors";
import type { AccessiIntrospectionOptions, AccessiIntrospectionResult } from "./types";

interface CacheEntry {
  result: AccessiIntrospectionResult;
  expiresAt: number;
}

/** Client di introspection verso Accessi Service, con cache locale dei risultati attivi. */
export interface AccessiIntrospectionClient {
  introspect(token: string, options?: { forceRefresh?: boolean }): Promise<AccessiIntrospectionResult>;
  clearCache(): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function unwrapResult(payload: unknown): Record<string, unknown> {
  if (isRecord(payload) && isRecord(payload.Result)) return payload.Result;
  if (isRecord(payload)) return payload;
  return {};
}

function parseResult(payload: unknown): AccessiIntrospectionResult {
  const result = unwrapResult(payload);
  const active = result.active === true;
  const user = isRecord(result.user) ? result.user : undefined;
  const grants = isRecord(result.grants) ? result.grants : undefined;
  const rawCode = user?.codiceUtente ?? result.codiceUtente;
  const codiceUtente = Number(rawCode);

  return {
    active,
    ...(user ? { user } : {}),
    ...(Number.isSafeInteger(codiceUtente) && codiceUtente > 0 ? { codiceUtente } : {}),
    ...(grants ? { grants } : {}),
  };
}

/**
 * Crea il client di introspection.
 *
 * Il service token deve avere scope `accessi:introspect`. I risultati attivi
 * sono memorizzati per `cacheTtlMs` (default 30s); i risultati inattivi non
 * vengono cachati per permettere un retry immediato dopo un login.
 */
export function createAccessiIntrospectionClient(
  options: AccessiIntrospectionOptions,
): AccessiIntrospectionClient {
  if (!options?.url || !options?.serviceToken) {
    throw accessiAuthError(
      500,
      "AUTH_CONFIG_INVALID",
      "introspection.url e introspection.serviceToken sono obbligatori.",
    );
  }

  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw accessiAuthError(500, "AUTH_CONFIG_INVALID", "fetch non disponibile per l'introspection.");
  }

  const cacheTtlMs = Math.max(1_000, options.cacheTtlMs ?? 30_000);
  const timeoutMs = Math.max(500, options.timeoutMs ?? 3_000);
  const cache = new Map<string, CacheEntry>();

  const clearCache = (): void => {
    cache.clear();
  };

  const introspect = async (
    token: string,
    callOptions: { forceRefresh?: boolean } = {},
  ): Promise<AccessiIntrospectionResult> => {
    if (typeof token !== "string" || token.trim() === "") {
      return { active: false };
    }

    const cacheKey = createHash("sha256").update(token).digest("hex");
    const cached = cache.get(cacheKey);
    if (!callOptions.forceRefresh && cached && cached.expiresAt > Date.now()) {
      return cached.result;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(options.url, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${options.serviceToken}`,
        },
        body: JSON.stringify({ token }),
        signal: controller.signal,
      });
    } catch {
      cache.delete(cacheKey);
      throw accessiAuthError(
        503,
        "AUTH_INTROSPECTION_UNAVAILABLE",
        "Accessi Service non raggiungibile per l'introspection.",
      );
    } finally {
      clearTimeout(timeout);
    }

    if (response.status === 401 || response.status === 403) {
      throw accessiAuthError(
        503,
        "AUTH_INTROSPECTION_UNAUTHORIZED",
        "Service token non valido o privo dello scope accessi:introspect.",
      );
    }
    if (response.status >= 500) {
      throw accessiAuthError(
        503,
        "AUTH_INTROSPECTION_UNAVAILABLE",
        `Accessi Service ha risposto ${response.status} all'introspection.`,
      );
    }
    if (response.status === 400 || response.status === 404) {
      return { active: false };
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw accessiAuthError(
        503,
        "AUTH_INTROSPECTION_UNAVAILABLE",
        "Risposta introspection non JSON.",
      );
    }

    const result = parseResult(payload);
    if (result.active) {
      cache.set(cacheKey, { result, expiresAt: Date.now() + cacheTtlMs });
    } else {
      cache.delete(cacheKey);
    }
    return result;
  };

  return { introspect, clearCache };
}
