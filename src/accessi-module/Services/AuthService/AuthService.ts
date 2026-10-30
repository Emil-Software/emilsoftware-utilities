import { Inject, Injectable, ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { randomUUID } from "crypto";
import { TwoFactorService, TwoFactorProof } from '../TwoFactorService/TwoFactorService';
import * as jwt from "jsonwebtoken";
import { Orm } from "../../../Orm";
import { CryptUtilities, PasswordUtilities, RestUtilities } from "../../../Utilities";
import type { AccessiOptions } from "../../AccessiModule";
import { LoginRequest } from "../../Dtos/LoginRequest";
import { LoginResult } from "../../Dtos/LoginResponse";
import { countAccessiMetric, recordAccessiMetric } from "../../observability/metrics";
import { StatoRegistrazione } from "../../Dtos/StatoRegistrazione";
import { UserService } from "../UserService/UserService";
import { FiltriService } from "../FiltriService/FiltriService";
import {
  buildAuthenticatedTokenPayload,
  isAuthenticatedUserEnabledForJwt,
  isAccessiTokenAllowedForUser,
  resolveCodiceUtenteFromTokenPayload,
} from "../../security/authenticatedToken";
import {
  getAccessiJwtSecret,
  verifyPasswordResetToken,
} from "../../security/passwordResetToken";
import {
  isAccessiTokenRevoked,
  revokeAccessiUserSessions,
  revokeAccessiUserSessionsIfConfigured,
} from "../../security/sessionRevocation";
import {
  consumeRefreshToken,
  getRefreshTokenRotationStore,
  isRefreshTokenFamilyRevoked,
  revokeRefreshTokenFamily,
} from "../../security/refreshTokenRotation";
import { auditAccessi } from "../../security/audit";
import {
  getAccessiAccessTokenSigningConfig,
  getAccessiAccessTokenVerificationConfig,
  getAccessiRefreshTokenSigningConfig,
  getAccessiRefreshTokenVerificationConfig,
  verifyAccessiJwt,
} from "../../security/jwtTokenOptions";
import { assertStrongPassword } from '../../security/passwordPolicy';
import { Logger } from "../../../Logger";
import { TokenResult } from '../../Dtos/TokenResult';

/** Error code deliberately returned when a user is configured as SSO-only. */
export const PASSWORD_LOGIN_DISABLED = 'PASSWORD_LOGIN_DISABLED';

/** Esito di una verifica token usata dall'endpoint di introspection. */
export interface AccessiTokenIntrospectionResult {
  active: boolean;
  codiceUtente?: number;
  payload?: Record<string, unknown>;
}

interface AccessiTokenIssueOptions {
  /** Sovrascrive jwtOptions.expiresIn per token a durata ridotta (es. Login as). */
  expiresIn?: string | number;
  /** Claim aggiuntive, per esempio l'attore che ha generato un token di impersonazione. */
  extraClaims?: Record<string, unknown>;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private userService: UserService,
    private filtriService: FiltriService,
    @Inject("ACCESSI_OPTIONS") private readonly accessiOptions: AccessiOptions,
    private readonly twoFactorService: TwoFactorService,
  ) {}

  private async refreshPasswordExpiration(codiceUtente: number): Promise<void> {
    if (!this.accessiOptions.passwordExpiration) {
      return;
    }

    const configuredDays = Number(this.accessiOptions.passwordExpirationDays);
    const expirationDays =
      Number.isFinite(configuredDays) && configuredDays > 0
        ? Math.trunc(configuredDays)
        : 90;

    const query = `UPDATE UTENTI SET DATSCAPWD = DATEADD(${expirationDays} DAY TO CURRENT_TIMESTAMP) WHERE CODUTE = ?`;
    await Orm.execute(this.accessiOptions.databaseOptions, query, [codiceUtente]);
  }

  private isMockDemoUserEnabled(): boolean {
    if (!this.accessiOptions.mockDemoUser) {
      return false;
    }

    // La backdoor mock non e mai attiva in produzione, nemmeno con variabili d'ambiente,
    // perche emette un superutente senza verifica password.
    const nodeEnv = (process.env.NODE_ENV ?? "production").toLowerCase();
    return nodeEnv !== "production";
  }

  private createToken(
    utente: LoginResult['utente'],
    methods: string[],
    type: 'access' | 'refresh',
    tokenOptions: AccessiTokenIssueOptions = {},
  ): TokenResult {
    if (!utente?.codiceUtente) {
      throw new Error('Impossibile creare un token senza un utente Accessi valido.');
    }
    const loginAs = methods.includes('login_as');
    if ((utente.flagDueFattori === true || Number(utente.flagDueFattori) === 1) && !methods.includes('otp') && !loginAs) {
      throw new UnauthorizedException('Verifica del codice di accesso richiesta.');
    }

    const expiresIn = tokenOptions.expiresIn ?? this.accessiOptions.jwtOptions.expiresIn;
    const expiresInIsValid = typeof expiresIn === 'number'
      ? Number.isFinite(expiresIn) && expiresIn > 0
      : typeof expiresIn === 'string' && expiresIn.trim() !== '';
    if (!expiresInIsValid) {
      throw new Error('Durata token non configurata: impossibile emettere token senza scadenza.');
    }

    const signing = type === 'refresh'
      ? getAccessiRefreshTokenSigningConfig(this.accessiOptions)
      : getAccessiAccessTokenSigningConfig(this.accessiOptions);
    const token = jwt.sign(
      {
        ...(tokenOptions.extraClaims ?? {}),
        utente,
        typ: type,
        amr: methods,
        jti: randomUUID(),
        // Millisecondi: rende deterministica la revoca sessioni anche quando
        // il token e emesso nello stesso secondo del cambio password.
        iatMs: Date.now(),
      },
      signing.key,
      {
        expiresIn: expiresIn as jwt.SignOptions['expiresIn'],
        algorithm: signing.algorithm,
        ...signing.signOptions,
      },
    );

    // Difesa in profondita: un `expiresIn` malformato farebbe emettere un token permanente.
    const decoded = jwt.decode(token);
    const decodedPayload = decoded && typeof decoded === 'object' ? decoded as jwt.JwtPayload : undefined;
    if (typeof decodedPayload?.exp !== 'number') {
      throw new Error('Token emesso senza scadenza: configurazione JWT non valida.');
    }

    // Il contratto TokenResult espone sempre la validita in secondi, anche quando
    // jwtOptions.expiresIn usa un formato leggibile come '24h'.
    const issuedAt = typeof decodedPayload.iat === 'number' ? decodedPayload.iat : Math.floor(Date.now() / 1000);
    const expiresInSeconds = Math.max(0, Math.trunc(decodedPayload.exp - issuedAt));

    return {
      expiresIn: String(expiresInSeconds),
      value: token,
      type: 'Bearer',
    };
  }

  /** Creates the normal internal JWT consumed by all existing Accessi guards. */
  public createAccessiToken(
    utente: LoginResult['utente'],
    methods: string[] = [],
    tokenOptions: AccessiTokenIssueOptions = {},
  ): TokenResult {
    return this.createToken(utente, methods, 'access', tokenOptions);
  }

  /** Emette il refresh token quando `jwtOptions.refreshExpiresIn` e configurato. */
  public createRefreshToken(
    utente: LoginResult['utente'],
    methods: string[] = [],
    tokenOptions: AccessiTokenIssueOptions = {},
  ): TokenResult | undefined {
    const expiresIn = this.accessiOptions.jwtOptions.refreshExpiresIn;
    if (!expiresIn) return undefined;
    return this.createToken(utente, methods, 'refresh', {
      ...tokenOptions,
      expiresIn,
    });
  }

  /** Crea la coppia access + refresh token usata da login, 2FA e SSO. */
  public createTokenPair(
    utente: LoginResult['utente'],
    methods: string[] = [],
    options?: { familyId?: string },
  ): { access: TokenResult; refresh?: TokenResult } {
    // La famiglia identifica il login: access e refresh condividono lo stesso
    // `fid`, cosi la revoca per riuso sospetto invalida entrambi.
    const familyId = options?.familyId ?? randomUUID();
    const access = this.createAccessiToken(utente, methods, { extraClaims: { fid: familyId } });
    const refresh = this.createRefreshToken(utente, methods, { extraClaims: { fid: familyId } });
    return { access, ...(refresh ? { refresh } : {}) };
  }

  /**
   * Emette l'access token per l'utente target, con l'attore registrato nelle
   * claim `act` e `loginAs`. La durata e' quella standard di jwtOptions.expiresIn.
   */
  public createLoginAsToken(
    utente: LoginResult['utente'],
    actor: { codiceUtente: number; email?: string },
  ): TokenResult {
    return this.createAccessiToken(utente, ['login_as'], {
      extraClaims: {
        loginAs: true,
        act: {
          sub: String(actor.codiceUtente),
          email: actor.email,
        },
      },
    });
  }

  /** Builds the standard login response for a user authenticated by a supported method. */
  public async getLoginResultForUser(codiceUtente: number, scope?: string): Promise<LoginResult> {
    const users = await this.userService.getUsers(
      { codiceUtente },
      { includeExtensionFields: true, includeGrants: true, ...(scope ? { scope } : {}) },
    );
    const result = users[0];
    if (!result?.utente) {
      throw new Error('Utente Accessi non trovato.');
    }
    const current = await this.userService.getAuthenticatedUserSnapshot(codiceUtente);
    if (!isAuthenticatedUserEnabledForJwt(current)) throw new UnauthorizedException('Utente non abilitato.');
    result.utente = { ...result.utente, ...current };

    return {
      utente: result.utente,
      filtri: await this.filtriService.getFiltriUser(codiceUtente),
      userGrants: result.userGrants,
      extensionFields: result.extensionFields,
    };
  }

  /** Users without a row retain the historic password-login enabled default. */
  private async isPasswordLoginEnabled(codiceUtente: number): Promise<boolean> {
    if (this.accessiOptions.federatedAuthentication?.enabled !== true) return true;

    const rows = await Orm.query(
      this.accessiOptions.databaseOptions,
      'SELECT COALESCE(FLGPASSWORD, 1) AS password_login_enabled FROM UTENTI_CONFIG WHERE CODUTE = ?',
      [codiceUtente],
    );
    const policy = rows.map(RestUtilities.convertKeysToCamelCase)[0] as { passwordLoginEnabled?: unknown } | undefined;
    return policy?.passwordLoginEnabled !== false && policy?.passwordLoginEnabled !== 0 && policy?.passwordLoginEnabled !== '0';
  }

  /**
   * Autentica con credenziali locali e restituisce profilo, filtri e grant effettivi.
   * Non crea il JWT: il controller o il flusso SSO deve chiamare `createAccessiToken` sul risultato.
   * Per utenti SSO-only genera `PASSWORD_LOGIN_DISABLED`, da trattare come istruzione a usare l'SSO.
   */
  async login(request: LoginRequest): Promise<LoginResult> {
    const mockDemoUserEnabled = this.isMockDemoUserEnabled();

    if (
      mockDemoUserEnabled &&
      request.email.toLowerCase() === "demo"
    ) {
      return this.getDemoUser();
    }

    if (
      mockDemoUserEnabled &&
      request.email.toLowerCase() === "admin"
    ) {
      return this.getAdminUser();
    }

    const utente = await this.userService.getUserByEmail(
      request.email.trim().toLowerCase()
    );
    if (!utente) {
      if (!request.password) return { passwordRequired: true };
      throw new Error("Nome utente o password errata!");
    }

    const currentUser = await this.userService.getAuthenticatedUserSnapshot(utente.codiceUtente);
    if (isAuthenticatedUserEnabledForJwt(currentUser) && currentUser.flagDueFattori && currentUser.passwordlessLoginEnabled) {
      return { challenge: await this.twoFactorService.issue({ codiceUtente: utente.codiceUtente, email: (currentUser.email ?? '').trim(), mode: 'passwordless' }) };
    }
    // The email-only step has the same response for unknown and ordinary local accounts.
    if (!request.password) return { passwordRequired: true };

    switch (utente.statoRegistrazione) {
      case undefined:
        throw new Error(
          "Struttura dati compromessa: Stato Registrazione inesistente."
        );
      case StatoRegistrazione.BLOCC:
      case StatoRegistrazione.DELETE:
        throw new Error("Utente non abilitato");
      case StatoRegistrazione.INVIO:
        throw new Error("Rinnovo password necessario.");
    }

    if (utente.statoRegistrazione !== StatoRegistrazione.CONF) {
      throw new Error(
        `Errore generico. Stato di registrazione non valido: ${utente.statoRegistrazione}.`
      );
    }

    if (!isAuthenticatedUserEnabledForJwt(currentUser)) throw new Error('Utente non abilitato');
    if (!(await this.isPasswordLoginEnabled(utente.codiceUtente))) {
      throw new Error(PASSWORD_LOGIN_DISABLED);
    }

    if (typeof request.password !== 'string' || request.password.length === 0) {
      throw new Error('Nome utente o password errata!');
    }

    const isPasswordValid = await this.verifyPassword(
      utente.codiceUtente,
      request.password
    );
    if (!isPasswordValid) throw new Error("Nome utente o password errata!");

    if (
      this.accessiOptions.passwordExpiration &&
      this.accessiOptions.passwordExpiration == true
    ) {
      const today = new Date();
      const targetDate = utente.dataScadenzaPassword
        ? new Date(utente.dataScadenzaPassword)
        : undefined;

      // Legacy users may not have an expiration date. Preserve the former non-expiring behaviour for them.
      if (targetDate && !Number.isNaN(targetDate.getTime()) && today >= targetDate) {
        throw new Error("PASSWORD_EXPIRED");
      }
    }

    if (currentUser.flagDueFattori) {
      return { challenge: await this.twoFactorService.issue({ codiceUtente: utente.codiceUtente, email: currentUser.email ?? '', mode: 'password' }) };
    }

    const updateLastAccessDateQuery =
      "UPDATE UTENTI SET DATLASTLOGIN = CURRENT_TIMESTAMP WHERE CODUTE = ?";
    await Orm.query(
      this.accessiOptions.databaseOptions,
      updateLastAccessDateQuery,
      [utente.codiceUtente]
    );

    return this.getLoginResultForUser(utente.codiceUtente, request.scope);
  }

  /**
   * Verifica un access token Accessi senza sollevare eccezioni per token invalidi.
   *
   * Gli errori di configurazione o database continuano a propagarsi: un problema
   * infrastrutturale non deve essere confuso con un token scaduto.
   */
  public async introspectAccessToken(token: string): Promise<AccessiTokenIntrospectionResult> {
    if (typeof token !== "string" || token.trim() === "") {
      return { active: false };
    }

    const verification = getAccessiAccessTokenVerificationConfig(this.accessiOptions);
    let decoded: unknown;
    try {
      decoded = verifyAccessiJwt(token.trim(), verification);
    } catch {
      return { active: false };
    }

    const codiceUtente = resolveCodiceUtenteFromTokenPayload(decoded);
    if (!codiceUtente) {
      return { active: false };
    }
    if (await isAccessiTokenRevoked(this.accessiOptions, decoded as Record<string, unknown>, codiceUtente)) {
      return { active: false };
    }

    const currentUser = await this.userService.getAuthenticatedUserSnapshot(codiceUtente);
    if (
      !currentUser ||
      !isAuthenticatedUserEnabledForJwt(currentUser) ||
      !isAccessiTokenAllowedForUser(decoded, currentUser)
    ) {
      return { active: false };
    }

    return {
      active: true,
      codiceUtente,
      payload: buildAuthenticatedTokenPayload(decoded, currentUser),
    };
  }

  /**
   * Verifica un JWT Accessi e ricostruisce il profilo corrente dal database.
   * Questo evita che privilegi, stato utente o flag amministrativi presenti in un token vecchio restino validi.
   */
  public async getAuthenticatedTokenPayload(token: string): Promise<Record<string, unknown>> {
    if (typeof token !== "string" || token.trim() === "") {
      throw new Error("Token non fornito.");
    }

    const introspection = await this.introspectAccessToken(token);
    if (!introspection.active || !introspection.payload) {
      throw new Error("Token non valido o utente non autorizzato.");
    }

    return introspection.payload;
  }

  /**
   * Scambia un refresh token valido con una nuova coppia access + refresh.
   *
   * Il refresh token non e accettato dai guard API: ha `typ: "refresh"`.
   */
  public async refreshAccessToken(refreshToken: string): Promise<LoginResult> {
    if (!this.accessiOptions.jwtOptions.refreshExpiresIn) {
      throw new UnauthorizedException('Refresh token non abilitato.');
    }
    if (typeof refreshToken !== 'string' || refreshToken.trim() === '') {
      throw new UnauthorizedException('Refresh token mancante.');
    }

    const verification = getAccessiRefreshTokenVerificationConfig(this.accessiOptions);
    let decoded: unknown;
    try {
      decoded = verifyAccessiJwt(refreshToken.trim(), verification);
    } catch {
      throw new UnauthorizedException('Refresh token non valido o scaduto.');
    }

    const codiceUtente = resolveCodiceUtenteFromTokenPayload(decoded, 'refresh');
    if (!codiceUtente) {
      throw new UnauthorizedException('Refresh token privo di un utente valido.');
    }

    const decodedRecord = decoded as { jti?: unknown; fid?: unknown; exp?: unknown };
    const familyId = typeof decodedRecord.fid === 'string' && decodedRecord.fid.trim() !== ''
      ? decodedRecord.fid
      : undefined;
    const jti = typeof decodedRecord.jti === 'string' ? decodedRecord.jti : undefined;
    const expiresAt = Number(decodedRecord.exp);

    // La famiglia va controllata per prima: un token appena emesso da uno store
    // compromesso deve produrre un codice stabile, non il generico 401 utente.
    if (await isRefreshTokenFamilyRevoked(this.accessiOptions, familyId)) {
      throw new UnauthorizedException({
        code: 'ACCESSI_REFRESH_FAMILY_REVOKED',
        message: 'Sessione revocata per riuso sospetto del refresh token.',
      });
    }

    if (await isAccessiTokenRevoked(this.accessiOptions, decoded as Record<string, unknown>, codiceUtente)) {
      throw new UnauthorizedException('Sessione revocata.');
    }

    const currentUser = await this.userService.getAuthenticatedUserSnapshot(codiceUtente);
    if (!isAuthenticatedUserEnabledForJwt(currentUser) || !isAccessiTokenAllowedForUser(decoded, currentUser)) {
      throw new UnauthorizedException('Utente non piu autorizzato.');
    }

    const rotationStore = getRefreshTokenRotationStore(this.accessiOptions);
    if (rotationStore) {
      if (!jti || !Number.isFinite(expiresAt)) {
        throw new UnauthorizedException('Refresh token privo di jti o scadenza.');
      }
      let outcome;
      try {
        outcome = await consumeRefreshToken(this.accessiOptions, jti, expiresAt * 1000);
      } catch {
        throw new ServiceUnavailableException({
          code: 'ACCESSI_REFRESH_ROTATION_UNAVAILABLE',
          message: 'Rotazione refresh token non disponibile. Riprova piu tardi.',
        });
      }
      if (outcome && !outcome.consumed) {
        await this.handleRefreshTokenReuse({
          codiceUtente,
          jti,
          familyId,
          consumedAtMs: outcome.consumedAtMs,
          expiresAtMs: expiresAt * 1000,
        });
        throw new UnauthorizedException({
          code: 'ACCESSI_REFRESH_TOKEN_REUSE',
          message: 'Refresh token gia utilizzato.',
        });
      }
    }

    const login = await this.getLoginResultForUser(codiceUtente);
    const methods = Array.isArray((decoded as { amr?: unknown }).amr)
      ? ((decoded as { amr: unknown[] }).amr.filter((method): method is string => typeof method === 'string'))
      : [];
    const pair = this.createTokenPair(login.utente, methods, { familyId });
    login.token = pair.access;
    if (pair.refresh) login.refreshToken = pair.refresh;
    return login;
  }

  /**
   * Gestisce il riuso di un refresh token gia consumato.
   *
   * Il riuso entro `reuseGraceMs` e trattato come retry concorrente del client e
   * non revoca nulla. Oltre la finestra e considerato un possibile furto: viene
   * revocata l'intera famiglia (stesso login) e, solo se esplicitamente
   * configurato, anche le altre sessioni dell'utente.
   */
  private async handleRefreshTokenReuse(params: {
    codiceUtente: number;
    jti: string;
    familyId?: string;
    consumedAtMs?: number;
    expiresAtMs: number;
  }): Promise<void> {
    const configuredGrace = Number(this.accessiOptions.refreshTokenRotation?.reuseGraceMs ?? 10_000);
    const graceMs = Number.isFinite(configuredGrace) ? Math.max(0, configuredGrace) : 10_000;
    const consumedAtMs = params.consumedAtMs;
    if (
      graceMs > 0
      && consumedAtMs !== undefined
      && Number.isFinite(consumedAtMs)
      && Date.now() - consumedAtMs <= graceMs
    ) {
      return;
    }

    auditAccessi('accessi_refresh_token_reuse', {
      codiceUtente: params.codiceUtente,
      jti: params.jti,
      familyId: params.familyId,
      consumedAtMs,
    });
    countAccessiMetric(this.accessiOptions, 'refresh_reuse_total', {
      user_sessions_revoked: this.accessiOptions.refreshTokenRotation?.revokeUserSessionsOnReuse === true,
    });

    try {
      if (params.familyId) {
        await revokeRefreshTokenFamily(
          this.accessiOptions,
          params.familyId,
          params.expiresAtMs,
        );
        countAccessiMetric(this.accessiOptions, 'refresh_family_revoked_total', { reason: 'reuse' });
      }
      if (this.accessiOptions.refreshTokenRotation?.revokeUserSessionsOnReuse === true) {
        await revokeAccessiUserSessions(this.accessiOptions, params.codiceUtente, Date.now(), 'refresh_token_reuse');
      }
    } catch (error) {
      recordAccessiMetric('accessi_store_errors_total', 1, { store: 'refresh_token_rotation' });
      // La revoca e best effort: il token presentato resta comunque rifiutato.
      this.logger.error(
        `Revoca famiglia refresh token fallita: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** Starts a second-factor challenge after the hosting backend has verified an SSO identity. */
  public async beginFederatedTwoFactor(codiceUtente: number, identityKey: string): Promise<LoginResult> {
    const user = await this.userService.getAuthenticatedUserSnapshot(codiceUtente);
    if (!isAuthenticatedUserEnabledForJwt(user) || !user.flagDueFattori) throw new UnauthorizedException();
    return { challenge: await this.twoFactorService.issue({ codiceUtente, email: user.email ?? '', mode: 'federated', identityKey }) };
  }

  private async validateTwoFactorProof(proof: TwoFactorProof): Promise<void> {
    const user = await this.userService.getAuthenticatedUserSnapshot(proof.codiceUtente);
    if (!isAuthenticatedUserEnabledForJwt(user) || !user.flagDueFattori || user.email?.trim().toLowerCase() !== proof.email.trim().toLowerCase()) {
      throw new UnauthorizedException('Profilo modificato o utente non abilitato. Ripeti l accesso.');
    }
    if (proof.mode === 'passwordless' && !user.passwordlessLoginEnabled) throw new UnauthorizedException('Accesso senza password disabilitato.');
    if (proof.mode === 'password' && !(await this.isPasswordLoginEnabled(proof.codiceUtente))) throw new UnauthorizedException('Login locale disabilitato.');
    if (proof.mode === 'federated') {
      if (!this.accessiOptions.federatedAuthentication?.enabled) throw new UnauthorizedException();
      const rows = await Orm.query(this.accessiOptions.databaseOptions,
        'SELECT I.IDNKEY FROM UTENTI_IDENTITA_EXT I INNER JOIN SSO_PROVIDER P ON P.PROVIDER = I.PROVIDER WHERE I.IDNKEY = ? AND I.CODUTE = ? AND I.FLGATTIVO = 1 AND P.FLGATTIVO = 1',
        [proof.identityKey, proof.codiceUtente], false);
      if (!rows.length) throw new UnauthorizedException('Identita SSO non piu abilitata.');
    }
  }

  public async verifyTwoFactor(challengeId: string, code: string, scope?: string): Promise<LoginResult> {
    const proof = await this.twoFactorService.consume(challengeId, code);
    await this.validateTwoFactorProof(proof);
    const result = await this.getLoginResultForUser(proof.codiceUtente, scope);
    const tokens = this.createTokenPair(result.utente, [proof.mode, 'otp']);
    result.token = tokens.access;
    if (tokens.refresh) result.refreshToken = tokens.refresh;
    await Orm.execute(this.accessiOptions.databaseOptions, 'UPDATE UTENTI SET DATLASTLOGIN = CURRENT_TIMESTAMP WHERE CODUTE = ?', [proof.codiceUtente]);
    if (proof.mode === 'federated') {
      await Orm.execute(this.accessiOptions.databaseOptions, 'UPDATE UTENTI_IDENTITA_EXT SET DATLASTLOGIN = CURRENT_TIMESTAMP WHERE IDNKEY = ?', [proof.identityKey]);
    }
    return result;
  }

  public async resendTwoFactor(challengeId: string): Promise<LoginResult> {
    await this.validateTwoFactorProof(await this.twoFactorService.describe(challengeId));
    return { challenge: await this.twoFactorService.resend(challengeId) };
  }

  /**
   * Persiste una password hashata e aggiorna la scadenza, se la policy password e attiva. Non invia email.
   * Con `enforcePolicy` (default true) valida la password secondo la policy moderna; i flussi di
   * migrazione delle password legacy passano `enforcePolicy: false` per non bloccare password storiche.
   * Con `revokeSessions` (default true) invalida le sessioni precedenti: un cambio password deve
   * interrompere i token gia emessi.
   */
  public async setPassword(
    codiceUtente: number,
    nuovaPassword: string,
    options?: { enforcePolicy?: boolean; revokeSessions?: boolean },
  ) {
    if (options?.enforcePolicy !== false) {
      assertStrongPassword(nuovaPassword);
    }
    try {
      const query = `UPDATE OR INSERT INTO UTENTI_PWD (CODUTE, PWD) VALUES (?, ?)`;
      const hashedPassword = PasswordUtilities.hashPassword(nuovaPassword);

      const result = await Orm.execute(this.accessiOptions.databaseOptions, query, [
        codiceUtente,
        hashedPassword,
      ]);
      await this.refreshPasswordExpiration(codiceUtente);
      if (options?.revokeSessions !== false) {
        await this.revokeSessionsAfterSecurityChange(codiceUtente, 'password_change');
      }
      return result;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Revoca le sessioni dopo un evento che deve invalidare i token esistenti.
   * Best effort: un errore dello store non deve annullare l'operazione gia
   * persistita (cambio password, blocco, cancellazione).
   */
  private async revokeSessionsAfterSecurityChange(codiceUtente: number, reason: string): Promise<void> {
    try {
      await revokeAccessiUserSessionsIfConfigured(this.accessiOptions, codiceUtente, reason);
    } catch (error) {
      this.logger.error(
        `Revoca sessioni fallita per l'utente ${codiceUtente} (${reason}): ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Converte le password legacy cifrate nel formato hash compatibile, senza conoscere le password in chiaro.
   * E idempotente: hash moderni e gia migrati vengono ignorati.
   */
  public async migrateLegacyEncryptedPasswords(): Promise<void> {
    const startedAt = performance.now();
    this.logger.info("Avvio migrazione password legacy accessi.");
    const results = await Orm.query(
      this.accessiOptions.databaseOptions,
      "SELECT CODUTE AS codice_utente, PWD AS password FROM UTENTI_PWD WHERE PWD IS NOT NULL",
      []
    );

    const rows = results.map(RestUtilities.convertKeysToCamelCase) as {
      codiceUtente?: number;
      password?: string;
    }[];
    let migratedCount = 0;
    let skippedCount = 0;

    for (const row of rows) {
      const codiceUtente = Number(row.codiceUtente);
      const storedPassword = typeof row.password === "string" ? row.password : null;

      if (
        !codiceUtente ||
        !storedPassword ||
        PasswordUtilities.isPasswordHash(storedPassword) ||
        PasswordUtilities.isLegacyPasswordHash(storedPassword)
      ) {
        skippedCount += 1;
        continue;
      }

      const protectedLegacyPassword =
        PasswordUtilities.hashLegacyEncryptedPassword(storedPassword);

      await Orm.execute(
        this.accessiOptions.databaseOptions,
        "UPDATE UTENTI_PWD SET PWD = ? WHERE CODUTE = ? AND PWD = ?",
        [protectedLegacyPassword, codiceUtente, storedPassword]
      );
      migratedCount += 1;
    }

    this.logger.info(
      `Migrazione password legacy accessi completata. Letti=${rows.length}, migrati=${migratedCount}, ignorati=${skippedCount}, durataMs=${(performance.now() - startedAt).toFixed(2)}`
    );
  }

  /** Verifica una password locale e migra automaticamente il formato legacy dopo una verifica positiva. */
  async verifyPassword(
    codiceUtente: number,
    plainPassword: string
  ): Promise<boolean> {
    const query = `SELECT PWD AS password FROM UTENTI_PWD WHERE CODUTE = ?`;
    const result = (await Orm.query(
      this.accessiOptions.databaseOptions,
      query,
      [codiceUtente]
    ).then((results) => results.map(RestUtilities.convertKeysToCamelCase))) as {
      password: string;
    }[];

    const stored = result[0];
    if (!stored || typeof stored.password !== "string") {
      return false;
    }

    const storedPassword = stored.password;

    if (PasswordUtilities.isPasswordHash(storedPassword)) {
      return PasswordUtilities.verifyPassword(plainPassword, storedPassword);
    }

    const legacyEncryptedPassword = CryptUtilities.encrypt(
      plainPassword,
      this.accessiOptions.encryptionKey
    );

    if (PasswordUtilities.isLegacyPasswordHash(storedPassword)) {
      const isMigratedLegacyPasswordValid =
        PasswordUtilities.verifyLegacyEncryptedPassword(
          legacyEncryptedPassword,
          storedPassword
        );

      if (isMigratedLegacyPasswordValid) {
        await this.setPassword(codiceUtente, plainPassword, {
          enforcePolicy: false,
          revokeSessions: false,
        });
      }

      return isMigratedLegacyPasswordValid;
    }

    const isLegacyPasswordValid = PasswordUtilities.timingSafeStringEquals(
      storedPassword,
      legacyEncryptedPassword,
    );

    if (isLegacyPasswordValid) {
      await this.setPassword(codiceUtente, plainPassword, {
        enforcePolicy: false,
        revokeSessions: false,
      });
    }

    return isLegacyPasswordValid;
  }

  /** Restituisce l'utente fittizio amministratore; usabile solo con `mockDemoUser` esplicitamente abilitato. */
  async getAdminUser(): Promise<LoginResult> {
    return {
      utente: {
        codiceUtente: 6789,
        email: "admin",
        statoRegistrazione: StatoRegistrazione.CONF,
        cognome: "Admin",
        nome: "Admin",
        flagGdpr: true,
        avatar: "/path/to/avatar.jpg",
        flagDueFattori: false,
        codiceLingua: "IT",
        cellulare: "+391234567890",
        flagSuper: true,
        roles: [],
        permissions: [],
      },
      filtri: null,
      userGrants: {
        abilitazioni: [],
        grants: [],
        ruoli: [],
      },
    };
  }

  /** Restituisce l'utente demo fittizio; non contiene dati o grant reali. */
  getDemoUser(): LoginResult {
    return {
      utente: {
        codiceUtente: 12345,
        email: "jdoe",
        statoRegistrazione: StatoRegistrazione.CONF,
        cognome: "Doe",
        nome: "John",
        flagGdpr: true,
        avatar: "/path/to/avatar.jpg",
        flagDueFattori: false,
        codiceLingua: "IT",
        cellulare: "+391234567890",
        flagSuper: false,
        roles: [],
        permissions: [],
      },
      filtri: null,
      userGrants: {
        abilitazioni: [],
        grants: [],
        ruoli: [],
      },
    };
  }

  /**
   * Consuma un token monouso di reset, riporta l'utente allo stato confermato e salva la nuova password.
   * Il nonce in `UTENTI.KEYREG` viene annullato prima di impostare la password, impedendo il riuso del token.
   */
  public async confirmResetPassword(
    token: string,
    newPassword: string
  ): Promise<void> {
    try {
      if (typeof token !== "string" || token.trim() === "") {
        throw new Error("Token non valido.");
      }

      assertStrongPassword(newPassword);

      const secret = getAccessiJwtSecret(this.accessiOptions, 'reset');
      const { codiceUtente, nonce } = verifyPasswordResetToken(token.trim(), secret);

      const hashedPassword = PasswordUtilities.hashPassword(newPassword);

      await Orm.withTransaction(this.accessiOptions.databaseOptions, async (transaction) => {
        // A conditional write claims the nonce under the database row lock. A second
        // concurrent reset cannot also consume it; failures roll the whole reset back.
        const claimed = await Orm.transactionQuery<unknown>(
          transaction,
          'UPDATE UTENTI SET KEYREG = NULL, STAREG = ? WHERE CODUTE = ? AND KEYREG = ? AND STAREG IN (?, ?) RETURNING CODUTE',
          [StatoRegistrazione.CONF, codiceUtente, nonce, StatoRegistrazione.CONF, StatoRegistrazione.INVIO],
        );
        const row = (Array.isArray(claimed) ? claimed[0] : claimed) as Record<string, unknown> | undefined;
        if (Number(row?.CODUTE ?? row?.codute) !== codiceUtente) {
          throw new Error('Token non valido, gia usato o utente non autorizzato.');
        }

        await Orm.transactionQuery(
          transaction,
          'UPDATE OR INSERT INTO UTENTI_PWD (CODUTE, PWD) VALUES (?, ?) MATCHING (CODUTE)',
          [codiceUtente, hashedPassword],
        );

        if (this.accessiOptions.passwordExpiration) {
          const days = Number(this.accessiOptions.passwordExpirationDays);
          const expirationDays = Number.isFinite(days) && days > 0 ? Math.trunc(days) : 90;
          await Orm.transactionQuery(
            transaction,
            `UPDATE UTENTI SET DATSCAPWD = DATEADD(${expirationDays} DAY TO CURRENT_TIMESTAMP) WHERE CODUTE = ?`,
            [codiceUtente],
          );
        }
      });

      // Il reset e un cambio password: i token emessi prima non devono piu valere.
      await this.revokeSessionsAfterSecurityChange(codiceUtente, 'password_reset');
    } catch (error) {
      throw error;
    }
  }
}
