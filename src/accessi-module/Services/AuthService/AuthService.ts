import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { TwoFactorService, TwoFactorProof } from '../TwoFactorService/TwoFactorService';
import * as jwt from "jsonwebtoken";
import { Orm } from "../../../Orm";
import { CryptUtilities, PasswordUtilities, RestUtilities } from "../../../Utilities";
import type { AccessiOptions } from "../../AccessiModule";
import { LoginRequest } from "../../Dtos/LoginRequest";
import { LoginResult } from "../../Dtos/LoginResponse";
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
import { Logger } from "../../../Logger";
import { TokenResult } from '../../Dtos/TokenResult';

/** Error code deliberately returned when a user is configured as SSO-only. */
export const PASSWORD_LOGIN_DISABLED = 'PASSWORD_LOGIN_DISABLED';

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

  /** Creates the normal internal JWT consumed by all existing Accessi guards. */
  public createAccessiToken(utente: LoginResult['utente'], methods: string[] = []): TokenResult {
    if (!utente?.codiceUtente) {
      throw new Error('Impossibile creare un token senza un utente Accessi valido.');
    }
    if ((utente.flagDueFattori === true || Number(utente.flagDueFattori) === 1) && !methods.includes('otp')) {
      throw new UnauthorizedException('Verifica del codice di accesso richiesta.');
    }

    const expiresIn = this.accessiOptions.jwtOptions.expiresIn;
    if (typeof expiresIn !== 'string' || expiresIn.trim() === '') {
      throw new Error('jwtOptions.expiresIn non configurato: impossibile emettere token senza scadenza.');
    }

    const token = jwt.sign({ utente, typ: 'access', amr: methods }, getAccessiJwtSecret(this.accessiOptions), {
      expiresIn: expiresIn as unknown as jwt.SignOptions['expiresIn'],
    });

    // Difesa in profondita: un `expiresIn` malformato farebbe emettere un token permanente.
    const decoded = jwt.decode(token);
    if (!decoded || typeof decoded !== 'object' || typeof (decoded as jwt.JwtPayload).exp !== 'number') {
      throw new Error('Token emesso senza scadenza: configurazione JWT non valida.');
    }

    return {
      expiresIn,
      value: token,
      type: 'Bearer',
    };
  }

  /** Builds the standard login response for a user authenticated by a supported method. */
  public async getLoginResultForUser(codiceUtente: number): Promise<LoginResult> {
    const users = await this.userService.getUsers(
      { codiceUtente },
      { includeExtensionFields: true, includeGrants: true },
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

    return this.getLoginResultForUser(utente.codiceUtente);
  }

  /**
   * Verifica un JWT Accessi e ricostruisce il profilo corrente dal database.
   * Questo evita che privilegi, stato utente o flag amministrativi presenti in un token vecchio restino validi.
   */
  public async getAuthenticatedTokenPayload(token: string): Promise<Record<string, unknown>> {
    if (typeof token !== "string" || token.trim() === "") {
      throw new Error("Token non fornito.");
    }

    const secret = getAccessiJwtSecret(this.accessiOptions);
    const decoded = jwt.verify(token.trim(), secret, { algorithms: ['HS256'] });
    const codiceUtente = resolveCodiceUtenteFromTokenPayload(decoded);

    if (!codiceUtente) {
      throw new Error("Token non valido.");
    }

    const currentUser = await this.userService.getAuthenticatedUserSnapshot(codiceUtente);
    if (!currentUser || !isAuthenticatedUserEnabledForJwt(currentUser) || !isAccessiTokenAllowedForUser(decoded, currentUser)) {
      throw new Error("Token non valido o utente non autorizzato.");
    }

    return buildAuthenticatedTokenPayload(decoded, currentUser);
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

  public async verifyTwoFactor(challengeId: string, code: string): Promise<LoginResult> {
    const proof = await this.twoFactorService.consume(challengeId, code);
    await this.validateTwoFactorProof(proof);
    const result = await this.getLoginResultForUser(proof.codiceUtente);
    result.token = this.createAccessiToken(result.utente, [proof.mode, 'otp']);
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

  /** Persiste una password hashata e aggiorna la scadenza, se la policy password e attiva. Non invia email. */
  public async setPassword(codiceUtente: number, nuovaPassword: string) {
    try {
      const query = `UPDATE OR INSERT INTO UTENTI_PWD (CODUTE, PWD) VALUES (?, ?)`;
      const hashedPassword = PasswordUtilities.hashPassword(nuovaPassword);

      const result = await Orm.execute(this.accessiOptions.databaseOptions, query, [
        codiceUtente,
        hashedPassword,
      ]);
      await this.refreshPasswordExpiration(codiceUtente);
      return result;
    } catch (error) {
      throw error;
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

    if (result.length === 0 || typeof result[0].password !== "string") {
      return false;
    }

    const storedPassword = result[0].password;

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
        await this.setPassword(codiceUtente, plainPassword);
      }

      return isMigratedLegacyPasswordValid;
    }

    const isLegacyPasswordValid = PasswordUtilities.timingSafeStringEquals(
      storedPassword,
      legacyEncryptedPassword,
    );

    if (isLegacyPasswordValid) {
      await this.setPassword(codiceUtente, plainPassword);
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
        paginaDefault: "/home",
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
        paginaDefault: "/home",
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

      if (
        typeof newPassword !== "string" ||
        newPassword.length < 8 ||
        newPassword.length > 100
      ) {
        throw new Error("La nuova password deve essere compresa tra 8 e 100 caratteri.");
      }

      const secret = getAccessiJwtSecret(this.accessiOptions);
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
    } catch (error) {
      throw error;
    }
  }
}
