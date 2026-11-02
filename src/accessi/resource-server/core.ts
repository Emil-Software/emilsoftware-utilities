export * from "./types";
export * from "./keys";
export * from "./errors";
export * from "./token";
export * from "./introspection";
export * from "./runtime";

/**
 * Store di revoca condivisibili con Accessi Service.
 *
 * Un backend fratello che riceve le stesse istanze (o le ricrea sullo stesso
 * Redis) applica revoche per utente, per `jti` e per famiglia di refresh token
 * senza importare l'intero entry point `accessi/server`.
 */
export {
  createMemorySessionRevocationStore,
  createRedisSessionRevocationStore,
} from "../../accessi-service/security/sessionRevocation";
export type {
  MemorySessionRevocationStore,
  RedisSessionRevocationStoreOptions,
  SessionRevocationStore,
} from "../../accessi-service/security/sessionRevocation";
export {
  createMemoryAccessTokenRevocationStore,
  createRedisAccessTokenRevocationStore,
} from "../../accessi-service/security/accessTokenRevocation";
export type {
  AccessTokenRevocationStore,
  MemoryAccessTokenRevocationStore,
  RedisAccessTokenRevocationStoreOptions,
} from "../../accessi-service/security/accessTokenRevocation";
export {
  createMemoryRefreshTokenRotationStore,
  createRedisRefreshTokenRotationStore,
} from "../../accessi-service/security/refreshTokenRotation";
export type {
  MemoryRefreshTokenRotationStore,
  RefreshTokenRotationStore,
  RedisRefreshTokenRotationStoreOptions,
} from "../../accessi-service/security/refreshTokenRotation";
