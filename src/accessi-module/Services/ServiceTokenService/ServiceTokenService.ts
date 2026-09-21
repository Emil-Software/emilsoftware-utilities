import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { autobind } from '../../../autobind';
import { Orm } from '../../../Orm';
import { RestUtilities } from '../../../Utilities';
import type { AccessiOptions } from '../../AccessiModule';

/** Prefisso riconoscibile dei token di servizio; il formato completo e `st_<id>.<segreto>`. */
export const SERVICE_TOKEN_PREFIX = 'st_';
const TOKEN_ID_PATTERN = /^st_[a-f0-9]{32}$/;
const SCOPE_PATTERN = /^[a-z0-9:_-]{1,40}$/i;
const LAST_USED_REFRESH_MS = 60_000;

/** Metadati pubblici di un token (mai il segreto). */
export interface ServiceTokenMetadata {
  tokenId: string;
  label: string;
  scopes: string[];
  createdAt?: string;
  expiresAt?: string;
  lastUsedAt?: string;
  revoked: boolean;
  revokedAt?: string;
}

/** Risultato dell'emissione: contiene il segreto in chiaro, mostrato una sola volta. */
export interface IssuedServiceToken extends ServiceTokenMetadata {
  token: string;
}

/** Risultato della verifica di un token presentato. */
export interface VerifiedServiceToken {
  tokenId: string;
  label: string;
  scopes: string[];
}

export interface IssueServiceTokenInput {
  label: string;
  scopes?: string[];
  expiresAt?: Date | string | null;
  /** Giorni di validita; ignorato se `expiresAt` e valorizzato. */
  ttlDays?: number;
}

/** Genera un nuovo token di servizio: identificativo pubblico + segreto ad alta entropia. */
export function generateServiceToken(): { token: string; tokenId: string; secret: string } {
  const tokenId = `${SERVICE_TOKEN_PREFIX}${randomBytes(16).toString('hex')}`;
  const secret = randomBytes(32).toString('base64url');
  return { token: `${tokenId}.${secret}`, tokenId, secret };
}

/** Estrae identificativo e segreto; restituisce `null` se il formato non e valido. */
export function parseServiceToken(token: unknown): { tokenId: string; secret: string } | null {
  if (typeof token !== 'string') {
    return null;
  }

  const separator = token.indexOf('.');
  if (separator <= 0) {
    return null;
  }

  const tokenId = token.slice(0, separator);
  const secret = token.slice(separator + 1);
  if (!TOKEN_ID_PATTERN.test(tokenId) || secret.length < 16) {
    return null;
  }

  return { tokenId, secret };
}

/** Hash del segreto per lo storage at-rest. Il segreto e ad alta entropia (256 bit), non una password. */
export function hashServiceTokenSecret(secret: string): string {
  return createHash('sha256').update(secret, 'utf8').digest('hex');
}

/** Normalizza e valida gli scope: trim, dedup e controllo del formato. */
export function normalizeServiceTokenScopes(scopes: string[] | undefined): string[] {
  if (scopes === undefined) {
    return [];
  }
  if (!Array.isArray(scopes)) {
    throw new BadRequestException('Gli scope devono essere un array di stringhe.');
  }

  const normalized: string[] = [];
  for (const rawScope of scopes) {
    if (typeof rawScope !== 'string' || !SCOPE_PATTERN.test(rawScope.trim())) {
      throw new BadRequestException(`Scope non valido: ${String(rawScope)}. Usare lettere, numeri, ':', '_' o '-'.`);
    }
    const scope = rawScope.trim().toLowerCase();
    if (!normalized.includes(scope)) {
      normalized.push(scope);
    }
  }
  return normalized;
}

/** True se l'insieme di scope soddisfa quello richiesto (uno scope vuoto non richiede nulla). */
export function serviceTokenHasScope(scopes: string[], required: string | undefined): boolean {
  if (!required) {
    return true;
  }
  return scopes.includes(required.toLowerCase());
}

function toIso(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function resolveExpiration(input: IssueServiceTokenInput, defaultTtlDays?: number): Date | null {
  if (input.expiresAt !== undefined && input.expiresAt !== null && input.expiresAt !== '') {
    const expiresAt = input.expiresAt instanceof Date ? input.expiresAt : new Date(String(input.expiresAt));
    if (Number.isNaN(expiresAt.getTime())) {
      throw new BadRequestException('Data di scadenza non valida.');
    }
    if (expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('La data di scadenza deve essere nel futuro.');
    }
    return expiresAt;
  }

  const ttlDays = input.ttlDays ?? defaultTtlDays;
  if (typeof ttlDays === 'number' && Number.isFinite(ttlDays) && ttlDays > 0) {
    return new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000);
  }

  return null;
}

/** Gestisce il ciclo di vita dei token di servizio (emissione, elenco, revoca, rotazione, verifica). */
@autobind
@Injectable()
export class ServiceTokenService {
  constructor(@Inject('ACCESSI_OPTIONS') private readonly accessiOptions: AccessiOptions) {}

  private get databaseOptions() {
    return this.accessiOptions.databaseOptions;
  }

  private toMetadata(row: Record<string, unknown>): ServiceTokenMetadata {
    const scopesRaw = typeof row.scopes === 'string' ? row.scopes.trim() : '';
    return {
      tokenId: String(row.tokenId ?? ''),
      label: typeof row.label === 'string' ? row.label : '',
      scopes: scopesRaw === '' ? [] : scopesRaw.split(/\s+/),
      createdAt: toIso(row.createdAt),
      expiresAt: toIso(row.expiresAt),
      lastUsedAt: toIso(row.lastUsedAt),
      revoked: row.revokedAt !== undefined && row.revokedAt !== null,
      revokedAt: toIso(row.revokedAt),
    };
  }

  private async readRow(tokenId: string): Promise<Record<string, unknown> | undefined> {
    const rows = await Orm.query(
      this.databaseOptions,
      `SELECT TOKEN_ID, TOKEN_HASH, LABEL, SCOPES, CREATED_BY, CREATED_AT, EXPIRES_AT, LAST_USED_AT, REVOKED_AT
       FROM ACCESSI_SERVICE_TOKEN WHERE TOKEN_ID = ?`,
      [tokenId],
      false,
    );
    return (rows.map(RestUtilities.convertKeysToCamelCase) as Array<Record<string, unknown>>)[0];
  }

  /** Crea un nuovo token. Il segreto in chiaro e restituito una sola volta e non e recuperabile. */
  async issue(input: IssueServiceTokenInput, createdBy?: number): Promise<IssuedServiceToken> {
    const label = typeof input?.label === 'string' ? input.label.trim() : '';
    if (label.length < 1 || label.length > 100) {
      throw new BadRequestException('La descrizione del token deve essere compresa tra 1 e 100 caratteri.');
    }

    const scopes = normalizeServiceTokenScopes(input.scopes);
    const expiresAt = resolveExpiration(input, this.accessiOptions.serviceTokens?.defaultTtlDays);
    const { token, tokenId, secret } = generateServiceToken();

    await Orm.execute(
      this.databaseOptions,
      `INSERT INTO ACCESSI_SERVICE_TOKEN (TOKEN_ID, TOKEN_HASH, LABEL, SCOPES, CREATED_BY, EXPIRES_AT)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [tokenId, hashServiceTokenSecret(secret), label, scopes.join(' '), createdBy ?? null, expiresAt],
    );

    const row = await this.readRow(tokenId);
    return { ...this.toMetadata(row ?? { tokenId, label, scopes: scopes.join(' ') }), token };
  }

  /** Elenca i token (metadati soltanto, mai il segreto). */
  async list(includeRevoked = false): Promise<ServiceTokenMetadata[]> {
    const rows = await Orm.query(
      this.databaseOptions,
      `SELECT TOKEN_ID, LABEL, SCOPES, CREATED_BY, CREATED_AT, EXPIRES_AT, LAST_USED_AT, REVOKED_AT
       FROM ACCESSI_SERVICE_TOKEN ${includeRevoked ? '' : 'WHERE REVOKED_AT IS NULL'}
       ORDER BY CREATED_AT DESC, TOKEN_ID DESC`,
      [],
      false,
    );
    return (rows.map(RestUtilities.convertKeysToCamelCase) as Array<Record<string, unknown>>).map((row) => this.toMetadata(row));
  }

  /** Revoca un token rendendolo immediatamente inutilizzabile. Idempotente su token gia revocati. */
  async revoke(tokenId: string): Promise<void> {
    const parsed = parseServiceToken(tokenId);
    const normalizedId = parsed?.tokenId ?? tokenId;
    const row = await this.readRow(normalizedId);
    if (!row) {
      throw new NotFoundException(`Token di servizio ${normalizedId} non trovato.`);
    }
    if (row.revokedAt !== undefined && row.revokedAt !== null) {
      return;
    }
    await Orm.execute(
      this.databaseOptions,
      'UPDATE ACCESSI_SERVICE_TOKEN SET REVOKED_AT = CURRENT_TIMESTAMP WHERE TOKEN_ID = ?',
      [normalizedId],
    );
  }

  /** Revoca il token indicato ed emette un sostituto con gli stessi metadati. */
  async rotate(tokenId: string, createdBy?: number): Promise<IssuedServiceToken> {
    const parsed = parseServiceToken(tokenId);
    const normalizedId = parsed?.tokenId ?? tokenId;
    const row = await this.readRow(normalizedId);
    if (!row) {
      throw new NotFoundException(`Token di servizio ${normalizedId} non trovato.`);
    }

    const metadata = this.toMetadata(row);
    await this.revoke(normalizedId);

    return this.issue(
      {
        label: metadata.label,
        scopes: metadata.scopes,
        expiresAt: metadata.expiresAt ?? null,
      },
      createdBy,
    );
  }

  /**
   * Verifica un token presentato: formato, esistenza, revoca, scadenza e hash a tempo costante.
   * Aggiorna `LAST_USED_AT` (best-effort, al massimo una volta al minuto).
   */
  async verify(token: string): Promise<VerifiedServiceToken | undefined> {
    const parsed = parseServiceToken(token);
    if (!parsed) {
      return undefined;
    }

    const row = await this.readRow(parsed.tokenId);
    if (!row) {
      return undefined;
    }

    if (row.revokedAt !== undefined && row.revokedAt !== null) {
      return undefined;
    }

    const expiresAt = toIso(row.expiresAt);
    if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) {
      return undefined;
    }

    const storedHash = typeof row.tokenHash === 'string' ? row.tokenHash : '';
    if (!storedHash || !this.safeHashEquals(hashServiceTokenSecret(parsed.secret), storedHash)) {
      return undefined;
    }

    const metadata = this.toMetadata(row);
    await this.touchLastUsed(parsed.tokenId, row.lastUsedAt).catch(() => undefined);

    return { tokenId: metadata.tokenId, label: metadata.label, scopes: metadata.scopes };
  }

  private safeHashEquals(candidate: string, stored: string): boolean {
    const candidateBuffer = Buffer.from(candidate, 'hex');
    const storedBuffer = Buffer.from(stored, 'hex');
    if (candidateBuffer.length !== storedBuffer.length || candidateBuffer.length === 0) {
      return false;
    }
    return timingSafeEqual(candidateBuffer, storedBuffer);
  }

  private async touchLastUsed(tokenId: string, lastUsedAt: unknown): Promise<void> {
    const lastUsed = toIso(lastUsedAt);
    if (lastUsed && Date.now() - new Date(lastUsed).getTime() < LAST_USED_REFRESH_MS) {
      return;
    }
    await Orm.execute(
      this.databaseOptions,
      'UPDATE ACCESSI_SERVICE_TOKEN SET LAST_USED_AT = CURRENT_TIMESTAMP WHERE TOKEN_ID = ?',
      [tokenId],
      false,
    );
  }
}
