import { HttpException, HttpStatus } from '@nestjs/common';

type RateLimitBucket = { count: number; resetAt: number };

/**
 * Limite anti-abuso per la verifica dei token di servizio.
 *
 * Il segreto ha 256 bit di entropia (brute force non praticabile), ma il limite evita
 * che un client difettoso o malevolo martelli l'endpoint. In-memory: in cluster va
 * aggiunto un limite anche al gateway.
 */
const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 120;
const MAX_BUCKETS = 20_000;
const buckets = new Map<string, RateLimitBucket>();

export function checkServiceTokenRateLimit(identifier: string): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const key = identifier && identifier.trim() !== '' ? identifier : 'unknown';
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    if (buckets.size >= MAX_BUCKETS) {
      const oldestKey = buckets.keys().next().value;
      if (oldestKey !== undefined) {
        buckets.delete(oldestKey);
      }
    }
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (bucket.count >= MAX_ATTEMPTS) {
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
  }

  bucket.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

/** Svuota i bucket (usato nei test). */
export function resetServiceTokenRateLimit(): void {
  buckets.clear();
}

/** Lancia 429 con `Retry-After` quando il limite e superato. */
export function assertServiceTokenRateLimit(identifier: string): void {
  const decision = checkServiceTokenRateLimit(identifier);
  if (!decision.allowed) {
    throw new HttpException(
      { code: 'ACCESSI_SERVICE_TOKEN_RATE_LIMITED', message: 'Troppi tentativi. Riprova piu tardi.' },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
