import { BadRequestException } from '@nestjs/common';

/** Lunghezze canoniche della password Accessi. */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 100;

/** Codice errore stabile restituito quando la password non rispetta la policy. */
export const WEAK_PASSWORD_CODE = 'ACCESSI_WEAK_PASSWORD';

export interface PasswordPolicyOptions {
  minLength?: number;
  maxLength?: number;
}

/**
 * Password comuni o banalmente prevedibili rifiutate anche se rispettano la
 * complessita. Confronto case-insensitive; elenco volutamente piccolo e senza
 * dipendenze esterne.
 */
const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', 'passw0rd', 'p@ssw0rd', 'p@ssword',
  '12345678', '123456789', '1234567890', 'qwerty', 'qwerty123', 'qwertyuiop',
  'admin', 'admin123', 'administrator', 'letmein', 'welcome', 'welcome1',
  'iloveyou', 'abc12345', 'a1b2c3d4', 'monkey123', 'dragon123', 'changeme',
  'accessi', 'emilsoftware',
]);

/**
 * Restituisce l'elenco leggibile delle violazioni della policy password.
 * Policy: lunghezza, maiuscola, minuscola, cifra, carattere speciale, nessuno
 * spazio, non comune.
 */
export function collectPasswordPolicyViolations(
  password: unknown,
  options: PasswordPolicyOptions = {},
): string[] {
  if (typeof password !== 'string' || password.length === 0) {
    return ['La password e obbligatoria.'];
  }

  const minLength = options.minLength ?? PASSWORD_MIN_LENGTH;
  const maxLength = options.maxLength ?? PASSWORD_MAX_LENGTH;
  const violations: string[] = [];

  if (password.length < minLength) violations.push(`almeno ${minLength} caratteri`);
  if (password.length > maxLength) violations.push(`al massimo ${maxLength} caratteri`);
  if (/\s/.test(password)) violations.push('nessuno spazio');
  if (!/[A-Z]/.test(password)) violations.push('almeno una lettera maiuscola');
  if (!/[a-z]/.test(password)) violations.push('almeno una lettera minuscola');
  if (!/\d/.test(password)) violations.push('almeno una cifra');
  if (!/[^A-Za-z0-9]/.test(password)) violations.push('almeno un carattere speciale');
  if (COMMON_PASSWORDS.has(password.toLowerCase())) violations.push('una password non comune');

  return violations;
}

/**
 * Valida la password secondo la policy moderna e, se non conforme, solleva un
 * `BadRequestException` con codice `ACCESSI_WEAK_PASSWORD` e l'elenco dei
 * requisiti mancanti. Da usare solo quando si IMPOSTA una password, mai al login.
 */
export function assertStrongPassword(password: unknown, options?: PasswordPolicyOptions): void {
  const violations = collectPasswordPolicyViolations(password, options);
  if (violations.length === 0) {
    return;
  }

  throw new BadRequestException({
    code: WEAK_PASSWORD_CODE,
    message: `La password non rispetta i requisiti di sicurezza: richiede ${violations.join(', ')}.`,
    details: violations,
  });
}
