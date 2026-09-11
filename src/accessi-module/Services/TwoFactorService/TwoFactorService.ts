import { HttpException, Inject, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'crypto';
import { Orm } from '../../../Orm';
import { RestUtilities } from '../../../Utilities';
import { AccessiOptions } from '../../AccessiModule';
import { TwoFactorChallengeDto } from '../../Dtos/TwoFactorDtos';
import { getAccessiJwtSecret } from '../../security/passwordResetToken';
import { EmailService } from '../EmailService/EmailService';

export type TwoFactorMode = 'password' | 'passwordless' | 'federated';
export interface TwoFactorProof {
  codiceUtente: number;
  email: string;
  mode: TwoFactorMode;
  identityKey?: string;
}
type ChallengeRow = TwoFactorProof & {
  codeHash: string;
  expiresAt: Date;
  attempts: number;
  sends: number;
  sentAt: Date;
};
type Query = (sql: string, params?: unknown[]) => Promise<any>;

const LIFETIME_SECONDS = 600;
const MAX_ATTEMPTS = 5;
const RESEND_SECONDS = 60;
const MAX_SENDS = 3;
const RETURN_FIELDS = 'CODUTE, EMAIL, AUTHMODE, IDNKEY, CODEHASH, EXPIRES_AT, ATTEMPTS, SENDS, SENT_AT';

/** Database-backed challenges: no OTP, password or authentication token is logged or stored in clear text. */
@Injectable()
export class TwoFactorService {
  constructor(
    @Inject('ACCESSI_OPTIONS') private readonly options: AccessiOptions,
    private readonly emailService: EmailService,
  ) {}

  private invalid(): UnauthorizedException {
    return new UnauthorizedException({ code: 'ACCESSI_2FA_INVALID', message: 'Codice non valido o scaduto. Ripeti l accesso se hai esaurito i tentativi.' });
  }

  private limited(): HttpException {
    return new HttpException({ code: 'ACCESSI_2FA_RATE_LIMITED', message: 'Attendi prima di richiedere un altro codice.' }, 429);
  }

  private hash(id: string, code: string): string {
    return createHmac('sha256', getAccessiJwtSecret(this.options)).update(`accessi-2fa:${id}:${code}`).digest('hex');
  }

  private row(result: any): ChallengeRow | undefined {
    const row = Array.isArray(result) ? result[0] : result;
    if (!row) return undefined;
    const raw = RestUtilities.convertKeysToCamelCase(row);
    const converted: ChallengeRow = {
      codiceUtente: Number(raw.codute), email: raw.email?.trim(), mode: raw.authmode?.trim(), identityKey: raw.idnkey?.trim(),
      codeHash: raw.codehash, expiresAt: raw.expiresAt, attempts: Number(raw.attempts), sends: Number(raw.sends), sentAt: raw.sentAt,
    };
    return converted.codiceUtente ? converted : undefined;
  }

  private async transaction<T>(operation: (query: Query) => Promise<T>): Promise<T> {
    const db = await Orm.connect(this.options.databaseOptions);
    let transaction: Awaited<ReturnType<typeof Orm.startTransaction>> | undefined;
    try {
      transaction = await Orm.startTransaction(db);
      const query: Query = (sql, params = []) => new Promise((resolve, reject) => {
        transaction!.query(sql, params, (error, result) => error ? reject(error) : resolve(result));
      });
      const result = await operation(query);
      await Orm.commitTransaction(transaction);
      return result;
    } catch (error) {
      if (transaction) await Orm.rollbackTransaction(transaction).catch(() => undefined);
      throw error;
    } finally {
      await new Promise<void>(resolve => db.detach(() => resolve()));
    }
  }

  private response(id: string, expiresAt: Date): TwoFactorChallengeDto {
    return { twoFactorRequired: true, challengeId: id, expiresAt: new Date(expiresAt).toISOString(), resendAfterSeconds: RESEND_SECONDS, method: 'email' };
  }

  private async deliver(id: string, code: string, email: string): Promise<void> {
    try {
      await this.emailService.sendTwoFactorCode(email, code, LIFETIME_SECONDS / 60);
    } catch {
      // Invalidate only the code whose delivery failed, preserving a concurrent newer code.
      await Orm.execute(this.options.databaseOptions,
        'UPDATE ACCESSI_2FA SET ATTEMPTS = ? WHERE CHALLENGE_ID = ? AND CODEHASH = ?',
        [MAX_ATTEMPTS, id, this.hash(id, code)], false).catch(() => undefined);
      throw new ServiceUnavailableException({ code: 'ACCESSI_2FA_DELIVERY_FAILED', message: 'Invio del codice non riuscito. Riprova tra poco.' });
    }
  }

  async issue(proof: TwoFactorProof): Promise<TwoFactorChallengeDto> {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(proof.email ?? '')) {
      throw new ServiceUnavailableException({ code: 'ACCESSI_2FA_EMAIL_REQUIRED', message: 'Per il codice di accesso serve un indirizzo email valido. Contatta un amministratore.' });
    }
    const id = randomBytes(32).toString('hex');
    const code = String(randomInt(1000000)).padStart(6, '0');
    const expiresAt = await this.transaction(async query => {
      // Serialize issuance for this account across backend instances.
      await query('SELECT CODUTE FROM UTENTI WHERE CODUTE = ? WITH LOCK', [proof.codiceUtente]);
      const recent = await query('SELECT COUNT(*) AS TOTAL FROM ACCESSI_2FA WHERE CODUTE = ? AND CREATED_AT > DATEADD(-15 MINUTE TO CURRENT_TIMESTAMP)', [proof.codiceUtente]);
      if (Number(recent?.[0]?.TOTAL ?? recent?.[0]?.total ?? 0) >= 5) throw this.limited();
      await query('DELETE FROM ACCESSI_2FA WHERE EXPIRES_AT < DATEADD(-1 DAY TO CURRENT_TIMESTAMP)');
      const created = await query(
        `INSERT INTO ACCESSI_2FA (CHALLENGE_ID, CODUTE, EMAIL, AUTHMODE, IDNKEY, CODEHASH, EXPIRES_AT) VALUES (?, ?, ?, ?, ?, ?, DATEADD(${LIFETIME_SECONDS} SECOND TO CURRENT_TIMESTAMP)) RETURNING EXPIRES_AT`,
        [id, proof.codiceUtente, proof.email, proof.mode, proof.identityKey ?? null, this.hash(id, code)],
      );
      const row = Array.isArray(created) ? created[0] : created;
      return row.EXPIRES_AT ?? row.expires_at;
    });
    await this.deliver(id, code, proof.email);
    return this.response(id, expiresAt);
  }

  async describe(id: string): Promise<TwoFactorProof> {
    if (!/^[a-f0-9]{64}$/.test(id)) throw this.invalid();
    const row = this.row(await Orm.query(this.options.databaseOptions,
      `SELECT ${RETURN_FIELDS} FROM ACCESSI_2FA WHERE CHALLENGE_ID = ? AND EXPIRES_AT > CURRENT_TIMESTAMP AND ATTEMPTS < ?`, [id, MAX_ATTEMPTS], false));
    if (!row) throw this.invalid();
    return row;
  }

  async resend(id: string): Promise<TwoFactorChallengeDto> {
    if (!/^[a-f0-9]{64}$/.test(id)) throw this.invalid();
    const code = String(randomInt(1000000)).padStart(6, '0');
    const row = await this.transaction(async query => {
      const result = this.row(await query(
        `UPDATE ACCESSI_2FA SET CODEHASH = ?, SENDS = SENDS + 1, SENT_AT = CURRENT_TIMESTAMP WHERE CHALLENGE_ID = ? AND EXPIRES_AT > CURRENT_TIMESTAMP AND ATTEMPTS < ? AND SENDS < ? AND SENT_AT <= DATEADD(-${RESEND_SECONDS} SECOND TO CURRENT_TIMESTAMP) RETURNING ${RETURN_FIELDS}`,
        [this.hash(id, code), id, MAX_ATTEMPTS, MAX_SENDS],
      ));
      if (!result) throw this.limited();
      return result;
    });
    await this.deliver(id, code, row.email);
    return this.response(id, row.expiresAt);
  }

  async consume(id: string, code: string): Promise<TwoFactorProof> {
    if (!/^[a-f0-9]{64}$/.test(id) || !/^\d{6}$/.test(code)) throw this.invalid();
    const proof = await this.transaction(async query => {
      // The conditional write serializes verification and persists failed attempts.
      const row = this.row(await query(
        `UPDATE ACCESSI_2FA SET ATTEMPTS = ATTEMPTS + 1 WHERE CHALLENGE_ID = ? AND EXPIRES_AT > CURRENT_TIMESTAMP AND ATTEMPTS < ? RETURNING ${RETURN_FIELDS}`,
        [id, MAX_ATTEMPTS],
      ));
      if (!row) return null;
      const expected = Buffer.from(row.codeHash.trim(), 'hex');
      const actual = Buffer.from(this.hash(id, code), 'hex');
      if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
      await query('UPDATE ACCESSI_2FA SET ATTEMPTS = ? WHERE CHALLENGE_ID = ?', [MAX_ATTEMPTS, id]);
      return row;
    });
    // Throw after commit, otherwise a wrong code would roll back the attempt counter.
    if (!proof) throw this.invalid();
    return proof;
  }
}
