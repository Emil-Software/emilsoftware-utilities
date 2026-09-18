import { NextFunction, Request, Response } from "express";
import * as jwt from "jsonwebtoken";
import { Inject, Injectable } from "@nestjs/common";
import type { AccessiOptions } from "../AccessiModule";
import { PermissionService } from "../Services/PermissionService/PermissionService";
import { UserService } from "../Services/UserService/UserService";
import { Logger } from "../../Logger";
import {
  AccessiAuthorizationOptions,
  AccessiCustomRequirementContext,
  GrantsResult,
  RequirementEvaluationError,
  buildRequirementTree,
  evaluateRequirement,
} from "./accessiRequirements";
import {
  buildAuthenticatedTokenPayload,
  extractAccessiBearerToken,
  isAuthenticatedUserEnabledForJwt,
  isAccessiTokenAllowedForUser,
  resolveCodiceUtenteFromTokenPayload,
} from "../security/authenticatedToken";

const logger = new Logger("AuthenticateGen");
const ACCESSI_AUTH_SERVICE_LOCALS_KEY = "accessiAuthService";
const ACCESSI_AUTH_SERVICE_GLOBAL_KEY = Symbol.for("emilsoftware.accessiAuthService");
const ACCESSI_AUTH_SERVICE_WAIT_MS = 15000;

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

class AuthMiddlewareError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "AuthMiddlewareError";
  }
}

function authError(
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>
) {
  return new AuthMiddlewareError(status, code, message, details);
}

function normalizeAuthError(error: unknown): AuthMiddlewareError {
  if (error instanceof AuthMiddlewareError) return error;
  if (error instanceof RequirementEvaluationError) {
    return authError(500, error.code, error.message);
  }
  if (error instanceof Error) {
    return authError(500, "AUTH_INTERNAL_ERROR", error.message, {
      originalError: error.name,
    });
  }
  return authError(500, "AUTH_INTERNAL_ERROR", "Unexpected authentication error");
}

function logAuthFailure(req: Request, authErr: AuthMiddlewareError) {
  const payload = {
    code: authErr.code,
    status: authErr.status,
    message: authErr.message,
    details: authErr.details,
    method: req.method,
    path: req.originalUrl ?? req.url,
    ip: req.ip,
  };

  const message = `${authErr.status >= 500 ? "Authentication failure" : "Authentication denied"} ${JSON.stringify(payload)}`;
  if (authErr.status >= 500) logger.error(message);
  else logger.warning(message);
}

/** Sends the documented Accessi error contract from Express middleware. */
function sendAuthenticationError(res: Response, authErr: AuthMiddlewareError): Response {
  const message =
    authErr.status === 403
      ? 'Operazione non autorizzata.'
      : authErr.status >= 500
        ? 'Errore interno del modulo Accessi.'
        : 'Autenticazione non valida o scaduta.';

  return res.status(authErr.status).json({
    severity: 'error',
    status: authErr.status,
    statusCode: 2,
    code: authErr.code,
    // Kept for callers of older versions which already inspected `error`.
    error: authErr.code,
    message,
  });
}

async function authorizeWithDependencies(
  req: Request,
  res: Response,
  next: NextFunction,
  options: AccessiAuthorizationOptions | undefined,
  accessiOptions: AccessiOptions,
  permissionService: PermissionService,
  userService: UserService
) {
  type AuthenticatedRequest = Request & {
    userGrants?: unknown;
    user?: unknown;
    data?: unknown;
  };
  const authenticatedRequest = req as AuthenticatedRequest;

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      throw authError(401, "AUTH_HEADER_MISSING", "Authorization header not found");
    }

    const token = extractAccessiBearerToken(authHeader);
    if (!token) {
      throw authError(
        401,
        "AUTH_TOKEN_MISSING",
        "Token not found in Authorization header"
      );
    }

    const secret = accessiOptions?.jwtOptions?.secret || process.env.ACC_JWT_SECRET;
    if (!secret) {
      throw authError(500, "AUTH_JWT_SECRET_MISSING", "JWT secret not configured");
    }

    let decoded: unknown;
    try {
      decoded = jwt.verify(token, secret, { algorithms: ['HS256'] });
    } catch {
      throw authError(401, "AUTH_TOKEN_INVALID", "Invalid JWT token");
    }

    const codiceUtente = resolveCodiceUtenteFromTokenPayload(decoded);
    if (!codiceUtente) {
      throw authError(
        401,
        "AUTH_USER_CODE_MISSING",
        "codiceUtente not found in token payload"
      );
    }

    const currentUser = await userService.getAuthenticatedUserSnapshot(codiceUtente);
    if (!isAuthenticatedUserEnabledForJwt(currentUser) || !isAccessiTokenAllowedForUser(decoded, currentUser)) {
      throw authError(
        401,
        "AUTH_USER_DISABLED",
        "User is no longer authorized"
      );
    }

    const authenticatedPayload = buildAuthenticatedTokenPayload(decoded, currentUser);

    const requirementTree = buildRequirementTree(options);
    if (requirementTree) {
      if (!accessiOptions?.databaseOptions) {
        throw authError(
          500,
          "AUTH_DATABASE_OPTIONS_MISSING",
          "Database options not configured"
        );
      }

      let grantsResultCache: GrantsResult | null = null;
      const getGrantsResult = async () => {
        if (!grantsResultCache) {
          grantsResultCache = await permissionService.getUserRolesAndGrants(
            codiceUtente
          );
        }
        return grantsResultCache;
      };

      const requirementContext: AccessiCustomRequirementContext = {
        req,
        decodedToken: authenticatedPayload,
        userCode: codiceUtente,
        getGrantsResult,
      };

      const hasPermissions = await evaluateRequirement(
        requirementTree,
        requirementContext,
        options
      );

      if (!hasPermissions) {
        throw authError(
          403,
          "AUTH_INSUFFICIENT_PERMISSIONS",
          "User does not have required permissions"
        );
      }

      authenticatedRequest.userGrants = await getGrantsResult();
    }

    authenticatedRequest.user = authenticatedPayload;
    authenticatedRequest.data = authenticatedPayload;
    return next();
  } catch (error: unknown) {
    const authErr = normalizeAuthError(error);
    logAuthFailure(req, authErr);
    return sendAuthenticationError(res, authErr);
  }
}

@Injectable()
/** Nest service behind the Express-compatible `authorizeAccessi` middleware. */
export class AuthenticateGenService {
  constructor(
    @Inject("ACCESSI_OPTIONS")
    private readonly accessiOptions: AccessiOptions,
    private readonly permissionService: PermissionService,
    private readonly userService: UserService
  ) { }

  /**
   * Verifica JWT, stato corrente dell'utente e policy opzionale, poi popola `req.user` e `req.data`.
   * Se una policy richiede grant, popola anche `req.userGrants`; non chiamarlo direttamente fuori da test o adapter.
   */
  async authorize(
    req: Request,
    res: Response,
    next: NextFunction,
    options?: AccessiAuthorizationOptions
  ) {
    return authorizeWithDependencies(
      req,
      res,
      next,
      options,
      this.accessiOptions,
      this.permissionService,
      this.userService
    );
  }
}

let authenticateGenServiceRef: AuthenticateGenService | null = null;
let authServiceBootstrapDeferred: Deferred<AuthenticateGenService> | null = null;

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function isAuthenticateGenService(value: unknown): value is AuthenticateGenService {
  return Boolean(
    value &&
    typeof (value as { authorize?: unknown }).authorize === "function"
  );
}

/** Segnala al middleware che il bootstrap e in corso, consentendo una risposta 503 temporanea invece di un 500. */
export function beginAccessiAuthInitialization() {
  if (!authServiceBootstrapDeferred) {
    authServiceBootstrapDeferred = createDeferred<AuthenticateGenService>();
  }
}

/** Registra il servizio costruito da Nest nel bridge usato dalle rotte Express dell'app ospitante. */
export function setAccessiAuthService(service: AuthenticateGenService) {
  authenticateGenServiceRef = service;
  (globalThis as Record<symbol, unknown>)[ACCESSI_AUTH_SERVICE_GLOBAL_KEY] = service;
  if (authServiceBootstrapDeferred) {
    authServiceBootstrapDeferred.resolve(service);
    authServiceBootstrapDeferred = null;
  }
}

/** Propaga il fallimento del bootstrap alle richieste che stavano attendendo il bridge di autorizzazione. */
export function failAccessiAuthInitialization(error: unknown) {
  if (authServiceBootstrapDeferred) {
    authServiceBootstrapDeferred.reject(error);
    authServiceBootstrapDeferred = null;
  }
}

function getAccessiAuthServiceFromRequest(req: Request): AuthenticateGenService | null {
  const appLocalsService = (req.app?.locals as Record<string, unknown> | undefined)?.[
    ACCESSI_AUTH_SERVICE_LOCALS_KEY
  ];

  if (isAuthenticateGenService(appLocalsService)) {
    return appLocalsService as AuthenticateGenService;
  }

  const globalService = (globalThis as Record<symbol, unknown>)[
    ACCESSI_AUTH_SERVICE_GLOBAL_KEY
  ];
  if (isAuthenticateGenService(globalService)) {
    return globalService as AuthenticateGenService;
  }

  return authenticateGenServiceRef;
}

async function waitForBootstrappedService(): Promise<AuthenticateGenService | null> {
  if (!authServiceBootstrapDeferred) {
    return null;
  }

  const bootstrapPromise = authServiceBootstrapDeferred.promise;
  const timeoutPromise = new Promise<null>((resolve) => {
    setTimeout(() => resolve(null), ACCESSI_AUTH_SERVICE_WAIT_MS);
  });

  try {
    const resolved = await Promise.race([bootstrapPromise, timeoutPromise]);
    return isAuthenticateGenService(resolved) ? resolved : null;
  } catch {
    return null;
  }
}

async function resolveAccessiAuthService(req: Request): Promise<AuthenticateGenService | null> {
  const immediateService = getAccessiAuthServiceFromRequest(req);
  if (immediateService) {
    return immediateService;
  }

  const bootstrappedService = await waitForBootstrappedService();
  if (bootstrappedService) {
    return bootstrappedService;
  }

  return getAccessiAuthServiceFromRequest(req);
}

/**
 * Middleware Express pubblico di Accessi.
 *
 * Applicarlo dopo `initializeAccessiModule`: legge `Authorization: Bearer <jwt>`, verifica l'utente corrente
 * e applica eventuali requisiti. Su successo valorizza `req.user` e continua; su errore risponde direttamente
 * con il contratto Accessi, quindi il chiamante non deve aggiungere un proprio `next(error)`.
 */
export async function authorizeAccessi(
  req: Request,
  res: Response,
  next: NextFunction,
  options?: AccessiAuthorizationOptions
) {
  const authService = await resolveAccessiAuthService(req);

  if (!authService) {
    const status = authServiceBootstrapDeferred ? 503 : 500;
    const code = authServiceBootstrapDeferred
      ? 'ACCESSI_AUTH_INITIALIZING'
      : 'ACCESSI_AUTH_NOT_INITIALIZED';
    logger.error(
      `Authentication service not initialized ${JSON.stringify({
        method: req.method,
        path: req.originalUrl ?? req.url,
        status,
      })}`
    );
    return res.status(status).json({
      severity: 'error',
      status,
      statusCode: 2,
      code,
      error: code,
      message: status === 503
        ? 'Il modulo Accessi e in inizializzazione. Riprova tra poco.'
        : 'Il modulo Accessi non e disponibile.',
    });
  }

  return authService.authorize(req, res, next, options);
}

/** Alias storico di `authorizeAccessi`, mantenuto per retrocompatibilita. Preferire il nome esplicito nelle nuove integrazioni. */
export const authenticateGen = authorizeAccessi;
