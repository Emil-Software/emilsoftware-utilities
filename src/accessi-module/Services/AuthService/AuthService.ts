import { Inject, Injectable } from "@nestjs/common";
import * as jwt from "jsonwebtoken";
import { Orm } from "../../../Orm";
import { CryptUtilities, PasswordUtilities, RestUtilities } from "../../../Utilities";
import { AccessiOptions } from "../../AccessiModule";
import { LoginRequest } from "../../Dtos/LoginRequest";
import { LoginResult } from "../../Dtos/LoginResponse";
import { StatoRegistrazione } from "../../Dtos/StatoRegistrazione";
import { UserService } from "../UserService/UserService";
import { PermissionService } from "../PermissionService/PermissionService";
import { FiltriService } from "../FiltriService/FiltriService";
import {
  buildAuthenticatedTokenPayload,
  isAuthenticatedUserEnabledForJwt,
  resolveCodiceUtenteFromTokenPayload,
} from "../../security/authenticatedToken";
import {
  getAccessiJwtSecret,
  verifyPasswordResetToken,
} from "../../security/passwordResetToken";
import { Logger } from "../../../Logger";

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private userService: UserService,
    private permissionService: PermissionService,
    private filtriService: FiltriService,
    @Inject("ACCESSI_OPTIONS") private readonly accessiOptions: AccessiOptions
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

    const nodeEnv = (process.env.NODE_ENV ?? "production").toLowerCase();
    return nodeEnv !== "production" || process.env.ACCESSI_ALLOW_MOCK_DEMO_USER === "true";
  }

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
      request.email.toLowerCase()
    );
    if (!utente) throw new Error("Nome utente o password errata!");

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
      const targetDate = new Date(utente.dataScadenzaPassword);

      if (today >= targetDate) {
        throw new Error("PASSWORD_EXPIRED");
      }
    }

    const userGrants = await this.permissionService.getUserRolesAndGrants(
      utente.codiceUtente
    );

    const filtri = await this.filtriService.getFiltriUser(utente.codiceUtente);

    const updateLastAccessDateQuery =
      "UPDATE UTENTI SET DATLASTLOGIN = CURRENT_TIMESTAMP WHERE CODUTE = ?";
    await Orm.query(
      this.accessiOptions.databaseOptions,
      updateLastAccessDateQuery,
      [utente.codiceUtente]
    );

    const extensionFields = {};

    if (
      this.accessiOptions.extensionFieldsOptions &&
      this.accessiOptions.extensionFieldsOptions.length > 0
    ) {
      for (const ext of this.accessiOptions.extensionFieldsOptions) {
        const values = (
          await Orm.query(
            ext.databaseOptions,
            `SELECT ${ext.tableFields.join(",")} FROM ${ext.tableName} WHERE ${
              ext.tableJoinFieldName
            } = ?`,
            [utente.codiceUtente]
          )
        ).map(RestUtilities.convertKeysToCamelCase);

        extensionFields[ext.objectKey] = values;
      }
    }

    return { utente, filtri, userGrants, extensionFields };
  }

  public async getAuthenticatedTokenPayload(token: string): Promise<Record<string, unknown>> {
    if (typeof token !== "string" || token.trim() === "") {
      throw new Error("Token non fornito.");
    }

    const secret = getAccessiJwtSecret(this.accessiOptions);
    const decoded = jwt.verify(token.trim(), secret);
    const codiceUtente = resolveCodiceUtenteFromTokenPayload(decoded);

    if (!codiceUtente) {
      throw new Error("Token non valido.");
    }

    const currentUser = await this.userService.getAuthenticatedUserSnapshot(codiceUtente);
    if (!isAuthenticatedUserEnabledForJwt(currentUser)) {
      throw new Error("Token non valido o utente non autorizzato.");
    }

    return buildAuthenticatedTokenPayload(decoded, currentUser);
  }

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

    const isLegacyPasswordValid = storedPassword === legacyEncryptedPassword;

    if (isLegacyPasswordValid) {
      await this.setPassword(codiceUtente, plainPassword);
    }

    return isLegacyPasswordValid;
  }

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

      const result = (await Orm.query(
        this.accessiOptions.databaseOptions,
        "SELECT CODUTE AS codice_utente, STAREG AS stato_registrazione FROM UTENTI WHERE CODUTE = ? AND KEYREG = ?",
        [codiceUtente, nonce]
      ).then((rows) => rows.map(RestUtilities.convertKeysToCamelCase))) as {
        codiceUtente?: number;
        statoRegistrazione?: StatoRegistrazione | number;
      }[];

      if (result.length === 0) {
        throw new Error("Token non valido o gia usato.");
      }

      const currentState = Number(result[0].statoRegistrazione);
      if (
        currentState === StatoRegistrazione.BLOCC ||
        currentState === StatoRegistrazione.DELETE
      ) {
        throw new Error("Utente non autorizzato a completare il reset password.");
      }

      await Orm.query(
        this.accessiOptions.databaseOptions,
        "UPDATE UTENTI SET KEYREG = NULL, STAREG = ? WHERE CODUTE = ?",
        [StatoRegistrazione.CONF, codiceUtente]
      );

      await this.setPassword(codiceUtente, newPassword);
    } catch (error) {
      throw error;
    }
  }
}
