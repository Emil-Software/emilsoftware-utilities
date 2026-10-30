import type {
  AccessiAuthorizationOptions,
  AccessiGrant,
  GrantsResult,
} from "../contracts";
import type { SessionRevocationStore } from "../../accessi-module/security/sessionRevocation";
import type { AccessTokenRevocationStore } from "../../accessi-module/security/accessTokenRevocation";
import type { RefreshTokenRotationStore } from "../../accessi-module/security/refreshTokenRotation";

/** Algoritmi JWT supportati dal resource server. */
export type AccessiJwtAlgorithm =
  | "HS256"
  | "HS384"
  | "HS512"
  | "RS256"
  | "RS384"
  | "RS512"
  | "ES256"
  | "ES384"
  | "ES512";

/** Opzioni di verifica locale del JWT. Almeno una tra `secret`, `publicKey` e `jwks` e obbligatoria. */
export interface AccessiResourceServerJwtOptions {
  /** Chiave HMAC gia derivata (access key). Alternativa a `serverSecret`. */
  secret?: string;
  /**
   * Segreto Accessi grezzo (`ACCESSI_JWT_SECRET`).
   *
   * Il resource server deriva automaticamente la chiave access con la stessa
   * KDF del server: e il modo consigliato quando si condivide il segreto HS256.
   */
  serverSecret?: string;
  /** Chiave pubblica PEM per algoritmi RS ed ES. */
  publicKey?: string | Buffer;
  /** JWKS remoto per verificare token firmati con chiavi asimmetriche. */
  jwks?: {
    url: string;
    cacheTtlMs?: number;
    timeoutMs?: number;
    fetch?: typeof fetch;
  };
  /** Default: HS256 con `secret`, altrimenti RS/ES con `publicKey`/`jwks`. */
  algorithms?: AccessiJwtAlgorithm[];
  /** Issuer atteso (`iss`). */
  issuer?: string;
  /** Audience attesa (`aud`). */
  audience?: string | string[];
  /** Tolleranza orologio in secondi. Default: 5. */
  clockToleranceSeconds?: number;
}

/** Configurazione del client di introspection verso Accessi Service. */
export interface AccessiIntrospectionOptions {
  /** URL completo, es. `https://accessi.example.com/api/accessi/auth/introspect`. */
  url: string;
  /** Service token Accessi con scope `accessi:introspect`. */
  serviceToken: string;
  /** TTL della cache locale dei risultati attivi. Default: 30000 ms. */
  cacheTtlMs?: number;
  /** Timeout HTTP. Default: 3000 ms. */
  timeoutMs?: number;
  /** Fetch iniettabile per test o runtime non-Node. */
  fetch?: typeof fetch;
}

/** Risultato dell'introspection. */
export interface AccessiIntrospectionResult {
  active: boolean;
  user?: Record<string, unknown>;
  codiceUtente?: number;
  grants?: GrantsResult;
}

/** Modalita di autenticazione del resource server. */
export type AccessiResourceServerMode = "local" | "introspection";

/**
 * Configurazione di un backend fratello che non possiede il database Accessi.
 *
 * - `mode: "local"` verifica il JWT con chiave locale e, se servono grant, usa
 *   l'introspection per leggerli.
 * - `mode: "introspection"` delega la verifica del token ad Accessi Service.
 */
export interface AccessiResourceServerOptions {
  mode?: AccessiResourceServerMode;
  jwt?: AccessiResourceServerJwtOptions;
  introspection?: AccessiIntrospectionOptions;
  /** Policy di autorizzazione opzionale applicata dopo l'autenticazione. */
  authorization?: AccessiAuthorizationOptions;
  /** Store condiviso di revoca. Opzionale. */
  revocation?: {
    /** Revoca per utente: invalida tutti i token emessi prima del cutoff. */
    store?: SessionRevocationStore;
    /** Revoca dei singoli access token tramite `jti`. */
    accessTokenStore?: AccessTokenRevocationStore;
    /** Store di rotazione refresh: applica la revoca delle famiglie sospette. */
    familyStore?: RefreshTokenRotationStore;
  };
  /** Audit strutturato degli errori di autenticazione. Default: true. */
  audit?: boolean;
}

/** Dati allegati alla request dopo l'autenticazione. */
export interface AccessiRequestContext {
  token: string;
  user: Record<string, unknown>;
  codiceUtente?: number;
  grants?: GrantsResult;
  payload?: Record<string, unknown>;
}

/** Grant esposto per compatibilita con il middleware storico. */
export type AccessiRequestGrants = AccessiGrant[];
