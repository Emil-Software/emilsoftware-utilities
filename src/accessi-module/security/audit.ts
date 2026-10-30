import { Logger } from '../../Logger';

/**
 * Audit strutturato degli eventi di sicurezza Accessi.
 *
 * Il Logger redige gia campi come token, password, secret e authorization.
 * Non inserire mai payload completi o segreti nei dettagli.
 */
export function auditAccessi(event: string, details: Record<string, unknown> = {}): void {
  new Logger('AccessiAudit').warning(
    JSON.stringify({
      event,
      timestamp: new Date().toISOString(),
      ...details,
    }),
  );
}
