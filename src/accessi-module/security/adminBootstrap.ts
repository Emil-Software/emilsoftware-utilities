import { randomBytes, timingSafeEqual } from 'crypto';

/**
 * Token di bootstrap admin, valido per il singolo processo Accessi.
 * Viene generato al primo accesso (avvio del modulo) e rigenerato a ogni riavvio: non e mai
 * persistito ne restituito via API, e viene stampato solo nel log del backend.
 */
let processToken: string | null = null;

/** Genera (una sola volta per processo) il token di bootstrap admin. */
export function getOrCreateAdminBootstrapToken(): string {
  if (!processToken) {
    processToken = randomBytes(32).toString('hex');
  }
  return processToken;
}

/** Token corrente, oppure null se non ancora generato. */
export function getAdminBootstrapToken(): string | null {
  return processToken;
}

/** Invalida il token (usato dopo un bootstrap riuscito per renderlo monouso). */
export function clearAdminBootstrapToken(): void {
  processToken = null;
}

/** Confronto a tempo costante del token candidato con quello generato. */
export function isValidAdminBootstrapToken(candidate: unknown): boolean {
  if (!processToken || typeof candidate !== 'string' || candidate.length === 0) {
    return false;
  }

  const expected = Buffer.from(processToken, 'utf8');
  const provided = Buffer.from(candidate, 'utf8');
  if (expected.length !== provided.length) {
    return false;
  }

  return timingSafeEqual(expected, provided);
}
