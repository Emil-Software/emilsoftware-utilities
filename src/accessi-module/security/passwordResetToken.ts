import * as jwt from 'jsonwebtoken';
import type { AccessiOptions } from '../AccessiModule';

/** Durata predefinita del token di reset. La monouso e garantita anche dal nonce persistito in `UTENTI.KEYREG`. */
export const DEFAULT_PASSWORD_RESET_EXPIRES_IN = '1h';

interface PasswordResetTokenPayload extends jwt.JwtPayload {
  nonce: string;
  typ: 'password-reset';
}

/** Restituisce il segreto JWT Accessi oppure fallisce in modo esplicito quando la configurazione e incompleta. */
export function getAccessiJwtSecret(options: AccessiOptions): string {
  const secret = options?.jwtOptions?.secret || process.env.ACC_JWT_SECRET;
  if (!secret) {
    throw new Error('JWT secret non configurato.');
  }

  return secret;
}

/** Crea un token firmato contenente solo codice utente e nonce; non inserire email o dati personali nelle claim. */
export function createPasswordResetToken(
  codiceUtente: number,
  nonce: string,
  secret: string,
  expiresIn: string = DEFAULT_PASSWORD_RESET_EXPIRES_IN,
): string {
  if (!codiceUtente || !nonce) {
    throw new Error('Dati insufficienti per generare il reset token.');
  }

  return jwt.sign(
    {
      nonce,
      typ: 'password-reset',
    },
    secret,
    {
      subject: `${codiceUtente}`,
      expiresIn: expiresIn as any,
    },
  );
}

/** Verifica firma e scadenza, quindi restituisce i dati minimi necessari al reset. */
export function verifyPasswordResetToken(
  token: string,
  secret: string,
): { codiceUtente: number; nonce: string } {
  const decoded = jwt.verify(token, secret) as PasswordResetTokenPayload;
  const codiceUtente = Number(decoded?.sub);

  if (decoded?.typ !== 'password-reset' || !Number.isSafeInteger(codiceUtente) || codiceUtente <= 0 || typeof decoded?.nonce !== 'string' || !decoded.nonce) {
    throw new Error('Token di reset non valido.');
  }

  return {
    codiceUtente,
    nonce: decoded.nonce,
  };
}
