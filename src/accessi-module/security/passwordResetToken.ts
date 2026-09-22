import * as jwt from 'jsonwebtoken';
import { createHmac } from 'crypto';
import type { AccessiOptions } from '../AccessiModule';

/** Durata predefinita del token di reset. La monouso e garantita anche dal nonce persistito in `UTENTI.KEYREG`. */
export const DEFAULT_PASSWORD_RESET_EXPIRES_IN = '1h';

interface PasswordResetTokenPayload extends jwt.JwtPayload {
  nonce: string;
  typ: 'password-reset';
}

/** Scopo della chiave derivata: separa le chiavi di access token, reset password e 2FA. */
export type AccessiJwtPurpose = 'access' | 'reset' | '2fa';

/**
 * Deriva una chiave JWT per scopo dal segreto configurato (key separation senza nuova configurazione).
 * Un leak della chiave di reset non compromette gli access token e viceversa.
 */
export function getAccessiJwtSecret(options: AccessiOptions, purpose: AccessiJwtPurpose = 'access'): string {
  const secret = options?.jwtOptions?.secret || process.env.ACC_JWT_SECRET;
  if (!secret) {
    throw new Error('JWT secret non configurato.');
  }

  return createHmac('sha256', secret).update(`accessi:jwt:${purpose}:v1`).digest('hex');
}

/** Crea un token firmato contenente solo codice utente e nonce; non inserire email o dati personali nelle claim. */
export function createPasswordResetToken(
  codiceUtente: number,
  nonce: string,
  secret: string,
  expiresIn: jwt.SignOptions['expiresIn'] = DEFAULT_PASSWORD_RESET_EXPIRES_IN,
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
      expiresIn,
    },
  );
}

/** Verifica firma e scadenza, quindi restituisce i dati minimi necessari al reset. */
export function verifyPasswordResetToken(
  token: string,
  secret: string,
): { codiceUtente: number; nonce: string } {
  const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] }) as PasswordResetTokenPayload;
  const codiceUtente = Number(decoded?.sub);

  if (decoded?.typ !== 'password-reset' || !Number.isSafeInteger(codiceUtente) || codiceUtente <= 0 || typeof decoded?.nonce !== 'string' || !decoded.nonce) {
    throw new Error('Token di reset non valido.');
  }

  return {
    codiceUtente,
    nonce: decoded.nonce,
  };
}
