import type { Request } from "express";
import {
  buildRequirementTree,
  evaluateRequirement,
  extractAccessiBearerToken,
} from "../contracts";
import type {
  AccessiAccessTokenPayload,
  GrantsResult,
} from "../contracts";
import { accessiAuthError } from "./errors";
import { createAccessiIntrospectionClient } from "./introspection";
import type { AccessiIntrospectionClient } from "./introspection";
import { createAccessiTokenVerifier } from "./token";
import type { AccessiTokenVerifier } from "./token";
import type {
  AccessiRequestContext,
  AccessiResourceServerOptions,
} from "./types";

/** Request Express arricchita dal resource server. */
export interface AccessiAuthenticatedRequest extends Request {
  user?: Record<string, unknown>;
  data?: Record<string, unknown>;
  userGrants?: GrantsResult;
  accessi?: AccessiRequestContext;
}

/** Runtime creato una volta al bootstrap e riutilizzato a ogni richiesta. */
export interface AccessiResourceServerRuntime {
  options: AccessiResourceServerOptions;
  verifier?: AccessiTokenVerifier;
  introspectionClient?: AccessiIntrospectionClient;
}

function resolveMode(options: AccessiResourceServerOptions): "local" | "introspection" {
  if (options.mode) return options.mode;
  if (options.jwt) return "local";
  if (options.introspection) return "introspection";
  throw accessiAuthError(
    500,
    "AUTH_CONFIG_INVALID",
    "Configurare jwt o introspection nel resource server Accessi.",
  );
}

/** Valida la configurazione e prepara verificatore e client di introspection. */
export function createAccessiResourceServer(
  options: AccessiResourceServerOptions,
): AccessiResourceServerRuntime {
  const mode = resolveMode(options);
  if (mode === "local" && !options.jwt) {
    throw accessiAuthError(500, "AUTH_CONFIG_INVALID", "mode local richiede jwt.");
  }
  if (mode === "introspection" && !options.introspection) {
    throw accessiAuthError(500, "AUTH_CONFIG_INVALID", "mode introspection richiede introspection.");
  }

  return {
    options: { ...options, mode },
    ...(options.jwt ? { verifier: createAccessiTokenVerifier(options.jwt) } : {}),
    ...(options.introspection
      ? { introspectionClient: createAccessiIntrospectionClient(options.introspection) }
      : {}),
  };
}

function mergeIntrospectionUser(
  payload: AccessiAccessTokenPayload | undefined,
  user: Record<string, unknown>,
): AccessiAccessTokenPayload {
  return {
    ...(payload ?? { typ: "access" }),
    ...user,
    typ: "access",
    utente: user,
  };
}

/**
 * Autentica la request e applica l'eventuale policy di autorizzazione.
 *
 * Non accede mai al database Accessi: la verifica e locale oppure delegata
 * all'introspection di Accessi Service.
 */
export async function authenticateAccessiRequest(
  request: Request,
  runtime: AccessiResourceServerRuntime,
): Promise<AccessiRequestContext> {
  const token = extractAccessiBearerToken(request.headers.authorization);
  if (!token) {
    throw accessiAuthError(401, "AUTH_TOKEN_MISSING", "Token Bearer mancante o malformato.");
  }

  const mode = runtime.options.mode ?? "local";
  let payload: AccessiAccessTokenPayload | undefined;
  let user: Record<string, unknown> = {};
  let codiceUtente: number | undefined;
  let grants: GrantsResult | undefined;

  if (mode === "local") {
    if (!runtime.verifier) {
      throw accessiAuthError(500, "AUTH_CONFIG_INVALID", "Verificatore JWT non configurato.");
    }
    const verification = await runtime.verifier.verify(token);
    payload = verification.payload;
    user = verification.user;
    codiceUtente = verification.codiceUtente;
  } else {
    if (!runtime.introspectionClient) {
      throw accessiAuthError(500, "AUTH_CONFIG_INVALID", "Client introspection non configurato.");
    }
    const introspection = await runtime.introspectionClient.introspect(token);
    if (!introspection.active) {
      throw accessiAuthError(401, "AUTH_TOKEN_INVALID", "Token non valido, scaduto o revocato.");
    }
    user = introspection.user ?? {};
    codiceUtente = introspection.codiceUtente;
    grants = introspection.grants;
    payload = mergeIntrospectionUser(undefined, user);
  }

  if (!codiceUtente) {
    throw accessiAuthError(401, "AUTH_USER_CODE_MISSING", "Token privo di un utente valido.");
  }

  const requirementTree = buildRequirementTree(runtime.options.authorization);
  if (requirementTree) {
    if (!grants) {
      if (!runtime.introspectionClient) {
        throw accessiAuthError(
          500,
          "AUTH_GRANTS_SOURCE_MISSING",
          "La policy richiede grant ma introspection non e configurata.",
        );
      }
      const introspection = await runtime.introspectionClient.introspect(token);
      if (!introspection.active) {
        throw accessiAuthError(401, "AUTH_TOKEN_INVALID", "Token non valido, scaduto o revocato.");
      }
      grants = introspection.grants;
      if (introspection.user) {
        user = introspection.user;
        payload = mergeIntrospectionUser(payload, user);
      }
    }

    const hasPermissions = await evaluateRequirement(
      requirementTree,
      {
        req: request,
        decodedToken: payload,
        userCode: codiceUtente,
        getGrantsResult: async () => grants ?? {},
      },
      runtime.options.authorization,
    );
    if (!hasPermissions) {
      throw accessiAuthError(
        403,
        "AUTH_INSUFFICIENT_PERMISSIONS",
        "Permessi insufficienti per questa operazione.",
      );
    }
  }

  const authenticatedRequest = request as AccessiAuthenticatedRequest;
  const authPayload: Record<string, unknown> = payload ?? {
    typ: "access",
    codiceUtente,
    utente: user,
  };
  authenticatedRequest.user = authPayload;
  authenticatedRequest.data = authPayload;
  if (grants) authenticatedRequest.userGrants = grants;
  authenticatedRequest.accessi = {
    token,
    user,
    codiceUtente,
    ...(grants ? { grants } : {}),
    payload: authPayload,
  };
  return authenticatedRequest.accessi;
}
