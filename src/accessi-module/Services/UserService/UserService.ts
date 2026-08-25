import { Inject, Injectable } from '@nestjs/common';
import { autobind } from '../../../autobind';
import { Orm } from '../../../Orm';
import { RestUtilities } from '../../../Utilities';
import { AccessiOptions } from '../../AccessiModule';
import { FILTRI_UTENTE_DB_MAPPING, FiltriUtente } from '../../Dtos/FiltriUtente';
import { GetUsersResult } from '../../Dtos/GetUsersResponse';
import { RegisterRequest } from '../../Dtos/RegisterRequest';
import { StatoRegistrazione } from '../../Dtos/StatoRegistrazione';
import { UserDto } from '../../Dtos/UserDto';
import { AccessiAuthenticatedUserSnapshot } from '../../security/authenticatedToken';
import { EmailService } from '../EmailService/EmailService';
import { FiltriService } from '../FiltriService/FiltriService';
import { PermissionService } from '../PermissionService/PermissionService';

interface OptionalField<T> {
  key: keyof RegisterRequest;
  dbField: string;
  transform?: (value: any) => T;
}

@autobind
@Injectable()
export class UserService {
  constructor(
    @Inject('ACCESSI_OPTIONS') private readonly accessiOptions: AccessiOptions,
    private readonly emailService: EmailService,
    private readonly permissionService: PermissionService,
    private readonly filtriService: FiltriService,
  ) {}

  private normalizeDatabaseBoolean(value: unknown): boolean {
    return value === true || value === 1 || value === '1';
  }

  private normalizeEmail(email: string): string {
    if (typeof email !== 'string' || email.trim() === '') {
      throw new Error("L'email e' obbligatoria.");
    }

    return email.trim().toLowerCase();
  }

  private async ensureEmailIsAvailable(email: string, currentUserCode?: number): Promise<void> {
    const result = await Orm.query(
      this.accessiOptions.databaseOptions,
      'SELECT FIRST 1 CODUTE as codice_utente FROM UTENTI WHERE LOWER(USRNAME) = ?',
      [email],
    );

    const existingUser = result.map(RestUtilities.convertKeysToCamelCase)[0] as
      | { codiceUtente?: number }
      | undefined;

    if (
      existingUser?.codiceUtente &&
      (!currentUserCode || existingUser.codiceUtente !== currentUserCode)
    ) {
      throw new Error("Questa e-mail e' gia stata utilizzata!");
    }
  }

  async isAdminConfigurator(codiceUtente: number): Promise<boolean> {
    if (!codiceUtente) {
      return false;
    }

    const query = `SELECT FLGADMINCONFIG AS flag_admin_configurator FROM UTENTI_CONFIG WHERE CODUTE = ?`;
    const result = await Orm.query(this.accessiOptions.databaseOptions, query, [codiceUtente]);

    if (!result || result === 0) {
      return false;
    }

    const mapped = result.map(RestUtilities.convertKeysToCamelCase);
    return this.normalizeDatabaseBoolean(mapped[0]?.flagAdminConfigurator);
  }

  async getAuthenticatedUserSnapshot(
    codiceUtente: number,
  ): Promise<AccessiAuthenticatedUserSnapshot | null> {
    if (!codiceUtente || codiceUtente <= 0) {
      return null;
    }

    const result = await Orm.query(
      this.accessiOptions.databaseOptions,
      `
        SELECT
          U.CODUTE AS codice_utente,
          U.USRNAME AS email,
          U.STAREG AS stato_registrazione,
          C.FLGSUPER AS flag_super,
          C.FLGADMINCONFIG AS flag_admin_configurator
        FROM UTENTI U
        LEFT JOIN UTENTI_CONFIG C ON C.CODUTE = U.CODUTE
        WHERE U.CODUTE = ?
      `,
      [codiceUtente],
    );

    const user = result.map(RestUtilities.convertKeysToCamelCase)[0] as
      | {
          codiceUtente?: number;
          email?: string;
          statoRegistrazione?: StatoRegistrazione | number;
          flagSuper?: unknown;
          flagAdminConfigurator?: unknown;
        }
      | undefined;

    if (!user?.codiceUtente) {
      return null;
    }

    return {
      codiceUtente: Number(user.codiceUtente),
      email: typeof user.email === 'string' ? user.email : undefined,
      statoRegistrazione: Number(user.statoRegistrazione) as StatoRegistrazione,
      flagSuper: this.normalizeDatabaseBoolean(user.flagSuper),
      flagAdminConfigurator: this.normalizeDatabaseBoolean(user.flagAdminConfigurator),
    };
  }

  async getUsers(
    filters?: { email?: string; codiceUtente?: number },
    options?: { includeExtensionFields: boolean; includeGrants: boolean },
  ): Promise<GetUsersResult[]> {
    try {
      let query = ` 
            SELECT  
                U.CODUTE as codice_utente, 
                U.USRNAME as email, 
                U.FLGGDPR as flag_gdpr, 
                U.DATGDPR as data_gdpr, 
                U.DATINS as data_inserimento, 
                U.DATSCAPWD as data_scadenza_password, 
                U.DATLASTLOGIN as data_last_login, 
                U.STAREG as stato_registrazione, 
                G.COGNOME as cognome, 
                G.NOME as nome, 
                G.AVATAR as avatar, 
                G.FLG2FATT as flag_due_fattori, 
                G.CODLINGUA as codice_lingua,
                G.CELLULARE as cellulare,
                G.FLGSUPER as flag_super, 
                G.FLGADMINCONFIG as flag_admin_configurator,
                G.PAGDEF as pagina_default,
                G.JSON_METADATA as json_metadata,
                G.RAGSOCCLI as rag_soc_cli,
                G.NUMMAC as nummac,
                F.NUMREP AS num_rep,
                F.IDXPERS AS idx_pers,
                F.CODCLISUPER AS cod_cli_super,
                F.CODAGE AS cod_age,
                F.CODCLICOL AS cod_cli_col,
                F.CODCLIENTI AS cod_clienti,
                F.TIPFIL AS tip_fil,
                F.IDXPOS AS idx_postazione
            FROM UTENTI U 
            INNER JOIN UTENTI_CONFIG G ON U.CODUTE = G.CODUTE
            LEFT JOIN FILTRI F ON F.CODUTE = U.CODUTE
            WHERE 1=1
            `;

      const queryParams: any[] = [];

      if (filters?.email) {
        query += ` AND LOWER(U.USRNAME) = ? `;
        queryParams.push(filters.email.trim().toLowerCase());
      }

      if (filters?.codiceUtente) {
        query += ` AND U.CODUTE = ? `;
        queryParams.push(filters.codiceUtente);
      }

      query += ` ORDER BY U.CODUTE DESC `;

      let users = (await Orm.query(
        this.accessiOptions.databaseOptions,
        query,
        queryParams,
      )) as UserDto[];
      users = users.map(RestUtilities.convertKeysToCamelCase);

      const usersResponse: GetUsersResult[] = [];

      for (const user of users) {
        let userGrants = null;

        if (options?.includeGrants) {
          userGrants = await this.permissionService.getUserRolesAndGrants(user.codiceUtente);
        }

        let extensionFields = options?.includeExtensionFields ? {} : null;

        if (options?.includeExtensionFields && this.accessiOptions.extensionFieldsOptions) {
          for (const ext of this.accessiOptions.extensionFieldsOptions) {
            const values = (
              await Orm.query(
                ext.databaseOptions,
                `SELECT ${ext.tableFields.join(',')} FROM ${ext.tableName} WHERE ${
                  ext.tableJoinFieldName
                } = ?`,
                [user.codiceUtente],
              )
            ).map(RestUtilities.convertKeysToCamelCase);

            extensionFields[ext.objectKey] = values;
          }
        }

        usersResponse.push({
          utente: user,
          userGrants,
          extensionFields,
        });
      }

      return usersResponse;
    } catch (error) {
      throw error;
    }
  }

  async getCodiceUtenteByEmail(email: string): Promise<{ codiceUtente: number }> {
    try {
      const query = `SELECT CODUTE as codice_utente FROM UTENTI WHERE LOWER(USRNAME) = ?`;
      const result = await Orm.query(this.accessiOptions.databaseOptions, query, [
        email.trim().toLowerCase(),
      ]);
      return result.map(RestUtilities.convertKeysToCamelCase)[0];
    } catch (error) {
      throw error;
    }
  }

  async getUserByEmail(email: string): Promise<UserDto | null> {
    const query = `
            SELECT 
                U.CODUTE AS codice_utente, 
                U.USRNAME AS email, 
                U.FLGGDPR AS flag_gdpr,
                U.DATSCAPWD as data_scadenza_password,
                U.STAREG AS stato_registrazione, 
                C.COGNOME AS cognome, 
                C.NOME AS nome, 
                C.AVATAR AS avatar, 
                C.FLG2FATT AS flag_due_fattori,
                C.CODLINGUA AS codice_lingua, 
                C.CELLULARE AS cellulare, 
                C.FLGSUPER AS flag_super,
                C.FLGADMINCONFIG AS flag_admin_configurator,
                C.PAGDEF AS pagina_default,
                C.NUMMAC AS nummac,
                C.RAGSOCCLI AS rag_soc_cli
            FROM UTENTI U
            INNER JOIN UTENTI_CONFIG C ON C.CODUTE = U.CODUTE
            WHERE LOWER(U.USRNAME) = ?
        `;

    const utenti = (await Orm.query(this.accessiOptions.databaseOptions, query, [email]).then(
      (results) => results.map(RestUtilities.convertKeysToCamelCase),
    )) as UserDto[];

    const filtriUtente = await this.filtriService.getFiltriUser(utenti[0]?.codiceUtente);

    if (utenti.length <= 0) {
      return null;
    }

    if (utenti.length > 0 && filtriUtente.length > 0) {
      const user = utenti[0];
      const filtro = filtriUtente[0];

      Object.entries(FILTRI_UTENTE_DB_MAPPING).forEach(([key]) => {
        if (key in filtro) {
          (user as UserDto)[key] = filtro[key as keyof FiltriUtente];
        }
      });
    }

    return utenti.length > 0 ? utenti[0] : null;
  }

  async insertUserFilters(codiceUtente: number, filterData: RegisterRequest): Promise<void> {
    await this.filtriService.upsertFiltriUtente(codiceUtente, filterData);
  }

  private async executeInTransaction(operation: () => Promise<void>): Promise<void> {
    await operation();
  }

  async register(
    registrationData: RegisterRequest,
    options?: { allowPrivilegedFields?: boolean },
  ): Promise<number> {
    try {
      const allowPrivilegedFields = options?.allowPrivilegedFields === true;
      const normalizedEmail = this.normalizeEmail(registrationData.email);

      if (
        !allowPrivilegedFields &&
        (registrationData.flagSuper !== undefined ||
          registrationData.flagAdminConfigurator !== undefined ||
          registrationData.roles !== undefined ||
          registrationData.permissions !== undefined)
      ) {
        throw new Error('I campi privilegiati non sono consentiti nella registrazione pubblica.');
      }

      await this.ensureEmailIsAvailable(normalizedEmail);

      const queryUtenti = `INSERT INTO UTENTI (USRNAME, STAREG) VALUES (?,?)`;
      const paramsUtenti = [normalizedEmail, StatoRegistrazione.INVIO];

      await Orm.execute(this.accessiOptions.databaseOptions, queryUtenti, paramsUtenti);

      const codiceUtenteResult = await Orm.query(
        this.accessiOptions.databaseOptions,
        'SELECT FIRST 1 CODUTE FROM UTENTI WHERE USRNAME = ? ORDER BY CODUTE DESC',
        [normalizedEmail],
      );

      const codiceUtente = Number(
        codiceUtenteResult?.[0]?.CODUTE ?? codiceUtenteResult?.[0]?.codute,
      );
      if (!codiceUtente) {
        throw new Error('Creazione utente non riuscita: impossibile recuperare CODUTE.');
      }

      const utentiConfigFields = ['CODUTE', 'COGNOME', 'NOME'];
      const utentiConfigPlaceholders = ['?', '?', '?'];
      const utentiConfigParams = [codiceUtente, registrationData.cognome, registrationData.nome];

      const optionalFields: OptionalField<any>[] = [
        {
          key: 'cellulare',
          dbField: 'CELLULARE',
          transform: (v) => String(v),
        },
        {
          key: 'avatar',
          dbField: 'AVATAR',
          transform: (v) => String(v),
        },
        {
          key: 'flagDueFattori',
          dbField: 'FLG2FATT',
          transform: (v) => (v ? 1 : 0),
        },
        {
          key: 'paginaDefault',
          dbField: 'PAGDEF',
          transform: (v) => String(v),
        },
        {
          key: 'nummac',
          dbField: 'NUMMAC',
          transform: (v) => Number(v),
        },
        {
          key: 'ragSocCli',
          dbField: 'RAGSOCCLI',
          transform: (v) => String(v),
        },
      ];

      if (allowPrivilegedFields) {
        optionalFields.push(
          {
            key: 'flagSuper',
            dbField: 'FLGSUPER',
            transform: (v) => (v ? 1 : 0),
          },
          {
            key: 'flagAdminConfigurator',
            dbField: 'FLGADMINCONFIG',
            transform: (v) => (v ? 1 : 0),
          },
        );
      }

      for (const field of optionalFields) {
        const value = registrationData[field.key];
        if (value !== undefined && value !== null) {
          utentiConfigFields.push(field.dbField);
          utentiConfigPlaceholders.push('?');
          utentiConfigParams.push(field.transform ? field.transform(value) : value);
        }
      }

      const queryUtentiConfig = `INSERT INTO UTENTI_CONFIG (${utentiConfigFields.join(
        ', ',
      )}) VALUES (${utentiConfigPlaceholders.join(', ')})`;
      await Orm.execute(this.accessiOptions.databaseOptions, queryUtentiConfig, utentiConfigParams);

      await this.filtriService.upsertFiltriUtente(codiceUtente, registrationData);

      if (allowPrivilegedFields && !!registrationData.roles && registrationData.roles.length > 0) {
        await this.permissionService.assignRolesToUser(codiceUtente, registrationData.roles);
      }

      if (
        allowPrivilegedFields &&
        !!registrationData.permissions &&
        registrationData.permissions.length > 0
      ) {
        await this.permissionService.assignPermissionsToUser(
          codiceUtente,
          registrationData.permissions,
        );
      }

      return codiceUtente;
    } catch (error) {
      throw error;
    }
  }

  async updateUser(
    codiceUtente: number,
    user: UserDto,
    options?: { allowPrivilegedChanges?: boolean },
  ): Promise<void> {
    try {
      if (!codiceUtente) throw new Error('Impossibile aggiornare senza codice utente.');
      const allowPrivilegedChanges = options?.allowPrivilegedChanges === true;

      if (
        !allowPrivilegedChanges &&
        (user.statoRegistrazione !== undefined ||
          user.flagSuper !== undefined ||
          user.flagAdminConfigurator !== undefined ||
          user.roles !== undefined ||
          user.permissions !== undefined)
      ) {
        throw new Error('Non e consentito modificare campi privilegiati.');
      }

      const utentiUpdates = [];
      const utentiParams = [];

      if (user.email !== undefined) {
        const normalizedEmail = this.normalizeEmail(user.email);
        await this.ensureEmailIsAvailable(normalizedEmail, codiceUtente);
        utentiUpdates.push('usrname = ?');
        utentiParams.push(normalizedEmail);
      }
      if (user.flagGdpr !== undefined) {
        utentiUpdates.push('flggdpr = ?');
        utentiParams.push(user.flagGdpr);
      }
      if (allowPrivilegedChanges && user.statoRegistrazione !== undefined) {
        utentiUpdates.push('stareg = ?');
        utentiParams.push(user.statoRegistrazione);
      }

      if (utentiUpdates.length > 0) {
        const queryUtenti = `UPDATE UTENTI SET ${utentiUpdates.join(', ')} WHERE CODUTE = ?`;
        utentiParams.push(codiceUtente);
        await Orm.execute(this.accessiOptions.databaseOptions, queryUtenti, utentiParams);
      }

      const utentiConfigUpdates = [];
      const utentiConfigParams = [];

      if (user.cognome !== undefined) {
        utentiConfigUpdates.push('cognome = ?');
        utentiConfigParams.push(user.cognome);
      }
      if (user.nome !== undefined) {
        utentiConfigUpdates.push('nome = ?');
        utentiConfigParams.push(user.nome);
      }
      if (user.avatar !== undefined) {
        utentiConfigUpdates.push('avatar = ?');
        utentiConfigParams.push(user.avatar);
      }
      if (user.flagDueFattori !== undefined) {
        utentiConfigUpdates.push('flg2fatt = ?');
        utentiConfigParams.push(user.flagDueFattori);
      }
      if (user.codiceLingua !== undefined) {
        utentiConfigUpdates.push('codlingua = ?');
        utentiConfigParams.push(user.codiceLingua);
      }
      if (user.cellulare !== undefined) {
        utentiConfigUpdates.push('cellulare = ?');
        utentiConfigParams.push(user.cellulare);
      }
      if (allowPrivilegedChanges && user.flagSuper !== undefined) {
        utentiConfigUpdates.push('flgsuper = ?');
        utentiConfigParams.push(user.flagSuper);
      }
      if (allowPrivilegedChanges && user.flagAdminConfigurator !== undefined) {
        utentiConfigUpdates.push('flgadminconfig = ?');
        utentiConfigParams.push(user.flagAdminConfigurator);
      }
      if (user.paginaDefault !== undefined) {
        utentiConfigUpdates.push('pagdef = ?');
        utentiConfigParams.push(user.paginaDefault);
      }
      if (user.jsonMetadata !== undefined) {
        utentiConfigUpdates.push('json_metadata = ?');
        utentiConfigParams.push(user.jsonMetadata);
      }
      if (user.ragSocCli !== undefined) {
        utentiConfigUpdates.push('ragsoccli = ?');
        utentiConfigParams.push(user.ragSocCli);
      }

      if (utentiConfigUpdates.length > 0) {
        const queryUtentiConfig = `UPDATE UTENTI_CONFIG SET ${utentiConfigUpdates.join(
          ', ',
        )} WHERE CODUTE = ?`;
        utentiConfigParams.push(codiceUtente);
        await Orm.execute(
          this.accessiOptions.databaseOptions,
          queryUtentiConfig,
          utentiConfigParams,
        );
      }

      if (allowPrivilegedChanges && !!user.roles && user.roles.length > 0) {
        await this.permissionService.assignRolesToUser(codiceUtente, user.roles);
      }

      if (allowPrivilegedChanges && !!user.permissions && user.permissions.length > 0) {
        await this.permissionService.assignPermissionsToUser(codiceUtente, user.permissions);
      }

      await this.filtriService.upsertFiltriUtente(codiceUtente, user);
    } catch (error) {
      throw error;
    }
  }

  async updateUserFilters(codiceUtente: number, user: UserDto): Promise<void> {
    await this.filtriService.upsertFiltriUtente(codiceUtente, user);
  }

  async deleteUser(codiceCliente: number): Promise<void> {
    try {
      const query = `UPDATE UTENTI SET STAREG = ? WHERE CODUTE = ?`;
      await Orm.execute(this.accessiOptions.databaseOptions, query, [
        StatoRegistrazione.DELETE,
        codiceCliente,
      ]);
    } catch (error) {
      throw error;
    }
  }

  async setStato(codiceCliente: number, statoRegistrazione: StatoRegistrazione) {
    try {
      const query = `UPDATE UTENTI SET STAREG = ? WHERE CODUTE = ?`;
      await Orm.execute(this.accessiOptions.databaseOptions, query, [
        statoRegistrazione,
        codiceCliente,
      ]);
    } catch (error) {
      throw error;
    }
  }

  public async setGdpr(codiceUtente: number) {
    try {
      const query = ` UPDATE OR INSERT UTENTI_GDPR SET CODUTE = ?, GDPR = ? `;
      const params = [codiceUtente, true];
      return await Orm.execute(this.accessiOptions.databaseOptions, query, params);
    } catch (error) {
      throw error;
    }
  }
}
