import { createPublicKey } from 'crypto';
import type { AccessiOptions } from '../AccessiModule';
import {
  accessiCookieNames,
  isValidAccessiCookieName,
  resolveAccessiAuthCookieOptions,
} from './authCookies';

export interface AccessiOptionsValidationIssue {
  code: string;
  message: string;
}

export interface AccessiOptionsValidationResult {
  errors: AccessiOptionsValidationIssue[];
  warnings: AccessiOptionsValidationIssue[];
}

function isHttpUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function positive(value: number | undefined): boolean {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

/**
 * Validazione fail-fast della configurazione Accessi.
 *
 * `createAccessiService` usa `assertValidAccessiOptions`; i bootstrap esistenti
 * possono usare `validateAccessiOptions` per loggare warning senza rompere il
 * comportamento storico.
 */
export function validateAccessiOptions(options: AccessiOptions): AccessiOptionsValidationResult {
  const errors: AccessiOptionsValidationIssue[] = [];
  const warnings: AccessiOptionsValidationIssue[] = [];

  const addError = (code: string, message: string) => errors.push({ code, message });
  const addWarning = (code: string, message: string) => warnings.push({ code, message });

  if (!options?.databaseOptions) {
    addError('ACCESSI_DB_OPTIONS_MISSING', 'databaseOptions e obbligatorio.');
  }

  const jwt = options?.jwtOptions;
  const secret = jwt?.secret || process.env.ACC_JWT_SECRET;
  if (!secret) {
    addError('ACCESSI_JWT_SECRET_MISSING', 'jwtOptions.secret e obbligatorio.');
  } else if (secret.length < 32) {
    addWarning('ACCESSI_JWT_SECRET_WEAK', 'jwtOptions.secret dovrebbe avere almeno 32 caratteri.');
  }

  if (!jwt?.expiresIn) {
    addError('ACCESSI_JWT_EXPIRES_MISSING', 'jwtOptions.expiresIn e obbligatorio.');
  }

  const algorithm = jwt?.algorithm ?? 'HS256';
  if (algorithm.startsWith('HS')) {
    if (jwt?.privateKey || jwt?.publicKey) {
      addWarning(
        'ACCESSI_JWT_ASYMMETRIC_KEYS_WITH_HMAC',
        'Sono configurate chiavi asimmetriche ma algorithm e HS256: verranno ignorate.',
      );
    }
  } else {
    if (!jwt?.privateKey) {
      addError('ACCESSI_JWT_PRIVATE_KEY_MISSING', `jwtOptions.privateKey e obbligatoria per ${algorithm}.`);
    }
    if (!jwt?.publicKey && !jwt?.privateKey) {
      addError('ACCESSI_JWT_PUBLIC_KEY_MISSING', `jwtOptions.publicKey e obbligatoria per ${algorithm}.`);
    }
    if (!jwt?.keyId) {
      addWarning('ACCESSI_JWT_KEY_ID_MISSING', 'jwtOptions.keyId e consigliato per la rotazione JWKS.');
    }
    if (!jwt?.jwksPath) {
      addWarning(
        'ACCESSI_JWKS_PATH_DEFAULT',
        'jwksPath non configurato: verra usato accessi/.well-known/jwks.json.',
      );
    }
  }

  const previousKeys = jwt?.previousPublicKeys ?? [];
  if (previousKeys.length > 0 && algorithm.startsWith('HS')) {
    addWarning(
      'ACCESSI_JWT_PREVIOUS_KEYS_WITH_HMAC',
      'previousPublicKeys e configurato ma algorithm e HS*: le chiavi verranno ignorate.',
    );
  }
  if (!algorithm.startsWith('HS') && previousKeys.length > 0) {
    const knownKeyIds = new Set<string>();
    if (jwt?.keyId) knownKeyIds.add(jwt.keyId);
    previousKeys.forEach((previous, index) => {
      try {
        createPublicKey(previous.publicKey);
      } catch {
        addError(
          'ACCESSI_JWT_PREVIOUS_KEY_INVALID',
          `previousPublicKeys[${index}] non e una chiave pubblica PEM valida.`,
        );
      }
      if (!previous.keyId) {
        addWarning(
          'ACCESSI_JWT_PREVIOUS_KEY_ID_MISSING',
          `previousPublicKeys[${index}] non ha keyId: verra usato il fingerprint della chiave.`,
        );
        return;
      }
      if (knownKeyIds.has(previous.keyId)) {
        addWarning(
          'ACCESSI_JWT_PREVIOUS_KEY_DUPLICATE_KID',
          `previousPublicKeys[${index}].keyId "${previous.keyId}" e duplicato: vince la chiave corrente.`,
        );
        return;
      }
      knownKeyIds.add(previous.keyId);
    });
  }

  if (!jwt?.issuer) {
    addWarning('ACCESSI_JWT_ISSUER_MISSING', 'jwtOptions.issuer e consigliato in multi-servizio.');
  }
  if (!jwt?.audience) {
    addWarning('ACCESSI_JWT_AUDIENCE_MISSING', 'jwtOptions.audience e consigliato in multi-servizio.');
  }

  if (!options?.encryptionKey) {
    addError('ACCESSI_ENCRYPTION_KEY_MISSING', 'encryptionKey e obbligatoria.');
  } else if (options.encryptionKey.length < 16) {
    addWarning('ACCESSI_ENCRYPTION_KEY_WEAK', 'encryptionKey dovrebbe avere almeno 16 caratteri.');
  }

  if (!isHttpUrl(options?.confirmationEmailUrl)) {
    addWarning('ACCESSI_CONFIRMATION_URL_INVALID', 'confirmationEmailUrl dovrebbe essere un URL http/https.');
  }
  if (!isHttpUrl(options?.confirmationEmailReturnUrl)) {
    addWarning('ACCESSI_CONFIRMATION_RETURN_URL_INVALID', 'confirmationEmailReturnUrl dovrebbe essere un URL http/https.');
  }
  if (options?.publicBaseUrl && !isHttpUrl(options.publicBaseUrl)) {
    addWarning('ACCESSI_PUBLIC_BASE_URL_INVALID', 'publicBaseUrl dovrebbe essere un URL http/https.');
  }

  if (options?.publicAuthRateLimit?.login && !positive(options.publicAuthRateLimit.login.windowMs)) {
    addError('ACCESSI_RATE_LIMIT_WINDOW_INVALID', 'publicAuthRateLimit.login.windowMs deve essere positivo.');
  }
  if (options?.publicAuthRateLimit?.login && !positive(options.publicAuthRateLimit.login.maxAttempts)) {
    addError('ACCESSI_RATE_LIMIT_ATTEMPTS_INVALID', 'publicAuthRateLimit.login.maxAttempts deve essere positivo.');
  }
  if (options?.edgeRateLimit) {
    if (options.edgeRateLimit.windowMs !== undefined && !positive(options.edgeRateLimit.windowMs)) {
      addError('ACCESSI_EDGE_RATE_LIMIT_WINDOW_INVALID', 'edgeRateLimit.windowMs deve essere positivo.');
    }
    if (options.edgeRateLimit.maxAttempts !== undefined && !positive(options.edgeRateLimit.maxAttempts)) {
      addError('ACCESSI_EDGE_RATE_LIMIT_ATTEMPTS_INVALID', 'edgeRateLimit.maxAttempts deve essere positivo.');
    }
  }
  if (options?.consoleEntry?.ttlMs !== undefined && !positive(options.consoleEntry.ttlMs)) {
    addError('ACCESSI_CONSOLE_ENTRY_TTL_INVALID', 'consoleEntry.ttlMs deve essere positivo.');
  }

  const authCookie = resolveAccessiAuthCookieOptions(options ?? {});
  if (authCookie) {
    const names = accessiCookieNames(authCookie);
    names.forEach((name, index) => {
      if (!isValidAccessiCookieName(name)) {
        addError(
          'ACCESSI_AUTH_COOKIE_NAME_INVALID',
          `Il nome cookie "${names[index]}" non e valido.`,
        );
      }
    });
    if (new Set(names).size !== names.length) {
      addError(
        'ACCESSI_AUTH_COOKIE_NAME_DUPLICATE',
        'I nomi dei cookie access, refresh e CSRF devono essere diversi.',
      );
    }
    if (authCookie.sameSite === 'none' && !authCookie.secure) {
      addError(
        'ACCESSI_AUTH_COOKIE_SAMESITE_NONE_INSECURE',
        'SameSite=None richiede secure: true.',
      );
    }
    if (!authCookie.accessPath.startsWith('/')) {
      addError('ACCESSI_AUTH_COOKIE_PATH_INVALID', 'accessPath deve iniziare con "/".');
    }
    if (!authCookie.refreshPath.startsWith('/')) {
      addError('ACCESSI_AUTH_COOKIE_PATH_INVALID', 'refreshPath deve iniziare con "/".');
    }
    if (!authCookie.csrfPath.startsWith('/')) {
      addError('ACCESSI_AUTH_COOKIE_PATH_INVALID', 'csrfPath deve iniziare con "/".');
    }
    if (authCookie.csrf === 'off') {
      addWarning(
        'ACCESSI_AUTH_COOKIE_CSRF_DISABLED',
        'CSRF disattivato in modalita cookie: l host deve applicare una propria protezione.',
      );
    }
    if (authCookie.exposeTokens) {
      addWarning(
        'ACCESSI_AUTH_COOKIE_TOKENS_EXPOSED',
        'exposeTokens restituisce i token nel body: riduce il beneficio di httpOnly.',
      );
    }
    if (!jwt?.refreshExpiresIn && authCookie.refreshFromCookie) {
      addWarning(
        'ACCESSI_AUTH_COOKIE_REFRESH_DISABLED',
        'refreshFromCookie e attivo ma jwtOptions.refreshExpiresIn non e configurato.',
      );
    }
  }

  return { errors, warnings };
}

/** Lancia un errore aggregato se la configurazione non e valida. */
export function assertValidAccessiOptions(options: AccessiOptions): void {
  const result = validateAccessiOptions(options);
  if (result.errors.length === 0) return;
  throw new Error(
    `Configurazione Accessi non valida:\n${result.errors
      .map((issue) => `- ${issue.code}: ${issue.message}`)
      .join('\n')}`,
  );
}
