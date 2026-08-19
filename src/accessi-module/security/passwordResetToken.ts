import * as jwt from 'jsonwebtoken';
import { AccessiOptions } from '../AccessiModule';

export const DEFAULT_PASSWORD_RESET_EXPIRES_IN = '1h';

interface PasswordResetTokenPayload extends jwt.JwtPayload {
  nonce: string;
  typ: 'password-reset';
}

export function getAccessiJwtSecret(options: AccessiOptions): string {
  const secret = options?.jwtOptions?.secret || process.env.ACC_JWT_SECRET;
  if (!secret) {
    throw new Error('JWT secret non configurato.');
  }

  return secret;
}

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

export function verifyPasswordResetToken(
  token: string,
  secret: string,
): { codiceUtente: number; nonce: string } {
  const decoded = jwt.verify(token, secret) as PasswordResetTokenPayload;
  const codiceUtente = Number(decoded?.sub);

  if (decoded?.typ !== 'password-reset' || !codiceUtente || typeof decoded?.nonce !== 'string') {
    throw new Error('Token di reset non valido.');
  }

  return {
    codiceUtente,
    nonce: decoded.nonce,
  };
}
