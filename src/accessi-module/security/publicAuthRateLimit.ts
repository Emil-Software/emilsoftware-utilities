import { HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
import { RestUtilities } from '../../Utilities';
import type { AccessiOptions, PublicAuthRateLimitRuleOptions } from '../AccessiModule';
import { getDefaultRateLimitStore } from './rateLimitStore';
import type { RateLimitDecision, RateLimitStore } from './rateLimitStore';

export type PublicAuthRateLimitScope =
  | 'login'
  | 'twoFactorVerify'
  | 'twoFactorResend'
  | 'register'
  | 'passwordResetEmail'
  | 'passwordResetConfirm'
  | 'refresh'
  | 'getUserByToken'
  | 'adminBootstrap'
  | 'consoleEntry';

const DEFAULT_PUBLIC_AUTH_RATE_LIMITS: Record<
  PublicAuthRateLimitScope,
  PublicAuthRateLimitRuleOptions
> = {
  login: { windowMs: 15 * 60 * 1000, maxAttempts: 10 },
  twoFactorVerify: { windowMs: 15 * 60 * 1000, maxAttempts: 20 },
  twoFactorResend: { windowMs: 15 * 60 * 1000, maxAttempts: 5 },
  register: { windowMs: 60 * 60 * 1000, maxAttempts: 5 },
  passwordResetEmail: { windowMs: 60 * 60 * 1000, maxAttempts: 5 },
  passwordResetConfirm: { windowMs: 15 * 60 * 1000, maxAttempts: 10 },
  refresh: { windowMs: 5 * 60 * 1000, maxAttempts: 60 },
  getUserByToken: { windowMs: 5 * 60 * 1000, maxAttempts: 30 },
  adminBootstrap: { windowMs: 15 * 60 * 1000, maxAttempts: 10 },
  consoleEntry: { windowMs: 5 * 60 * 1000, maxAttempts: 30 },
};

function getRule(
  options: AccessiOptions,
  scope: PublicAuthRateLimitScope,
): PublicAuthRateLimitRuleOptions {
  const configuredRule = options.publicAuthRateLimit?.[scope];

  if (
    configuredRule &&
    Number.isFinite(configuredRule.windowMs) &&
    configuredRule.windowMs > 0 &&
    Number.isFinite(configuredRule.maxAttempts) &&
    configuredRule.maxAttempts > 0
  ) {
    return {
      windowMs: Math.trunc(configuredRule.windowMs),
      maxAttempts: Math.trunc(configuredRule.maxAttempts),
    };
  }

  return DEFAULT_PUBLIC_AUTH_RATE_LIMITS[scope];
}

async function consumeRateLimit(
  store: RateLimitStore,
  key: string,
  rule: PublicAuthRateLimitRuleOptions,
): Promise<RateLimitDecision> {
  try {
    return await store.consume(key, rule.windowMs, rule.maxAttempts);
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

function normalizeIdentifier(identifier: string): string | null {
  if (typeof identifier !== 'string') {
    return null;
  }

  const normalized = identifier.trim().toLowerCase();
  return normalized === '' ? null : normalized;
}

/**
 * Applica il rate limit per IP e, opzionalmente, per soggetto.
 *
 * Con `publicAuthRateLimit.store` e possibile usare uno store Redis condiviso;
 * senza store usa la memoria del processo.
 */
export async function checkPublicAuthRateLimit(
  options: AccessiOptions,
  scope: PublicAuthRateLimitScope,
  req: Request,
  identifiers: string[] = [],
): Promise<RateLimitDecision> {
  if (options.publicAuthRateLimit?.enabled === false) {
    return { allowed: true, retryAfterSeconds: 0 };
  }

  const rule = getRule(options, scope);
  const store = options.publicAuthRateLimit?.store ?? getDefaultRateLimitStore();
  const ipAddress =
    normalizeIdentifier(req.ip ?? req.socket?.remoteAddress ?? 'unknown') ?? 'unknown';

  // Consuma prima il bucket per IP: se gia bloccato non crea bucket per soggetto,
  // evitando crescita di memoria con identificatori sempre diversi.
  const ipDecision = await consumeRateLimit(store, `${scope}|ip|${ipAddress}`, rule);
  if (!ipDecision.allowed) {
    return ipDecision;
  }

  let retryAfterSeconds = 0;
  for (const identifier of identifiers) {
    const normalizedIdentifier = normalizeIdentifier(identifier);
    if (!normalizedIdentifier) {
      continue;
    }

    const subjectDecision = await consumeRateLimit(
      store,
      `${scope}|ip-subject|${ipAddress}|${normalizedIdentifier}`,
      rule,
    );
    if (!subjectDecision.allowed) {
      retryAfterSeconds = Math.max(retryAfterSeconds, subjectDecision.retryAfterSeconds);
    }
  }

  if (retryAfterSeconds > 0) {
    return { allowed: false, retryAfterSeconds };
  }

  return { allowed: true, retryAfterSeconds: 0 };
}

export function sendPublicAuthRateLimitExceeded(
  res: Response,
  retryAfterSeconds: number,
): Response {
  res.setHeader('Retry-After', String(retryAfterSeconds));
  return RestUtilities.sendErrorMessage(
    res,
    'Troppi tentativi. Riprova piu tardi.',
    'PublicAuthRateLimit',
    HttpStatus.TOO_MANY_REQUESTS,
  );
}
