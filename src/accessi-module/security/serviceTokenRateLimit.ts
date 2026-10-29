import { HttpException, HttpStatus } from '@nestjs/common';
import { getDefaultRateLimitStore } from './rateLimitStore';
import type { RateLimitStore } from './rateLimitStore';

/**
 * Limite anti-abuso per la verifica dei token di servizio.
 *
 * Il segreto ha 256 bit di entropia (brute force non praticabile), ma il limite evita
 * che un client difettoso o malevolo martelli l'endpoint. Con `serviceTokens.rateLimitStore`
 * e possibile usare uno store condiviso in cluster.
 */
const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 120;

export async function checkServiceTokenRateLimit(
  identifier: string,
  store: RateLimitStore = getDefaultRateLimitStore(),
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const key = identifier && identifier.trim() !== '' ? identifier.trim() : 'unknown';
  try {
    return await store.consume(`service-token|${key}`, WINDOW_MS, MAX_ATTEMPTS);
  } catch {
    throw new HttpException(
      {
        code: 'ACCESSI_RATE_LIMIT_UNAVAILABLE',
        message: 'Rate limit non disponibile. Riprova piu tardi.',
      },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}

/** Svuota i bucket dello store di default (usato nei test). */
export function resetServiceTokenRateLimit(): void {
  getDefaultRateLimitStore().reset();
}

/** Lancia 429 con `Retry-After` quando il limite e superato. */
export async function assertServiceTokenRateLimit(
  identifier: string,
  store?: RateLimitStore,
): Promise<void> {
  const decision = await checkServiceTokenRateLimit(identifier, store);
  if (!decision.allowed) {
    throw new HttpException(
      { code: 'ACCESSI_SERVICE_TOKEN_RATE_LIMITED', message: 'Troppi tentativi. Riprova piu tardi.' },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
