import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { getTableColumns, optionalColumn } from '../../database-updates/optionalColumns';
import { autobind } from '../../../autobind';
import { Orm } from '../../../Orm';
import { RestUtilities } from '../../../Utilities';
import type { AccessiOptions } from '../../AccessiModule';
import { FILTRI_UTENTE_DB_MAPPING, FiltriUtente } from '../../Dtos/FiltriUtente';
import { GetUsersResult } from '../../Dtos/GetUsersResponse';
import { RegisterRequest } from '../../Dtos/RegisterRequest';
import { StatoRegistrazione } from '../../Dtos/StatoRegistrazione';
import { UserDto } from '../../Dtos/UserDto';
import { UserGrantsDto } from '../../Dtos/UserGrantsDto';
import { AccessiAuthenticatedUserSnapshot } from '../../security/authenticatedToken';
import { assertEmailConfigured } from '../../security/emailConfiguration';
import { EmailService } from '../EmailService/EmailService';
import { FiltriService } from '../FiltriService/FiltriService';
import { PermissionService } from '../PermissionService/PermissionService';

interface OptionalField<T> {
  key: string;
  dbField: string;
  transform?: (value: unknown) => T;
}

/**
 * Flag applicativi UTENTI_CONFIG esposti e gestibili dal modulo.
 * `key` = nome camelCase nel DTO, `column` = colonna fisica, `alias` = alias SELECT.
 */
const APPLICATION_FLAG_FIELDS: ReadonlyArray<{ key: string; column: string; alias: string }> = [
  { key: 'flagMop', column: 'FLGMOP', alias: 'flag_mop' },
  { key: 'flagPiana', column: 'FLGPIANA', alias: 'flag_piana' },
  { key: 'flagAddetti', column: 'FLGADDETTI', alias: 'flag_addetti' },
  { key: 'flagOspiti', column: 'FLGOSPITI', alias: 'flag_ospiti' },
  { key: 'flagPianaRfid', column: 'FLGPIANARFID', alias: 'flag_piana_rfid' },
  { key: 'flagConta', column: 'FLGCONTA', alias: 'flag_conta' },
  { key: 'flagCubi', column: 'FLGCUBI', alias: 'flag_cubi' },
  { key: 'flagCicliPass', column: 'FLGCICLPASS', alias: 'flag_cicli_pass' },
  { key: 'flagDipendenti', column: 'FLGDIPENDENTI', alias: 'flag_dipendenti' },
  { key: 'flagInventari', column: 'FLGINVENTARI', alias: 'flag_inventari' },
];

@autobind
@Injectable()
export class UserService {
  constructor(
    @Inject('ACCESSI_OPTIONS') private readonly accessiOptions: AccessiOptions,
    private readonly emailService: EmailService,
    private readonly permissionService: PermissionService,
    private readonly filtriService: FiltriService,
  ) {}

  private async validateApplicationFields(value: { nummac?: number; ragSocCli?: string } & Partial<FiltriUtente>): Promise<{ configColumns?: Set<string> }> {
    type ApplicationField = 'nummac' | 'ragSocCli';
    const applicationFields: ReadonlyArray<readonly [ApplicationField, string]> = [['nummac', 'NUMMAC'], ['ragSocCli', 'RAGSOCCLI']];
    let configColumns: Set<string> | undefined;
    if (applicationFields.some(([key]) => value[key] !== undefined)) {
      configColumns = await getTableColumns(this.accessiOptions, 'UTENTI_CONFIG');
      for (const [key, column] of applicationFields) {
        if (value[key] !== undefined && value[key] !== null && !configColumns.has(column)) {
          throw new BadRequestException(`Campo applicativo non configurato: UTENTI_CONFIG.${column}`);
        }
      }
    }
    const filterKeys = Object.keys(FILTRI_UTENTE_DB_MAPPING) as Array<keyof FiltriUtente>;
    if (filterKeys.some(key => value[key] !== undefined && value[key] !== null && value[key] !== '')) {
      await this.filtriService.validateSupportedFields(value);
    }
    return { configColumns };
  }

  private normalizeDatabaseBoolean(value: unknown): boolean {
    return value === true || value === 1 || value === '1';
  }

  private normalizeUserFlags(user: UserDto): UserDto {
    const normalized: UserDto = { ...user,
      flagSuper: this.normalizeDatabaseBoolean(user.flagSuper),
      flagAdminConfigurator: this.normalizeDatabaseBoolean(user.flagAdminConfigurator),
      flagDueFattori: this.normalizeDatabaseBoolean(user.flagDueFattori),
      passwordlessLoginEnabled: this.normalizeDatabaseBoolean(user.passwordlessLoginEnabled),
      passwordLoginEnabled: user.passwordLoginEnabled == null || this.normalizeDatabaseBoolean(user.passwordLoginEnabled),
      enableIa: this.normalizeDatabaseBoolean(user.enableIa),
    };

    for (const field of APPLICATION_FLAG_FIELDS) {
      (normalized as unknown as Record<string, unknown>)[field.key] = this.normalizeDatabaseBoolean(
        (user as unknown as Record<string, unknown>)[field.key],
      );
    }

    return normalized;
  }

  private normalizeEmail(email: string): string {
    if (typeof email !== 'string' || email.trim() === '') {
      throw new BadRequestException({ code: 'ACCESSI_EMAIL_REQUIRED', message: "L'email è obbligatoria." });
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
      throw new ConflictException({ code: 'ACCESSI_EMAIL_ALREADY_EXISTS', message: "L'email è già associata a un utente Accessi." });
    }
  }

  /** Determina se l'utente puo amministrare il configuratore Accessi (`FLGADMINCONFIG`). */
  async isAdminConfigurator(codiceUtente: number): Promise<boolean> {
    if (!codiceUtente) {
      return false;
    }

    const query = `SELECT FLGADMINCONFIG AS flag_admin_configurator FROM UTENTI_CONFIG WHERE CODUTE = ?`;
    const result = await Orm.query(this.accessiOptions.databaseOptions, query, [codiceUtente]);

    if (result.length === 0) {
      return false;
    }

    const mapped = result.map(RestUtilities.convertKeysToCamelCase);
    return this.normalizeDatabaseBoolean(mapped[0]?.flagAdminConfigurator);
  }

  /**
   * Legge il minimo profilo autorevole usato da JWT e middleware. Restituisce `null` per utenti inesistenti.
   * Non usare `UserDto` dal token per decisioni di sicurezza: i flag vengono sempre riletti qui.
   */
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
          , C.FLG2FATT AS flag_due_fattori
          , C.FLGPWDLESS AS passwordless_login_enabled
          , COALESCE(C.FLGPASSWORD, 1) AS password_login_enabled
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
          flagDueFattori?: unknown;
          passwordlessLoginEnabled?: unknown;
          passwordLoginEnabled?: unknown;
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
      flagDueFattori: this.normalizeDatabaseBoolean(user.flagDueFattori),
      passwordlessLoginEnabled: this.normalizeDatabaseBoolean(user.passwordlessLoginEnabled),
      passwordLoginEnabled: this.normalizeDatabaseBoolean(user.passwordLoginEnabled),
    };
  }

  /**
   * Elenca gli utenti con filtri opzionali. Grant e campi estesi sono costosi e vengono caricati soltanto
   * quando richiesti esplicitamente nelle opzioni; usare filtri puntuali nei flussi di autenticazione.
   */
  async getUsers(
    filters?: {
      email?: string;
      codiceUtente?: number | number[];
      numRep?: number | number[];
      codDipendente?: number;
      cellulare?: string;
      cellute?: string;
      tipFil?: number;
      flagSuper?: boolean;
      limit?: number;
      offset?: number;
    },
    options?: { includeExtensionFields: boolean; includeGrants: boolean },
  ): Promise<GetUsersResult[]> {
    try {
      const configColumns = await getTableColumns(this.accessiOptions, 'UTENTI_CONFIG');
      const filterColumns = await getTableColumns(this.accessiOptions, 'FILTRI');
      const utentiColumns = await getTableColumns(this.accessiOptions, 'UTENTI');

      // Paginazione opzionale con limiti sani: il default resta "tutti gli utenti".
      const limit = Number.isInteger(filters?.limit) && (filters?.limit ?? 0) > 0
        ? Math.min(filters?.limit as number, 1000)
        : undefined;
      const offset = Number.isInteger(filters?.offset) && (filters?.offset ?? 0) > 0
        ? Math.trunc(filters?.offset as number)
        : 0;
      const pagination = `${limit !== undefined ? ` FIRST ${limit}` : ''}${offset > 0 ? ` SKIP ${offset}` : ''}`;

      let query = ` 
            SELECT${pagination}  
                U.CODUTE as codice_utente, 
                U.USRNAME as email, 
                U.FLGGDPR as flag_gdpr, 
                U.DATGDPR as data_gdpr, 
                U.DATINS as data_inserimento, 
                U.DATSCAPWD as data_scadenza_password, 
                U.DATLASTLOGIN as data_last_login, 
                U.STAREG as stato_registrazione, 
                ${optionalColumn(utentiColumns, 'ENABLEIA', 'U', 'enable_ia')},
                G.COGNOME as cognome, 
                G.NOME as nome, 
                G.AVATAR as avatar, 
                G.FLG2FATT as flag_due_fattori,
                G.FLGPWDLESS as passwordless_login_enabled,
                G.CODLINGUA as codice_lingua,
                G.CELLULARE as cellulare,
                G.FLGSUPER as flag_super, 
                G.FLGADMINCONFIG as flag_admin_configurator,
                COALESCE(G.FLGPASSWORD, 1) as password_login_enabled,
                G.PAGDEF as pagina_default,
                G.JSON_METADATA as json_metadata,
                ${optionalColumn(configColumns, 'RAGSOCCLI', 'G', 'rag_soc_cli', false)},
                ${optionalColumn(configColumns, 'NUMMAC', 'G', 'nummac')},
                ${optionalColumn(configColumns, 'CAUMOV', 'G', 'caumov')},
                ${APPLICATION_FLAG_FIELDS.map((field) => optionalColumn(configColumns, field.column, 'G', field.alias)).join(',\n                ')},
                ${optionalColumn(filterColumns, 'CODDIP', 'F', 'cod_dipendente')},
                ${optionalColumn(filterColumns, 'NUMREP', 'F', 'num_rep', true)},
                ${optionalColumn(filterColumns, 'IDXPERS', 'F', 'idx_pers', true)},
                ${optionalColumn(filterColumns, 'CODCLISUPER', 'F', 'cod_cli_super', true)},
                ${optionalColumn(filterColumns, 'CODAGE', 'F', 'cod_age', true)},
                ${optionalColumn(filterColumns, 'CODCLICOL', 'F', 'cod_cli_col', true)},
                ${optionalColumn(filterColumns, 'CODCLIENTI', 'F', 'cod_clienti', false)},
                F.TIPFIL AS tip_fil,
                ${optionalColumn(filterColumns, 'IDXPOS', 'F', 'idx_postazione', true)}
            FROM UTENTI U 
            INNER JOIN UTENTI_CONFIG G ON U.CODUTE = G.CODUTE
            LEFT JOIN FILTRI F ON F.CODUTE = U.CODUTE
            WHERE 1=1
            `;

      const queryParams: unknown[] = [];

      if (filters?.email) {
        query += ` AND LOWER(U.USRNAME) = ? `;
        queryParams.push(filters.email.trim().toLowerCase());
      }

      if (filters?.codiceUtente !== undefined) {
        const codes = (Array.isArray(filters.codiceUtente) ? filters.codiceUtente : [filters.codiceUtente])
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value) && value > 0);
        if (codes.length === 0) {
          return [];
        }
        query += ` AND U.CODUTE IN (${codes.map(() => '?').join(', ')}) `;
        queryParams.push(...codes);
      }

      if (filters?.numRep !== undefined) {
        const reparti = (Array.isArray(filters.numRep) ? filters.numRep : [filters.numRep])
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value));
        if (reparti.length === 0) {
          return [];
        }
        query += ` AND F.NUMREP IN (${reparti.map(() => '?').join(', ')}) `;
        queryParams.push(...reparti);
      }

      if (filters?.codDipendente !== undefined) {
        query += ` AND F.CODDIP = ? `;
        queryParams.push(Number(filters.codDipendente));
      }

      if (filters?.tipFil !== undefined) {
        query += ` AND F.TIPFIL = ? `;
        queryParams.push(Number(filters.tipFil));
      }

      if (filters?.cellulare) {
        query += ` AND TRIM(G.CELLULARE) = ? `;
        queryParams.push(String(filters.cellulare).trim());
      }

      if (filters?.cellute) {
        query += ` AND TRIM(U.CELLUTE) = ? `;
        queryParams.push(String(filters.cellute).trim());
      }

      if (filters?.flagSuper !== undefined) {
        query += filters.flagSuper ? ` AND COALESCE(G.FLGSUPER, 0) <> 0 ` : ` AND COALESCE(G.FLGSUPER, 0) = 0 `;
      }

      query += ` ORDER BY U.CODUTE DESC `;

      let users = (await Orm.query(
        this.accessiOptions.databaseOptions,
        query,
        queryParams,
      )) as UserDto[];
      users = users.map(RestUtilities.convertKeysToCamelCase).map(user => this.normalizeUserFlags(user as unknown as UserDto));

      const usersResponse: GetUsersResult[] = [];

      // I campi estensione sono caricati una volta per tabella (non una per utente) in query IN
      // suddivise in blocchi per non superare i limiti di parametri del driver.
      const extensionFieldsByUser = options?.includeExtensionFields
        ? await this.loadExtensionFieldsForUsers(users.map((user) => user.codiceUtente))
        : undefined;

      // I grant sono caricati in batch (query IN) invece che utente per utente.
      const grantsByUser = options?.includeGrants
        ? await this.permissionService.getUsersRolesAndGrants(users.map((user) => user.codiceUtente))
        : undefined;

      for (const user of users) {
        let userGrants: UserGrantsDto | undefined;

        if (options?.includeGrants) {
          userGrants = grantsByUser?.get(user.codiceUtente);
        }

        let extensionFields: Record<string, unknown[]> | undefined;

        if (options?.includeExtensionFields) {
          extensionFields = {};
          for (const ext of this.accessiOptions.extensionFieldsOptions ?? []) {
            extensionFields[ext.objectKey] = extensionFieldsByUser?.get(ext.objectKey)?.get(user.codiceUtente) ?? [];
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

  /** Conteggio utenti con gli stessi filtri di `getUsers`, per la paginazione (header X-Total-Count). */
  async countUsers(filters?: { email?: string; codiceUtente?: number }): Promise<number> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filters?.email) {
      conditions.push('LOWER(U.USRNAME) = ?');
      params.push(filters.email.trim().toLowerCase());
    }
    if (filters?.codiceUtente) {
      conditions.push('U.CODUTE = ?');
      params.push(filters.codiceUtente);
    }

    const query = `SELECT COUNT(*) AS TOTAL FROM UTENTI U INNER JOIN UTENTI_CONFIG G ON U.CODUTE = G.CODUTE WHERE 1=1 ${conditions.map((condition) => `AND ${condition}`).join(' ')}`;
    const rows = (await Orm.query(this.accessiOptions.databaseOptions, query, params, false)) as Array<Record<string, unknown>>;
    const row = rows[0];
    return Number(row?.TOTAL ?? row?.total ?? 0) || 0;
  }

  private async loadExtensionFieldsForUsers(
    codiceUtenti: number[],
  ): Promise<Map<string, Map<number, Record<string, unknown>[]>>> {
    const byObjectKey = new Map<string, Map<number, Record<string, unknown>[]>>();
    const extensions = this.accessiOptions.extensionFieldsOptions ?? [];
    const uniqueCodes = Array.from(new Set(codiceUtenti));

    for (const ext of extensions) {
      const grouped = new Map<number, Record<string, unknown>[]>();

      for (const chunk of this.chunkArray(uniqueCodes, 500)) {
        if (chunk.length === 0) {
          continue;
        }

        const placeholders = chunk.map(() => '?').join(', ');
        const rows = (await Orm.query(
          ext.databaseOptions,
          `SELECT ${ext.tableJoinFieldName} AS __joinkey, ${ext.tableFields.join(', ')} FROM ${ext.tableName} WHERE ${ext.tableJoinFieldName} IN (${placeholders})`,
          chunk,
        )).map(RestUtilities.convertKeysToCamelCase) as Array<Record<string, unknown>>;

        for (const row of rows) {
          const { __joinkey, ...rest } = row;
          const key = Number(__joinkey);
          if (!Number.isFinite(key)) {
            continue;
          }

          const bucket = grouped.get(key);
          if (bucket) {
            bucket.push(rest);
          } else {
            grouped.set(key, [rest]);
          }
        }
      }

      byObjectKey.set(ext.objectKey, grouped);
    }

    return byObjectKey;
  }

  private chunkArray<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let index = 0; index < items.length; index += size) {
      chunks.push(items.slice(index, index + size));
    }
    return chunks;
  }

  /** Cerca il codice interno per email normalizzata. Il chiamante deve gestire il caso senza righe. */
  async getCodiceUtenteByEmail(email: string): Promise<{ codiceUtente: number }> {
    try {
      const query = `SELECT CODUTE as codice_utente FROM UTENTI WHERE LOWER(USRNAME) = ?`;
      const result = await Orm.query(this.accessiOptions.databaseOptions, query, [
        email.trim().toLowerCase(),
      ]);
      return result.map(RestUtilities.convertKeysToCamelCase)[0] as { codiceUtente: number };
    } catch (error) {
      throw error;
    }
  }

  /** Recupera il profilo locale usato dal login, compresi filtri Accessi eventualmente presenti. */
  async getUserByEmail(email: string): Promise<UserDto | null> {
    const configColumns = await getTableColumns(this.accessiOptions, 'UTENTI_CONFIG');
    const utentiColumns = await getTableColumns(this.accessiOptions, 'UTENTI');
    const query = `
            SELECT 
                U.CODUTE AS codice_utente, 
                U.USRNAME AS email, 
                U.FLGGDPR AS flag_gdpr,
                U.DATSCAPWD as data_scadenza_password,
                U.STAREG AS stato_registrazione, 
                ${optionalColumn(utentiColumns, 'ENABLEIA', 'U', 'enable_ia')},
                C.COGNOME AS cognome, 
                C.NOME AS nome, 
                C.AVATAR AS avatar, 
                C.FLG2FATT AS flag_due_fattori,
                C.FLGPWDLESS AS passwordless_login_enabled,
                C.CODLINGUA AS codice_lingua, 
                C.CELLULARE AS cellulare, 
                C.FLGSUPER AS flag_super,
                C.FLGADMINCONFIG AS flag_admin_configurator,
                COALESCE(C.FLGPASSWORD, 1) AS password_login_enabled,
                C.PAGDEF AS pagina_default,
                ${optionalColumn(configColumns, 'CAUMOV', 'C', 'caumov')},
                ${optionalColumn(configColumns, 'NUMMAC', 'C', 'nummac')},
                ${optionalColumn(configColumns, 'RAGSOCCLI', 'C', 'rag_soc_cli', false)},
                ${APPLICATION_FLAG_FIELDS.map((field) => optionalColumn(configColumns, field.column, 'C', field.alias)).join(',\n                ')}
            FROM UTENTI U
            INNER JOIN UTENTI_CONFIG C ON C.CODUTE = U.CODUTE
            WHERE LOWER(U.USRNAME) = ?
        `;

    const utenti = (await Orm.query(this.accessiOptions.databaseOptions, query, [email]).then(
      (results) => results.map(RestUtilities.convertKeysToCamelCase),
    )) as UserDto[];

    const user = utenti[0];
    if (!user) return null;

    const filtro = (await this.filtriService.getFiltriUser(user.codiceUtente))[0];
    if (filtro) {
      const filterValues: Record<string, unknown> = {};

      Object.entries(FILTRI_UTENTE_DB_MAPPING).forEach(([key]) => {
        if (key in filtro) {
          filterValues[key] = filtro[key as keyof FiltriUtente];
        }
      });

      Object.assign(user, filterValues);
    }

    return this.normalizeUserFlags(user);
  }

  async insertUserFilters(codiceUtente: number, filterData: RegisterRequest): Promise<void> {
    await this.filtriService.upsertFiltriUtente(codiceUtente, filterData);
  }

  /**
   * Crea utente, configurazione e filtri. La registrazione pubblica resta in stato `INVIO` e non puo
   * impostare privilegi, ruoli o grant; soltanto flussi backend fidati possono usare `allowPrivilegedFields`.
   */
  async register(
    registrationData: RegisterRequest,
    options?: { allowPrivilegedFields?: boolean; initialState?: StatoRegistrazione },
  ): Promise<number> {
    try {
      const allowPrivilegedFields = options?.allowPrivilegedFields === true;
      const normalizedEmail = this.normalizeEmail(registrationData.email);

      if (registrationData.flagDueFattori !== undefined && typeof registrationData.flagDueFattori !== 'boolean') {
        throw new BadRequestException('Il flag due fattori deve essere booleano.');
      }
      if (registrationData.flagDueFattori && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        throw new BadRequestException('Per attivare i codici di accesso serve un indirizzo email valido.');
      }

      if (
        !allowPrivilegedFields &&
        (registrationData.flagSuper !== undefined ||
          registrationData.flagAdminConfigurator !== undefined ||
          registrationData.flagDueFattori !== undefined ||
          registrationData.roles !== undefined ||
          registrationData.permissions !== undefined)
      ) {
        throw new Error('I campi privilegiati non sono consentiti nella registrazione pubblica.');
      }

      await this.validateApplicationFields(registrationData);
      await this.ensureEmailIsAvailable(normalizedEmail);

      const queryUtenti = `INSERT INTO UTENTI (USRNAME, STAREG) VALUES (?,?) RETURNING CODUTE`;
      // Public/local registrations keep the historic INVIO state; trusted master or SSO flows may opt into CONF.
      const paramsUtenti = [normalizedEmail, options?.initialState ?? StatoRegistrazione.INVIO];

      // Utente e configurazione sono creati in un'unica transazione; filtri e assegnazioni restano
      // fuori perché delegati a servizi dedicati.
      const codiceUtente = await Orm.withTransaction(
        this.accessiOptions.databaseOptions,
        async (transaction) => {
          const insertedUsers = await Orm.transactionQuery<unknown>(
            transaction,
            queryUtenti,
            paramsUtenti,
          );

          const insertedUser = (Array.isArray(insertedUsers) ? insertedUsers[0] : insertedUsers) as Record<string, unknown> | undefined;
          const newCodiceUtente = Number(
            insertedUser?.CODUTE ?? insertedUser?.codute,
          );
          if (!newCodiceUtente) {
            throw new Error('Creazione utente non riuscita: impossibile recuperare CODUTE.');
          }

      const utentiConfigFields = ['CODUTE', 'COGNOME', 'NOME'];
      const utentiConfigPlaceholders = ['?', '?', '?'];
      const utentiConfigParams: unknown[] = [newCodiceUtente, registrationData.cognome, registrationData.nome];

      const optionalFields: OptionalField<unknown>[] = [
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
        {
          key: 'caumov',
          dbField: 'CAUMOV',
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

        for (const flag of APPLICATION_FLAG_FIELDS) {
          optionalFields.push({
            key: flag.key,
            dbField: flag.column,
            transform: (v) => (v ? 1 : 0),
          });
        }
      }

      for (const field of optionalFields) {
        const value = (registrationData as unknown as Record<string, unknown>)[field.key];
        if (value !== undefined && value !== null) {
          utentiConfigFields.push(field.dbField);
          utentiConfigPlaceholders.push('?');
          utentiConfigParams.push(field.transform ? field.transform(value) : value);
        }
      }

      const queryUtentiConfig = `INSERT INTO UTENTI_CONFIG (${utentiConfigFields.join(
        ', ',
      )}) VALUES (${utentiConfigPlaceholders.join(', ')})`;
          await Orm.transactionQuery(transaction, queryUtentiConfig, utentiConfigParams);

          return newCodiceUtente;
        },
      );

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

  /**
   * Aggiorna il profilo utente e i filtri. Le modifiche a stato, ruoli, grant e flag amministrativi richiedono
   * `allowPrivilegedChanges`; gli array ruolo/grant passati in un flusso fidato sostituiscono le assegnazioni.
   */
  async updateUser(
    codiceUtente: number,
    user: UserDto,
    options?: { allowPrivilegedChanges?: boolean },
  ): Promise<void> {
    try {
      if (!codiceUtente) throw new Error('Impossibile aggiornare senza codice utente.');
      const allowPrivilegedChanges = options?.allowPrivilegedChanges === true;

      for (const value of [user.flagDueFattori, user.passwordlessLoginEnabled]) {
        if (value !== undefined && typeof value !== 'boolean') throw new BadRequestException('Le policy di autenticazione devono essere booleane.');
      }

      if (
        !allowPrivilegedChanges &&
        (user.statoRegistrazione !== undefined ||
          user.flagSuper !== undefined ||
          user.flagAdminConfigurator !== undefined ||
          user.passwordLoginEnabled !== undefined ||
          user.passwordlessLoginEnabled !== undefined ||
          user.flagDueFattori !== undefined ||
          user.roles !== undefined ||
          user.permissions !== undefined)
      ) {
        throw new Error('Non e consentito modificare campi privilegiati.');
      }

      if (user.flagDueFattori !== undefined || user.passwordlessLoginEnabled !== undefined || user.email !== undefined) {
        const current = await this.getAuthenticatedUserSnapshot(codiceUtente);
        if (!current) throw new BadRequestException('Utente non trovato.');
        const twoFactor = user.flagDueFattori ?? current.flagDueFattori;
        const passwordless = user.passwordlessLoginEnabled ?? current.passwordlessLoginEnabled;
        if (passwordless && !twoFactor) throw new BadRequestException('Il login senza password richiede il codice di accesso attivo.');
        if (twoFactor && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((user.email ?? current.email ?? '').trim())) {
          throw new BadRequestException('Per attivare i codici di accesso serve un indirizzo email valido.');
        }
      }

      const { configColumns } = await this.validateApplicationFields(user);
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
      if (allowPrivilegedChanges && user.enableIa !== undefined) {
        utentiUpdates.push('enableia = ?');
        utentiParams.push(user.enableIa ? 1 : 0);
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
        utentiConfigParams.push(user.flagDueFattori ? 1 : 0);
      }
      if (user.passwordlessLoginEnabled !== undefined) {
        utentiConfigUpdates.push('flgpwdless = ?');
        utentiConfigParams.push(user.passwordlessLoginEnabled ? 1 : 0);
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
      if (allowPrivilegedChanges && user.caumov !== undefined) {
        utentiConfigUpdates.push('caumov = ?');
        utentiConfigParams.push(user.caumov);
      }
      if (allowPrivilegedChanges) {
        for (const flag of APPLICATION_FLAG_FIELDS) {
          const value = (user as unknown as Record<string, unknown>)[flag.key];
          if (value !== undefined) {
            utentiConfigUpdates.push(`${flag.column.toLowerCase()} = ?`);
            utentiConfigParams.push(value ? 1 : 0);
          }
        }
      }
      if (allowPrivilegedChanges && user.passwordLoginEnabled !== undefined) {
        utentiConfigUpdates.push('flgpassword = ?');
        utentiConfigParams.push(user.passwordLoginEnabled ? 1 : 0);
      }
      if (user.paginaDefault !== undefined) {
        utentiConfigUpdates.push('pagdef = ?');
        utentiConfigParams.push(user.paginaDefault);
      }
      if (user.jsonMetadata !== undefined) {
        utentiConfigUpdates.push('json_metadata = ?');
        utentiConfigParams.push(user.jsonMetadata);
      }
      if (user.ragSocCli !== undefined && (user.ragSocCli !== null || configColumns?.has('RAGSOCCLI'))) {
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

      if (allowPrivilegedChanges && Array.isArray(user.roles)) {
        await this.permissionService.assignRolesToUser(codiceUtente, user.roles);
      }

      if (allowPrivilegedChanges && Array.isArray(user.permissions)) {
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

  /** Eliminazione logica: imposta lo stato `DELETE` senza cancellare lo storico o i collegamenti SSO. */
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

  /** Cambia esplicitamente lo stato di registrazione; usare questa API per blocco, conferma o eliminazione logica. */
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
      return await Orm.executeMultiple(this.accessiOptions.databaseOptions, [
        { query: 'INSERT INTO UTENTI_GDPR (CODUTE, GDPR) VALUES (?, ?)', params: [codiceUtente, 'true'] },
        { query: 'UPDATE UTENTI SET FLGGDPR = 1, DATGDPR = CURRENT_DATE WHERE CODUTE = ?', params: [codiceUtente] },
      ]);
    } catch (error) {
      throw error;
    }
  }

  /**
   * Forza l'invio dell'email di reset password per un utente. Operazione amministrativa.
   * Richiede un servizio email configurato: altrimenti solleva ACCESSI_EMAIL_NOT_CONFIGURED.
   */
  public async forcePasswordReset(codiceUtente: number): Promise<void> {
    assertEmailConfigured(this.accessiOptions);
    const rows = await this.getUsers({ codiceUtente });
    const email = rows[0]?.utente?.email;
    if (typeof email !== 'string' || email.trim() === '') {
      throw new NotFoundException(`Nessun utente con email per il codice ${codiceUtente}.`);
    }
    await this.emailService.sendPasswordResetEmail(email);
  }

  /**
   * Forza l'invio dell'email di reset a tutti gli utenti la cui password non e ancora nel formato
   * moderno (`scrypt$...`), cioe' legacy grezza o `scrypt-legacy` non piu verificabile. Utile quando
   * la `encryptionKey` storica e perduta. Richiede email configurata. Ritorna quanti utenti hanno
   * ricevuto l'email.
   */
  public async forcePasswordResetForLegacyPasswords(): Promise<number> {
    assertEmailConfigured(this.accessiOptions);
    const rows = await Orm.query(
      this.accessiOptions.databaseOptions,
      `SELECT U.CODUTE AS codice_utente, U.USRNAME AS email
       FROM UTENTI U
       JOIN UTENTI_PWD P ON P.CODUTE = U.CODUTE
       WHERE P.PWD IS NOT NULL AND P.PWD NOT STARTING WITH 'scrypt$'`,
      [],
      false,
    );

    let sent = 0;
    for (const row of rows as Array<Record<string, unknown>>) {
      const raw = RestUtilities.convertKeysToCamelCase(row) as Record<string, unknown>;
      const email = typeof raw.email === 'string' ? raw.email.trim() : '';
      if (email === '') continue;
      await this.emailService.sendPasswordResetEmail(email);
      sent += 1;
    }
    return sent;
  }
}
