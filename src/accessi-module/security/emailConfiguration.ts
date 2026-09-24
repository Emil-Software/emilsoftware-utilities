import { BadRequestException } from '@nestjs/common';
import type { AccessiOptions } from '../AccessiModule';

/** Codice stabile usato nel contratto errore quando manca la configurazione email. */
export const ACCESSI_EMAIL_NOT_CONFIGURED = 'ACCESSI_EMAIL_NOT_CONFIGURED';

/**
 * Errore sollevato quando un'operazione richiede l'invio di email (reset password, 2FA,
 * creazione utente) ma `AccessiOptions.emailOptions` non e configurato. E' una BadRequestException
 * con un `code` stabile, cosi il contratto HTTP risponde 400 con ACCESSI_EMAIL_NOT_CONFIGURED.
 */
export class AccessiEmailNotConfiguredError extends BadRequestException {
  public get code(): string {
    return ACCESSI_EMAIL_NOT_CONFIGURED;
  }

  constructor(message = 'Nessun servizio email configurato (AccessiOptions.emailOptions): impossibile inviare email di reset password o 2FA.') {
    super({ code: ACCESSI_EMAIL_NOT_CONFIGURED, message });
    this.name = 'AccessiEmailNotConfiguredError';
  }
}

/**
 * True se `emailOptions` contiene i campi minimi per inviare posta (host SMTP e mittente).
 * Non verifica la raggiungibilita del server: quella si scopre all'invio.
 */
export function isEmailConfigured(options: AccessiOptions): boolean {
  const email = options?.emailOptions as { host?: unknown; from?: unknown } | undefined;
  if (!email) return false;
  return typeof email.host === 'string' && email.host.trim() !== ''
    && typeof email.from === 'string' && email.from.trim() !== '';
}

/** Fail-fast utilizzato dal bootstrap e dalle operazioni che dipendono dalla posta. */
export function assertEmailConfigured(options: AccessiOptions): void {
  if (!isEmailConfigured(options)) {
    throw new AccessiEmailNotConfiguredError();
  }
}
