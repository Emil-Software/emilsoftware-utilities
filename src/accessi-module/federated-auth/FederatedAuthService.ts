import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, InternalServerErrorException, NotFoundException, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'crypto';
import { AccessiDatabaseUpdater } from '../database-updates/AccessiDatabaseUpdater';
import { Orm } from '../../Orm';
import { RestUtilities } from '../../Utilities';
import type { AccessiOptions } from '../AccessiModule';
import { RegisterRequest } from '../Dtos/RegisterRequest';
import { StatoRegistrazione } from '../Dtos/StatoRegistrazione';
import { AuthService } from '../Services/AuthService/AuthService';
import { UserService } from '../Services/UserService/UserService';
import { isAuthenticatedUserEnabledForJwt } from '../security/authenticatedToken';
import { FederatedAuthenticationResult, FederatedIdentity, FederatedProvider, VerifiedFederatedIdentity } from './FederatedAuthTypes';

type IdentityRow = {
  identityKey?: string;
  codiceUtente?: number;
  provider?: string;
  subject?: string;
  active?: unknown;
  createdAt?: Date | string;
  lastLoginAt?: Date | string;
  disabledAt?: Date | string;
  note?: string;
  passwordLoginEnabled?: unknown;
};

type ProviderRow = {
  provider?: string;
  description?: string;
  active?: unknown;
  createdAt?: Date | string;
  note?: string;
};

/**
 * Maps externally verified identities to Accessi users and issues the usual
 * Accessi JWT. It deliberately has no provider SDK dependency: validating an
 * Azure, Google, Apple, SAML, or custom token is always the hosting backend's job.
 */
@Injectable()
export class FederatedAuthService implements OnModuleInit {
  constructor(
    @Inject('ACCESSI_OPTIONS') private readonly options: AccessiOptions,
    private readonly userService: UserService,
    private readonly authService: AuthService,
  ) {}

  /** Await the same schema barrier as the module updater; never race two DDL implementations. */
  async onModuleInit(): Promise<void> {
    await AccessiDatabaseUpdater.initialize(this.options);
  }

  /** Returns true only when the host application opted in to federated authentication. */
  isEnabled(): boolean {
    return this.options.federatedAuthentication?.enabled === true;
  }

  /**
   * Exchanges a backend-verified identity for the same login result and JWT
   * emitted by the local password endpoint. No raw external token is accepted.
   */
  async authenticate(identity: VerifiedFederatedIdentity): Promise<FederatedAuthenticationResult> {
    this.assertEnabled();
    const normalized = this.normalizeIdentity(identity);
    await this.assertProviderActive(normalized.provider);
    const linkedIdentity = await this.findIdentity(normalized, true);

    if (!linkedIdentity) {
      throw new NotFoundException({ code: 'FEDERATED_IDENTITY_NOT_LINKED', message: 'Identita esterna non associata a un utente Accessi.' });
    }

    const currentUser = await this.userService.getAuthenticatedUserSnapshot(linkedIdentity.codiceUtente);
    if (!isAuthenticatedUserEnabledForJwt(currentUser)) {
      throw new ForbiddenException({ code: 'FEDERATED_USER_DISABLED', message: 'Utente Accessi non abilitato.' });
    }

    if (currentUser.flagDueFattori) {
      const login = await this.authService.beginFederatedTwoFactor(linkedIdentity.codiceUtente, linkedIdentity.identityKey);
      return { codiceUtente: linkedIdentity.codiceUtente, login };
    }

    await Orm.execute(
      this.options.databaseOptions,
      'UPDATE UTENTI_IDENTITA_EXT SET DATLASTLOGIN = CURRENT_TIMESTAMP WHERE IDNKEY = ?',
      [linkedIdentity.identityKey],
    );
    await Orm.execute(
      this.options.databaseOptions,
      'UPDATE UTENTI SET DATLASTLOGIN = CURRENT_TIMESTAMP WHERE CODUTE = ?',
      [linkedIdentity.codiceUtente],
    );

    const login = await this.authService.getLoginResultForUser(linkedIdentity.codiceUtente);
    return {
      codiceUtente: linkedIdentity.codiceUtente,
      login,
      token: this.authService.createAccessiToken(login.utente, ['federated']),
    };
  }

  /** Links an external identity to an existing Accessi user. It never changes that user's password policy. */
  async linkIdentity(codiceUtente: number, identity: VerifiedFederatedIdentity, note?: string): Promise<FederatedIdentity> {
    this.assertEnabled();
    await this.assertUserExists(codiceUtente);
    const normalized = this.normalizeIdentity(identity);
    await this.assertProviderActive(normalized.provider);
    const existing = await this.findIdentity(normalized, false);

    if (existing && existing.codiceUtente !== codiceUtente) {
      throw new ConflictException({ code: 'FEDERATED_IDENTITY_ALREADY_LINKED', message: 'Identita esterna gia associata a un altro utente.' });
    }

    if (existing) {
      await Orm.execute(
        this.options.databaseOptions,
        'UPDATE UTENTI_IDENTITA_EXT SET FLGATTIVO = 1, DATDISATT = NULL, NOTA = ? WHERE IDNKEY = ?',
        [note ?? existing.note ?? null, existing.identityKey],
      );
    } else {
      await Orm.execute(
        this.options.databaseOptions,
        `INSERT INTO UTENTI_IDENTITA_EXT (IDNKEY, CODUTE, PROVIDER, SUBJECT, FLGATTIVO, NOTA)
         VALUES (?, ?, ?, ?, 1, ?)`,
        [this.getIdentityKey(normalized), codiceUtente, normalized.provider, normalized.subject, note ?? null],
      );
    }

    return (await this.findIdentity(normalized, false))!;
  }

  /** Creates a confirmed Accessi user, associates an SSO identity and defaults the new user to SSO-only. */
  async createManagedFederatedUser(
    registrationData: RegisterRequest,
    identity: VerifiedFederatedIdentity,
    passwordLoginEnabled = false,
    note?: string,
  ): Promise<FederatedIdentity> {
    this.assertEnabled();
    const normalizedIdentity = this.normalizeIdentity(identity);
    await this.assertProviderActive(normalizedIdentity.provider);
    if (await this.findIdentity(normalizedIdentity, false)) {
      throw new ConflictException({ code: 'FEDERATED_IDENTITY_ALREADY_LINKED', message: 'Identità esterna già associata a un utente Accessi.' });
    }

    try {
      const codiceUtente = await this.userService.register(registrationData, {
        allowPrivilegedFields: true,
        initialState: StatoRegistrazione.CONF,
      });
      await this.setPasswordLoginEnabled(codiceUtente, passwordLoginEnabled);
      return await this.linkIdentity(codiceUtente, normalizedIdentity, note);
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof ConflictException || error instanceof ForbiddenException || error instanceof NotFoundException || error instanceof ServiceUnavailableException) {
        throw error;
      }
      if (RestUtilities.isDatabaseSchemaError(error)) {
        throw new ServiceUnavailableException({ code: 'ACCESSI_DATABASE_SCHEMA_OUTDATED', message: 'Lo schema del database Accessi non è aggiornato. Eseguire la migrazione database e riprovare.' });
      }
      throw new InternalServerErrorException({ code: 'FEDERATED_USER_PROVISIONING_FAILED', message: 'La creazione dell’utente SSO non è stata completata. Verificare il log del backend e l’eventuale utente creato senza identità SSO.' });
    }
  }

  /**
   * Allows self-provisioning only when explicitly enabled. The caller must have
   * verified the external identity and decide which profile fields are trusted.
   */
  async registerSelfServiceFederatedUser(
    registrationData: RegisterRequest,
    identity: VerifiedFederatedIdentity,
  ): Promise<FederatedIdentity> {
    this.assertEnabled();
    if (this.options.federatedAuthentication?.allowSelfRegistration !== true) {
      throw new ForbiddenException({ code: 'FEDERATED_SELF_REGISTRATION_DISABLED', message: 'Auto-registrazione SSO non abilitata.' });
    }

    const codiceUtente = await this.userService.register(registrationData, {
      allowPrivilegedFields: false,
      initialState: StatoRegistrazione.CONF,
    });
    await this.setPasswordLoginEnabled(codiceUtente, false);
    return this.linkIdentity(codiceUtente, identity);
  }

  /** Returns all linked identities for administration; disabled identities are included. */
  async getUserIdentities(codiceUtente: number): Promise<FederatedIdentity[]> {
    this.assertEnabled();
    const rows = await Orm.query(
      this.options.databaseOptions,
      `SELECT I.IDNKEY AS identity_key, I.CODUTE AS codice_utente, I.PROVIDER, I.SUBJECT,
              I.FLGATTIVO AS active, I.DATINS AS created_at, I.DATLASTLOGIN AS last_login_at,
              I.DATDISATT AS disabled_at, I.NOTA,
              COALESCE(C.FLGPASSWORD, 1) AS password_login_enabled
       FROM UTENTI_IDENTITA_EXT I
       LEFT JOIN UTENTI_CONFIG C ON C.CODUTE = I.CODUTE
       WHERE I.CODUTE = ?
       ORDER BY I.DATINS DESC`,
      [codiceUtente],
    );
    return rows.map(RestUtilities.convertKeysToCamelCase).map((row: IdentityRow) => this.toIdentity(row));
  }

  /** Returns the complete provider catalog, including inactive providers, for superuser administration. */
  async getProviders(): Promise<FederatedProvider[]> {
    this.assertEnabled();
    const rows = await Orm.query(
      this.options.databaseOptions,
      `SELECT PROVIDER AS provider, DESCRIZIONE AS description, FLGATTIVO AS active,
              DATINS AS created_at, NOTA AS note
       FROM SSO_PROVIDER
       ORDER BY FLGATTIVO DESC, DESCRIZIONE, PROVIDER`,
    );
    return rows.map(RestUtilities.convertKeysToCamelCase).map((row: ProviderRow) => this.toProvider(row));
  }

  /** Registers a provider key that must match the backend's SSO configuration exactly. */
  async createProvider(input: { provider: string; description: string; note?: string }): Promise<FederatedProvider> {
    this.assertEnabled();
    const provider = this.normalizeProvider(input.provider);
    const description = this.normalizeDescription(input.description);
    const existing = await this.findProvider(provider);
    if (existing) {
      throw new ConflictException({ code: 'FEDERATED_PROVIDER_ALREADY_EXISTS', message: 'Il provider SSO è già registrato.' });
    }
    await Orm.execute(
      this.options.databaseOptions,
      'INSERT INTO SSO_PROVIDER (PROVIDER, DESCRIZIONE, FLGATTIVO, NOTA) VALUES (?, ?, 1, ?)',
      [provider, description, input.note?.trim() || null],
    );
    return (await this.findProvider(provider))!;
  }

  /** Updates provider metadata or disables the provider without removing its identity history. */
  /**
   * Aggiorna metadati amministrativi del catalogo. La chiave provider e immutabile perche parte dell'identita
   * persistita e deve coincidere esattamente con la configurazione del backend validante.
   */
  async updateProvider(providerValue: string, update: { description?: string; active?: boolean; note?: string }): Promise<FederatedProvider> {
    this.assertEnabled();
    const provider = this.normalizeProvider(providerValue);
    if (!(await this.findProvider(provider))) {
      throw new NotFoundException({ code: 'FEDERATED_PROVIDER_NOT_FOUND', message: 'Provider SSO non registrato.' });
    }
    const changes: string[] = [];
    const params: unknown[] = [];
    if (update.description !== undefined) {
      changes.push('DESCRIZIONE = ?');
      params.push(this.normalizeDescription(update.description));
    }
    if (update.active !== undefined) {
      changes.push('FLGATTIVO = ?');
      params.push(update.active ? 1 : 0);
    }
    if (update.note !== undefined) {
      changes.push('NOTA = ?');
      params.push(update.note.trim() || null);
    }
    if (changes.length > 0) {
      params.push(provider);
      await Orm.execute(this.options.databaseOptions, `UPDATE SSO_PROVIDER SET ${changes.join(', ')} WHERE PROVIDER = ?`, params);
    }
    return (await this.findProvider(provider))!;
  }

  /** Enables or disables all local password authentication for one user. */
  /**
   * Imposta la policy di login locale. `false` non rimuove password ne identita SSO: blocca solo il percorso
   * email/password, che restituisce `PASSWORD_LOGIN_DISABLED`. L'assenza della riga mantiene il default legacy `true`.
   */
  async setPasswordLoginEnabled(codiceUtente: number, enabled: boolean): Promise<void> {
    this.assertEnabled();
    await this.assertUserExists(codiceUtente);
    await Orm.execute(
      this.options.databaseOptions,
      'UPDATE UTENTI_CONFIG SET FLGPASSWORD = ? WHERE CODUTE = ?',
      [enabled ? 1 : 0, codiceUtente],
    );
  }

  /** Returns the effective local password policy. Users without a policy row retain the historic enabled default. */
  /** Restituisce la policy effettiva; utenti precedenti alla migrazione restano abilitati alla password. */
  async isPasswordLoginEnabled(codiceUtente: number): Promise<boolean> {
    if (!this.isEnabled()) return true;
    const rows = await Orm.query(
      this.options.databaseOptions,
      'SELECT COALESCE(FLGPASSWORD, 1) AS password_login_enabled FROM UTENTI_CONFIG WHERE CODUTE = ?',
      [codiceUtente],
    );
    const row = rows.map(RestUtilities.convertKeysToCamelCase)[0] as IdentityRow | undefined;
    return row?.passwordLoginEnabled !== false && row?.passwordLoginEnabled !== 0 && row?.passwordLoginEnabled !== '0';
  }

  /** Soft-disables a linked identity without deleting operational history. */
  /** Disabilita logicamente un collegamento SSO conservando audit e possibilita di successiva riattivazione. */
  async disableIdentity(identityKey: string): Promise<void> {
    this.assertEnabled();
    this.assertIdentityKey(identityKey);
    await Orm.execute(
      this.options.databaseOptions,
      'UPDATE UTENTI_IDENTITA_EXT SET FLGATTIVO = 0, DATDISATT = CURRENT_TIMESTAMP WHERE IDNKEY = ?',
      [identityKey],
    );
  }

  /** Permanently removes one identity link from its owning user after administrative confirmation. */
  /**
   * Elimina fisicamente un collegamento SSO soltanto dopo aver verificato che appartenga all'utente indicato.
   * Non elimina mai l'utente Accessi, password, ruoli o grant associati.
   */
  async deleteIdentity(codiceUtente: number, identityKey: string): Promise<void> {
    this.assertEnabled();
    this.assertIdentityKey(identityKey);
    const identity = (await this.getUserIdentities(codiceUtente)).find((item) => item.identityKey === identityKey);
    if (!identity) {
      throw new NotFoundException({ code: 'FEDERATED_IDENTITY_NOT_FOUND', message: 'Collegamento SSO non trovato per questo utente.' });
    }
    await Orm.execute(
      this.options.databaseOptions,
      'DELETE FROM UTENTI_IDENTITA_EXT WHERE IDNKEY = ? AND CODUTE = ?',
      [identityKey, codiceUtente],
    );
  }

  /** Aggiorna lo stato o la nota di un collegamento SSO usando la sua chiave tecnica amministrativa. */
  /** Aggiorna stato o nota amministrativa senza modificare provider e subject, che identificano la persona. */
  async updateIdentity(identityKey: string, update: { active?: boolean; note?: string }): Promise<void> {
    this.assertEnabled();
    this.assertIdentityKey(identityKey);
    const changes: string[] = [];
    const params: unknown[] = [];
    if (update.active !== undefined) {
      changes.push('FLGATTIVO = ?');
      params.push(update.active ? 1 : 0);
      if (update.active) changes.push('DATDISATT = NULL');
      else changes.push('DATDISATT = CURRENT_TIMESTAMP');
    }
    if (update.note !== undefined) {
      changes.push('NOTA = ?');
      params.push(update.note);
    }
    if (changes.length === 0) return;
    params.push(identityKey);
    await Orm.execute(this.options.databaseOptions, `UPDATE UTENTI_IDENTITA_EXT SET ${changes.join(', ')} WHERE IDNKEY = ?`, params);
  }

  /** Explicit administrative schema reconciliation, shared with the standard updater. */
  async ensureSchema(): Promise<void> {
    if (this.isEnabled()) await AccessiDatabaseUpdater.run(this.options);
  }

  private async findIdentity(identity: VerifiedFederatedIdentity, onlyActive: boolean): Promise<FederatedIdentity | null> {
    const rows = await Orm.query(
      this.options.databaseOptions,
      `SELECT I.IDNKEY AS identity_key, I.CODUTE AS codice_utente, I.PROVIDER, I.SUBJECT,
              I.FLGATTIVO AS active, I.DATINS AS created_at, I.DATLASTLOGIN AS last_login_at,
              I.DATDISATT AS disabled_at, I.NOTA,
              COALESCE(C.FLGPASSWORD, 1) AS password_login_enabled
       FROM UTENTI_IDENTITA_EXT I
       LEFT JOIN UTENTI_CONFIG C ON C.CODUTE = I.CODUTE
       WHERE I.IDNKEY = ? AND I.PROVIDER = ? AND I.SUBJECT = ?${onlyActive ? ' AND I.FLGATTIVO = 1' : ''}`,
      [this.getIdentityKey(identity), identity.provider, identity.subject],
    );
    const row = rows.map(RestUtilities.convertKeysToCamelCase)[0] as IdentityRow | undefined;
    return row ? this.toIdentity(row) : null;
  }

  private async assertUserExists(codiceUtente: number): Promise<void> {
    const user = await this.userService.getAuthenticatedUserSnapshot(codiceUtente);
    if (!user) throw new NotFoundException('Utente Accessi non trovato.');
  }

  private assertEnabled(): void {
    if (!this.isEnabled()) {
      throw new ForbiddenException({ code: 'FEDERATED_AUTH_DISABLED', message: 'Autenticazione federata non abilitata in AccessiOptions.' });
    }
  }

  /** Validates the opaque SHA-256 key used only by administrative identity endpoints. */
  private assertIdentityKey(identityKey: string): void {
    if (!/^[a-f0-9]{64}$/i.test(identityKey)) {
      throw new BadRequestException({ code: 'FEDERATED_IDENTITY_KEY_INVALID', message: 'Chiave del collegamento SSO non valida.' });
    }
  }

  private normalizeIdentity(identity: VerifiedFederatedIdentity): VerifiedFederatedIdentity {
    const provider = this.normalizeProvider(identity?.provider);
    const subject = typeof identity?.subject === 'string' ? identity.subject.trim() : '';
    if (!subject || Buffer.byteLength(subject, 'utf8') > 512) {
      throw new BadRequestException({ code: 'FEDERATED_SUBJECT_INVALID', message: 'Subject non valido: è obbligatorio e può occupare al massimo 512 byte UTF-8.' });
    }
    return { provider, subject };
  }

  private normalizeProvider(value: unknown): string {
    const provider = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(provider)) {
      throw new BadRequestException({ code: 'FEDERATED_PROVIDER_INVALID', message: 'Provider non valido: usare un namespace ASCII stabile di massimo 64 caratteri.' });
    }
    return provider;
  }

  private normalizeDescription(value: unknown): string {
    const description = typeof value === 'string' ? value.trim() : '';
    if (!description || description.length > 160) {
      throw new BadRequestException({ code: 'FEDERATED_PROVIDER_DESCRIPTION_INVALID', message: 'La descrizione del provider deve contenere da 1 a 160 caratteri.' });
    }
    return description;
  }

  private async assertProviderActive(provider: string): Promise<FederatedProvider> {
    const registered = await this.findProvider(provider);
    if (!registered) {
      throw new NotFoundException({ code: 'FEDERATED_PROVIDER_NOT_FOUND', message: 'Provider SSO non registrato.' });
    }
    if (!registered.active) {
      throw new ForbiddenException({ code: 'FEDERATED_PROVIDER_DISABLED', message: 'Provider SSO disabilitato.' });
    }
    return registered;
  }

  private async findProvider(provider: string): Promise<FederatedProvider | null> {
    const rows = await Orm.query(
      this.options.databaseOptions,
      `SELECT PROVIDER AS provider, DESCRIZIONE AS description, FLGATTIVO AS active,
              DATINS AS created_at, NOTA AS note
       FROM SSO_PROVIDER
       WHERE PROVIDER = ?`,
      [provider],
    );
    const row = rows.map(RestUtilities.convertKeysToCamelCase)[0] as ProviderRow | undefined;
    return row ? this.toProvider(row) : null;
  }

  private getIdentityKey(identity: VerifiedFederatedIdentity): string {
    const provider = Buffer.from(identity.provider, 'utf8');
    const subject = Buffer.from(identity.subject, 'utf8');
    const payload = Buffer.concat([Buffer.from('accessi:federated:v1:'), Buffer.from(`${provider.length}:`), provider, Buffer.from(`${subject.length}:`), subject]);
    return createHash('sha256').update(payload).digest('hex');
  }

  private toIdentity(row: IdentityRow): FederatedIdentity {
    return {
      identityKey: String(row.identityKey),
      codiceUtente: Number(row.codiceUtente),
      provider: String(row.provider).trim(),
      subject: String(row.subject),
      active: row.active === true || row.active === 1 || row.active === '1',
      passwordLoginEnabled: !(row.passwordLoginEnabled === false || row.passwordLoginEnabled === 0 || row.passwordLoginEnabled === '0'),
      createdAt: row.createdAt,
      lastLoginAt: row.lastLoginAt,
      disabledAt: row.disabledAt,
      note: row.note,
    };
  }

  private toProvider(row: ProviderRow): FederatedProvider {
    return {
      provider: String(row.provider).trim(),
      description: String(row.description ?? '').trim(),
      active: row.active === true || row.active === 1 || row.active === '1',
      createdAt: row.createdAt,
      note: row.note,
    };
  }
}
