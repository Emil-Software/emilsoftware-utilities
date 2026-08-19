import { HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
import { RestUtilities } from '../../Utilities';
import { AccessiOptions, PublicAuthRateLimitRuleOptions } from '../AccessiModule';

export type PublicAuthRateLimitScope =
  | 'login'
  | 'register'
  | 'passwordResetEmail'
  | 'passwordResetConfirm'
  | 'getUserByToken';

type RateLimitBucket = {
  count: number;
  resetAt: number;
  lastSeenAt: number;
};

type RateLimitDecision = {
  allowed: boolean;
  retryAfterSeconds?: number;
};

const DEFAULT_PUBLIC_AUTH_RATE_LIMITS: Record<
  PublicAuthRateLimitScope,
  PublicAuthRateLimitRuleOptions
> = {
  login: { windowMs: 15 * 60 * 1000, maxAttempts: 10 },
  register: { windowMs: 60 * 60 * 1000, maxAttempts: 5 },
  passwordResetEmail: { windowMs: 60 * 60 * 1000, maxAttempts: 5 },
  passwordResetConfirm: { windowMs: 15 * 60 * 1000, maxAttempts: 10 },
  getUserByToken: { windowMs: 5 * 60 * 1000, maxAttempts: 30 },
};

const RATE_LIMIT_BUCKETS = new Map<string, RateLimitBucket>();
const MAX_TRACKED_BUCKETS = 20000;
const MAX_WINDOW_MS = Math.max(
  ...Object.values(DEFAULT_PUBLIC_AUTH_RATE_LIMITS).map((rule) => rule.windowMs),
);

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

function normalizeIdentifier(identifier: string): string | null {
  if (typeof identifier !== 'string') {
    return null;
  }

  const normalized = identifier.trim().toLowerCase();
  return normalized === '' ? null : normalized;
}

function pruneRateLimitBuckets(now: number): void {
  if (RATE_LIMIT_BUCKETS.size < MAX_TRACKED_BUCKETS) {
    return;
  }

  for (const [key, bucket] of RATE_LIMIT_BUCKETS.entries()) {
    if (bucket.resetAt <= now || bucket.lastSeenAt <= now - MAX_WINDOW_MS * 2) {
      RATE_LIMIT_BUCKETS.delete(key);
    }

    if (RATE_LIMIT_BUCKETS.size < MAX_TRACKED_BUCKETS) {
      return;
    }
  }
}

function consumeBucket(
  bucketKey: string,
  rule: PublicAuthRateLimitRuleOptions,
  now: number,
): number | null {
  const existingBucket = RATE_LIMIT_BUCKETS.get(bucketKey);
  if (!existingBucket || existingBucket.resetAt <= now) {
    RATE_LIMIT_BUCKETS.set(bucketKey, {
      count: 1,
      resetAt: now + rule.windowMs,
      lastSeenAt: now,
    });
    return null;
  }

  existingBucket.lastSeenAt = now;
  if (existingBucket.count >= rule.maxAttempts) {
    return Math.max(1, Math.ceil((existingBucket.resetAt - now) / 1000));
  }

  existingBucket.count += 1;
  return null;
}

export function checkPublicAuthRateLimit(
  options: AccessiOptions,
  scope: PublicAuthRateLimitScope,
  req: Request,
  identifiers: string[] = [],
): RateLimitDecision {
  if (options.publicAuthRateLimit?.enabled === false) {
    return { allowed: true };
  }

  const rule = getRule(options, scope);
  const now = Date.now();
  pruneRateLimitBuckets(now);

  const ipAddress =
    normalizeIdentifier(req.ip ?? req.socket?.remoteAddress ?? 'unknown') ?? 'unknown';
  const bucketKeys = new Set<string>([`${scope}|ip|${ipAddress}`]);

  for (const identifier of identifiers) {
    const normalizedIdentifier = normalizeIdentifier(identifier);
    if (!normalizedIdentifier) {
      continue;
    }

    bucketKeys.add(`${scope}|ip-subject|${ipAddress}|${normalizedIdentifier}`);
  }

  let retryAfterSeconds = 0;
  for (const bucketKey of bucketKeys) {
    const bucketRetryAfterSeconds = consumeBucket(bucketKey, rule, now);
    if (bucketRetryAfterSeconds) {
      retryAfterSeconds = Math.max(retryAfterSeconds, bucketRetryAfterSeconds);
    }
  }

  if (retryAfterSeconds > 0) {
    return {
      allowed: false,
      retryAfterSeconds,
    };
  }

  return { allowed: true };
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
