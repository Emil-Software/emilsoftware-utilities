import type { OpenAPIObject } from "@nestjs/swagger";

/** Politica di risoluzione quando due documenti definiscono la stessa chiave. */
export type OpenApiMergeConflictPolicy = "error" | "keep" | "overwrite";

export interface MergeOpenApiOptions {
  /** Default: `error`. */
  conflict?: OpenApiMergeConflictPolicy;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneDocument(document: OpenAPIObject): Record<string, unknown> {
  return JSON.parse(JSON.stringify(document)) as Record<string, unknown>;
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function mergeRecord(
  target: Record<string, unknown> | undefined,
  source: Record<string, unknown> | undefined,
  policy: OpenApiMergeConflictPolicy,
  section: string,
): Record<string, unknown> | undefined {
  if (!source) return target;
  const merged: Record<string, unknown> = { ...(target ?? {}) };

  for (const [key, value] of Object.entries(source)) {
    if (!(key in merged)) {
      merged[key] = value;
      continue;
    }
    if (sameValue(merged[key], value)) continue;
    if (policy === "keep") continue;
    if (policy === "overwrite") {
      merged[key] = value;
      continue;
    }
    throw new Error(`Conflitto OpenAPI in ${section}.${key}.`);
  }

  return merged;
}

function mergeTags(
  target: unknown,
  source: unknown,
  policy: OpenApiMergeConflictPolicy,
): unknown {
  if (!Array.isArray(target) || !Array.isArray(source)) return target ?? source;
  const merged = [...target];
  for (const tag of source) {
    if (!isRecord(tag) || typeof tag.name !== "string") {
      merged.push(tag);
      continue;
    }
    const existingIndex = merged.findIndex(
      (candidate) => isRecord(candidate) && candidate.name === tag.name,
    );
    if (existingIndex < 0) {
      merged.push(tag);
      continue;
    }
    const existing = merged[existingIndex];
    if (sameValue(existing, tag)) continue;
    if (policy === "keep") continue;
    if (policy === "overwrite") {
      merged[existingIndex] = tag;
      continue;
    }
    throw new Error(`Conflitto OpenAPI nel tag "${tag.name}".`);
  }
  return merged;
}

function mergeServers(
  target: unknown,
  source: unknown,
  policy: OpenApiMergeConflictPolicy,
): unknown {
  if (!Array.isArray(target) || !Array.isArray(source)) return target ?? source;
  const merged = [...target];
  for (const server of source) {
    if (!isRecord(server) || typeof server.url !== "string") {
      merged.push(server);
      continue;
    }
    const existingIndex = merged.findIndex(
      (candidate) => isRecord(candidate) && candidate.url === server.url,
    );
    if (existingIndex < 0) {
      merged.push(server);
      continue;
    }
    const existing = merged[existingIndex];
    if (sameValue(existing, server)) continue;
    if (policy === "keep") continue;
    if (policy === "overwrite") {
      merged[existingIndex] = server;
      continue;
    }
    throw new Error(`Conflitto OpenAPI nel server "${server.url}".`);
  }
  return merged;
}

/**
 * Unisce il documento Accessi nel documento OpenAPI dell'host.
 *
 * Per default un conflitto su path, schema o security scheme produce errore:
 * e meglio accorgersi subito di due contratti incompatibili. Usare
 * `conflict: "overwrite"` solo quando il documento host deve vincere.
 */
export function mergeOpenApiDocuments(
  target: OpenAPIObject,
  source: OpenAPIObject,
  options: MergeOpenApiOptions = {},
): OpenAPIObject {
  if (!target || !source) {
    throw new Error("mergeOpenApiDocuments richiede due documenti OpenAPI validi.");
  }

  const policy = options.conflict ?? "error";
  const result = cloneDocument(target);
  const sourceDocument = source as unknown as Record<string, unknown>;

  result.paths = mergeRecord(
    isRecord(result.paths) ? result.paths : undefined,
    isRecord(sourceDocument.paths) ? sourceDocument.paths : undefined,
    policy,
    "paths",
  );

  const targetComponents = isRecord(result.components) ? result.components : {};
  const sourceComponents = isRecord(sourceDocument.components) ? sourceDocument.components : {};
  const componentSections = new Set([
    ...Object.keys(targetComponents),
    ...Object.keys(sourceComponents),
  ]);
  const mergedComponents: Record<string, unknown> = { ...targetComponents };
  for (const section of componentSections) {
    mergedComponents[section] = mergeRecord(
      isRecord(targetComponents[section]) ? targetComponents[section] : undefined,
      isRecord(sourceComponents[section]) ? sourceComponents[section] : undefined,
      policy,
      `components.${section}`,
    );
  }
  result.components = mergedComponents;

  result.tags = mergeTags(result.tags, sourceDocument.tags, policy);
  result.servers = mergeServers(result.servers, sourceDocument.servers, policy);

  return result as unknown as OpenAPIObject;
}
