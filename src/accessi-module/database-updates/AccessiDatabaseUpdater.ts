import { Injectable, Inject, OnModuleInit } from "@nestjs/common";
import { DatabaseUpdater } from "../../DatabaseUpdater";
import { AccessiOptions } from "../AccessiModule";
import { Orm } from "../../Orm";
import { Logger } from "../../Logger";

type AccessiUpdateStep = {
  fromVersion: string;
  toVersion: string;
  description: string;
  apply: (options: AccessiOptions) => Promise<void>;
};

@Injectable()
export class AccessiDatabaseUpdater extends DatabaseUpdater implements OnModuleInit {
  protected static override logger: Logger = new Logger(AccessiDatabaseUpdater.name);

  private static readonly updates: AccessiUpdateStep[] = [
    {
      fromVersion: "1.0.0",
      toVersion: "1.1.0",
      description: "Aggiunge filtro postazione, colonna IDXPOS e menu verifica RFID",
      apply: async (options) => {
        await AccessiDatabaseUpdater.upsertFiltroTipo(options, 20, "POSTAZIONE", "IDXPOS", undefined);
        await AccessiDatabaseUpdater.ensureColumn(
          options,
          "FILTRI",
          "IDXPOS SMALLINT",
          "IDXPOS",
          "idx della postazione nella tabella ANTENNE_POS di PROLAV"
        );
        await AccessiDatabaseUpdater.upsertMenu(options, {
          CODMNU: "MNUVERRFID",
          DESMNU: "Verifica RFID",
          CODGRP: "F",
          FLGENABLED: 1,
          ICON: "hardware-chip-outline",
          ORDINE: 10,
          CODTIP: "M",
          PAGINA: "/verifica-rfid",
          RIFMENU: null,
        });
      },
    },
    {
      fromVersion: "1.1.0",
      toVersion: "1.1.1",
      description: "Aggiunge FLGENABLED su FILTRI_TIPO",
      apply: async (options) => {
        const columnCreated = await AccessiDatabaseUpdater.ensureColumn(
          options,
          "FILTRI_TIPO",
          "FLGENABLED SMALLINT DEFAULT 1 NOT NULL",
          "FLGENABLED"
        );

        if (!columnCreated) {
          await Orm.execute(
            options.databaseOptions,
            "UPDATE FILTRI_TIPO SET FLGENABLED = 1 WHERE FLGENABLED IS NULL"
          );
        }
      },
    },
    {
      fromVersion: "1.1.1",
      toVersion: "1.1.2",
      description: "Aggiunge filtro vettore e colonna CODVET",
      apply: async (options) => {
        await AccessiDatabaseUpdater.upsertFiltroTipo(options, 30, "VETTORE", "CODVET", 1);
        await AccessiDatabaseUpdater.ensureColumn(
          options,
          "FILTRI",
          "CODVET INTEGER",
          "CODVET",
          "CODICE DEL VETTORE DA INSERIRE SE COME FILTRO HA 30"
        );
      },
    },
    {
      fromVersion: "1.1.2",
      toVersion: "1.1.3",
      description: "Aggiunge FLGADMINCONFIG e inizializza PARAMETRI",
      apply: async (options) => {
        await AccessiDatabaseUpdater.ensureColumn(
          options,
          "UTENTI_CONFIG",
          "FLGADMINCONFIG SMALLINT DEFAULT 0",
          "FLGADMINCONFIG",
          "flag utente configuratore dei menu amministratore"
        );
        await AccessiDatabaseUpdater.createParametersTable(options.databaseOptions);
      },
    },
    {
      fromVersion: "1.1.3",
      toVersion: "1.1.4",
      description: "Aggiunge sequence e trigger per RUOLI",
      apply: async (options) => {
        if (!(await AccessiDatabaseUpdater.generatorExists(options.databaseOptions, "GEN_RUOLI_ID"))) {
          await Orm.execute(options.databaseOptions, "CREATE SEQUENCE GEN_RUOLI_ID");
        }

        if (!(await AccessiDatabaseUpdater.triggerExists(options.databaseOptions, "RUOLI_BI"))) {
          await Orm.execute(
            options.databaseOptions,
            `CREATE TRIGGER RUOLI_BI FOR RUOLI
ACTIVE BEFORE INSERT POSITION 0
AS
BEGIN
  IF (NEW.CODRUO IS NULL) THEN
    NEW.CODRUO = GEN_ID(GEN_RUOLI_ID,1);
END`
          );
        }
      },
    },
    {
      fromVersion: "1.1.4",
      toVersion: "1.1.5",
      description: "Aggiunge NOTE su MENU",
      apply: async (options) => {
        await AccessiDatabaseUpdater.ensureColumn(
          options,
          "MENU",
          "NOTE VARCHAR(1000)",
          "NOTE"
        );
      },
    },
    {
      fromVersion: "1.1.5",
      toVersion: "1.1.6",
      description: "Aggiunge NUMMAC su UTENTI_CONFIG",
      apply: async (options) => {
        await AccessiDatabaseUpdater.ensureColumn(
          options,
          "UTENTI_CONFIG",
          "NUMMAC INTEGER",
          "NUMMAC",
          'Numero macchina DESPOST PROLAV'
        );
      },
    },
    {
      fromVersion: "1.1.6",
      toVersion: "1.2.0",
      description: "Aggiunge policy password e identita esterne per Accessi/SSO",
      apply: async (options) => {
        await AccessiDatabaseUpdater.ensureColumn(
          options,
          "UTENTI_CONFIG",
          "FLGPASSWORD SMALLINT DEFAULT 1 NOT NULL",
          "FLGPASSWORD",
          "1 consente login locale con password; 0 rende utente SSO-only. Default 1 preserva utenti esistenti.",
        );
        await AccessiDatabaseUpdater.ensureFederatedIdentitySchema(options);
      },
    },
    {
      fromVersion: "1.2.0",
      toVersion: "1.3.0",
      description: "Aggiunge il catalogo dei provider SSO e il vincolo sulle identita esterne",
      apply: async (options) => {
        await AccessiDatabaseUpdater.ensureFederatedProviderSchema(options);
      },
    },
    {
      fromVersion: '1.3.0',
      toVersion: '1.4.0',
      description: 'Aggiunge codici monouso per 2FA e policy di accesso senza password',
      apply: async (options) => {
        await AccessiDatabaseUpdater.ensureColumn(options, 'UTENTI_CONFIG', 'FLG2FATT SMALLINT DEFAULT 0', 'FLG2FATT');
        await AccessiDatabaseUpdater.ensureColumn(options, 'UTENTI_CONFIG', 'FLGPWDLESS SMALLINT DEFAULT 0 NOT NULL', 'FLGPWDLESS', '1 consente accesso con solo codice email, richiede FLG2FATT=1. Non modifica FLGPASSWORD/SSO.');
        if (!(await AccessiDatabaseUpdater.tableExists(options.databaseOptions, 'ACCESSI_2FA'))) {
          await Orm.execute(options.databaseOptions, `CREATE TABLE ACCESSI_2FA (
            CHALLENGE_ID VARCHAR(64) CHARACTER SET ASCII NOT NULL PRIMARY KEY,
            CODUTE INTEGER NOT NULL REFERENCES UTENTI (CODUTE) ON DELETE CASCADE,
            EMAIL VARCHAR(254) CHARACTER SET UTF8 NOT NULL,
            AUTHMODE VARCHAR(12) CHARACTER SET ASCII NOT NULL,
            IDNKEY VARCHAR(64) CHARACTER SET ASCII,
            CODEHASH VARCHAR(64) CHARACTER SET ASCII NOT NULL,
            CREATED_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
            EXPIRES_AT TIMESTAMP NOT NULL,
            SENT_AT TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
            ATTEMPTS SMALLINT DEFAULT 0 NOT NULL,
            SENDS SMALLINT DEFAULT 1 NOT NULL
          )`);
        }
        if (!(await AccessiDatabaseUpdater.indexExists(options, 'IDX_ACCESSI_2FA_USER'))) {
          await Orm.execute(options.databaseOptions, 'CREATE INDEX IDX_ACCESSI_2FA_USER ON ACCESSI_2FA (CODUTE, CREATED_AT)');
        }
        if (!(await AccessiDatabaseUpdater.indexExists(options, 'IDX_ACCESSI_2FA_EXP'))) {
          await Orm.execute(options.databaseOptions, 'CREATE INDEX IDX_ACCESSI_2FA_EXP ON ACCESSI_2FA (EXPIRES_AT)');
        }
      },
    },
  ];

  constructor(
    @Inject("ACCESSI_OPTIONS") private readonly accessiOptions: AccessiOptions
  ) {
    super();
  }

  async onModuleInit(): Promise<void> {
    if (this.accessiOptions.autoUpdateDatabase === false) {
      AccessiDatabaseUpdater.logger.info("Aggiornamento automatico database accessi disabilitato da configurazione.");
      return;
    }

    AccessiDatabaseUpdater.logger.info("Avvio updater database accessi.");
    await AccessiDatabaseUpdater.run(this.accessiOptions);
    AccessiDatabaseUpdater.logger.info("Updater database accessi completato.");
  }

  static async run(options: AccessiOptions): Promise<void> {
    const startedAt = performance.now();
    this.logger.info(
      `Verifica schema accessi su ${options.databaseOptions.host ?? "?"}:${options.databaseOptions.port ?? "?"} -> ${options.databaseOptions.database ?? "?"}`
    );
    await this.createParametersTable(options.databaseOptions);
    this.logger.info("Tabella PARAMETRI verificata.");

    const currentVersion = await this.getDatabaseVersion(options.databaseOptions);
    const currentIndex = this.updates.findIndex(
      (update) => update.toVersion === currentVersion
    );
    const startIndex = currentIndex >= 0 ? currentIndex + 1 : 0;

    if (currentVersion && currentIndex === this.updates.length - 1) {
      this.logger.info(`Database accessi gia' all'ultima versione disponibile (${currentVersion}).`);
    } else if (currentVersion && currentIndex >= 0) {
      this.logger.info(`Database accessi rilevato alla versione ${currentVersion}.`);
    } else if (currentVersion) {
      this.logger.warning(
        `Versione database accessi non riconosciuta (${currentVersion}). Verifico tutti gli update idempotenti.`
      );
    } else {
      this.logger.warning(
        "Versione database accessi assente. Verifico tutti gli update idempotenti."
      );
    }

    for (let index = startIndex; index < this.updates.length; index++) {
      const update = this.updates[index];
      const stepStartedAt = performance.now();
      this.logger.info(
        `Applico aggiornamento accessi ${update.fromVersion} -> ${update.toVersion}: ${update.description}`
      );
      await update.apply(options);
      await this.setDatabaseVersion(options.databaseOptions, update.toVersion);
      this.logger.info(
        `Aggiornamento accessi ${update.toVersion} completato in ${(performance.now() - stepStartedAt).toFixed(2)} ms`
      );
    }

    this.logger.info(
      `Verifica/aggiornamento database accessi completato in ${(performance.now() - startedAt).toFixed(2)} ms`
    );
  }

  static async getCurrentVersion(options: AccessiOptions): Promise<string | null> {
    return await this.getDatabaseVersion(options.databaseOptions);
  }

  static getLatestVersion(): string {
    return this.updates[this.updates.length - 1]?.toVersion ?? "0.0.0";
  }

  private static async ensureColumn(
    options: AccessiOptions,
    tableName: string,
    columnDefinition: string,
    columnName: string,
    comment?: string
  ): Promise<boolean> {
    const exists = await this.columnExists(
      options.databaseOptions,
      tableName,
      columnName
    );

    if (!exists) {
      await Orm.execute(
        options.databaseOptions,
        `ALTER TABLE ${tableName} ADD ${columnDefinition}`
      );
    }

    if (comment) {
      await Orm.execute(
        options.databaseOptions,
        `COMMENT ON COLUMN ${tableName}.${columnName} IS '${comment.replace(/'/g, "''")}'`
      );
    }

    return !exists;
  }

  /** Crea in modo idempotente la struttura necessaria al mapping SSO generico. */
  private static async ensureFederatedIdentitySchema(options: AccessiOptions): Promise<void> {
    if (!(await this.tableExists(options.databaseOptions, "UTENTI_IDENTITA_EXT"))) {
      await Orm.execute(options.databaseOptions, `CREATE TABLE UTENTI_IDENTITA_EXT (
        IDNKEY CHAR(64) CHARACTER SET ASCII NOT NULL,
        CODUTE INTEGER NOT NULL,
        PROVIDER VARCHAR(64) CHARACTER SET ASCII NOT NULL,
        SUBJECT VARCHAR(512) CHARACTER SET UTF8 NOT NULL,
        FLGATTIVO SMALLINT DEFAULT 1 NOT NULL,
        DATINS TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        DATLASTLOGIN TIMESTAMP,
        DATDISATT TIMESTAMP,
        NOTA VARCHAR(500) CHARACTER SET UTF8
      )`);
    }

    if (!(await this.constraintExists(options, "PK_UTEIDEXT"))) {
      await Orm.execute(options.databaseOptions, "ALTER TABLE UTENTI_IDENTITA_EXT ADD CONSTRAINT PK_UTEIDEXT PRIMARY KEY (IDNKEY)");
    }
    if (!(await this.constraintExists(options, "FK_UTEIDEXT_UTENTE"))) {
      await Orm.execute(options.databaseOptions, "ALTER TABLE UTENTI_IDENTITA_EXT ADD CONSTRAINT FK_UTEIDEXT_UTENTE FOREIGN KEY (CODUTE) REFERENCES UTENTI (CODUTE) ON DELETE CASCADE");
    }
    if (!(await this.constraintExists(options, "CK_UTEIDEXT_ATTIVO"))) {
      await Orm.execute(options.databaseOptions, "ALTER TABLE UTENTI_IDENTITA_EXT ADD CONSTRAINT CK_UTEIDEXT_ATTIVO CHECK (FLGATTIVO IN (0, 1))");
    }
    if (!(await this.indexExists(options, "IDX_UTEIDEXT_CODUTE"))) {
      await Orm.execute(options.databaseOptions, "CREATE INDEX IDX_UTEIDEXT_CODUTE ON UTENTI_IDENTITA_EXT (CODUTE)");
    }

    for (const statement of [
      "COMMENT ON TABLE UTENTI_IDENTITA_EXT IS 'Associa identita esterne gia verificate dal backend agli utenti Accessi; non memorizza token, segreti o claim SSO.'",
      "COMMENT ON COLUMN UTENTI_IDENTITA_EXT.IDNKEY IS 'SHA-256 calcolato dalla libreria su provider e subject; chiave tecnica di lookup.'",
      "COMMENT ON COLUMN UTENTI_IDENTITA_EXT.CODUTE IS 'Codice dell utente Accessi proprietario dell identita esterna.'",
      "COMMENT ON COLUMN UTENTI_IDENTITA_EXT.PROVIDER IS 'Namespace stabile dichiarato dal backend, non configurazione o segreto del provider SSO.'",
      "COMMENT ON COLUMN UTENTI_IDENTITA_EXT.SUBJECT IS 'Identificativo opaco e stabile gia verificato dal backend presso il provider.'",
      "COMMENT ON COLUMN UTENTI_IDENTITA_EXT.FLGATTIVO IS '1 identita utilizzabile per login; 0 collegamento disabilitato logicamente.'",
      "COMMENT ON COLUMN UTENTI_IDENTITA_EXT.DATINS IS 'Istante di creazione del collegamento.'",
      "COMMENT ON COLUMN UTENTI_IDENTITA_EXT.DATLASTLOGIN IS 'Ultimo login SSO riuscito con questa identita.'",
      "COMMENT ON COLUMN UTENTI_IDENTITA_EXT.DATDISATT IS 'Istante di disabilitazione logica del collegamento.'",
      "COMMENT ON COLUMN UTENTI_IDENTITA_EXT.NOTA IS 'Nota amministrativa opzionale; non memorizzare token o dati personali non necessari.'",
    ]) {
      await Orm.execute(options.databaseOptions, statement);
    }
  }

  /** Crea il catalogo provider SSO, importa le chiavi storiche e vincola le identita al catalogo. */
  private static async ensureFederatedProviderSchema(options: AccessiOptions): Promise<void> {
    if (!(await this.tableExists(options.databaseOptions, "SSO_PROVIDER"))) {
      await Orm.execute(options.databaseOptions, `CREATE TABLE SSO_PROVIDER (
        PROVIDER VARCHAR(64) CHARACTER SET ASCII NOT NULL,
        DESCRIZIONE VARCHAR(160) CHARACTER SET UTF8 NOT NULL,
        FLGATTIVO SMALLINT DEFAULT 1 NOT NULL,
        DATINS TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
        NOTA VARCHAR(500) CHARACTER SET UTF8
      )`);
    }

    if (!(await this.constraintExists(options, "PK_SSO_PROVIDER"))) {
      await Orm.execute(options.databaseOptions, "ALTER TABLE SSO_PROVIDER ADD CONSTRAINT PK_SSO_PROVIDER PRIMARY KEY (PROVIDER)");
    }
    if (!(await this.constraintExists(options, "CK_SSO_PROVIDER_ATTIVO"))) {
      await Orm.execute(options.databaseOptions, "ALTER TABLE SSO_PROVIDER ADD CONSTRAINT CK_SSO_PROVIDER_ATTIVO CHECK (FLGATTIVO IN (0, 1))");
    }

    // Preserve existing installations before applying the referential constraint.
    await Orm.execute(options.databaseOptions, `INSERT INTO SSO_PROVIDER (PROVIDER, DESCRIZIONE, FLGATTIVO, NOTA)
      SELECT DISTINCT I.PROVIDER, I.PROVIDER, 1, NULL
      FROM UTENTI_IDENTITA_EXT I
      WHERE NOT EXISTS (SELECT 1 FROM SSO_PROVIDER P WHERE P.PROVIDER = I.PROVIDER)`);

    if (!(await this.constraintExists(options, "FK_UTEIDEXT_PROVIDER"))) {
      await Orm.execute(options.databaseOptions, "ALTER TABLE UTENTI_IDENTITA_EXT ADD CONSTRAINT FK_UTEIDEXT_PROVIDER FOREIGN KEY (PROVIDER) REFERENCES SSO_PROVIDER (PROVIDER)");
    }
    if (!(await this.indexExists(options, "IDX_UTEIDEXT_PROVIDER"))) {
      await Orm.execute(options.databaseOptions, "CREATE INDEX IDX_UTEIDEXT_PROVIDER ON UTENTI_IDENTITA_EXT (PROVIDER)");
    }

    for (const statement of [
      "COMMENT ON TABLE SSO_PROVIDER IS 'Catalogo dei provider SSO ammessi da Accessi. Configurazioni, issuer, token e segreti restano nel backend ospitante.'",
      "COMMENT ON COLUMN SSO_PROVIDER.PROVIDER IS 'Chiave ASCII stabile configurata anche nel backend. Deve distinguere tenant e ambiente quando necessario.'",
      "COMMENT ON COLUMN SSO_PROVIDER.DESCRIZIONE IS 'Descrizione amministrativa leggibile del provider SSO.'",
      "COMMENT ON COLUMN SSO_PROVIDER.FLGATTIVO IS '1 consente nuovi login e collegamenti SSO; 0 conserva lo storico ma blocca le nuove sessioni.'",
      "COMMENT ON COLUMN SSO_PROVIDER.DATINS IS 'Istante di censimento del provider nel catalogo Accessi.'",
      "COMMENT ON COLUMN SSO_PROVIDER.NOTA IS 'Nota amministrativa opzionale; non memorizzare token, segreti o dati personali non necessari.'",
      "COMMENT ON COLUMN UTENTI_IDENTITA_EXT.PROVIDER IS 'Chiave del catalogo SSO_PROVIDER. Insieme a SUBJECT identifica l''identita esterna verificata dal backend.'",
    ]) {
      await Orm.execute(options.databaseOptions, statement);
    }
  }

  private static async constraintExists(options: AccessiOptions, name: string): Promise<boolean> {
    const rows = await Orm.query(
      options.databaseOptions,
      "SELECT 1 FROM RDB$RELATION_CONSTRAINTS WHERE RDB$CONSTRAINT_NAME = ?",
      [name],
    );
    return rows.length > 0;
  }

  private static async indexExists(options: AccessiOptions, name: string): Promise<boolean> {
    const rows = await Orm.query(
      options.databaseOptions,
      "SELECT 1 FROM RDB$INDICES WHERE RDB$INDEX_NAME = ?",
      [name],
    );
    return rows.length > 0;
  }

  private static async upsertFiltroTipo(
    options: AccessiOptions,
    tipfil: number,
    desfil: string,
    fldfil: string,
    flgEnabled?: number
  ): Promise<void> {
    const hasEnabledColumn = await this.columnExists(
      options.databaseOptions,
      "FILTRI_TIPO",
      "FLGENABLED"
    );

    const existing = await Orm.query(
      options.databaseOptions,
      "SELECT TIPFIL FROM FILTRI_TIPO WHERE TIPFIL = ?",
      [tipfil]
    );

    if (existing.length === 0) {
      if (hasEnabledColumn && flgEnabled !== undefined) {
        await Orm.execute(
          options.databaseOptions,
          "INSERT INTO FILTRI_TIPO (TIPFIL, DESFIL, FLDFIL, FLGENABLED) VALUES (?, ?, ?, ?)",
          [tipfil, desfil, fldfil, flgEnabled]
        );
        return;
      }

      await Orm.execute(
        options.databaseOptions,
        "INSERT INTO FILTRI_TIPO (TIPFIL, DESFIL, FLDFIL) VALUES (?, ?, ?)",
        [tipfil, desfil, fldfil]
      );
      return;
    }

    if (hasEnabledColumn && flgEnabled !== undefined) {
      await Orm.execute(
        options.databaseOptions,
        "UPDATE FILTRI_TIPO SET DESFIL = ?, FLDFIL = ?, FLGENABLED = COALESCE(FLGENABLED, ?) WHERE TIPFIL = ?",
        [desfil, fldfil, flgEnabled, tipfil]
      );
      return;
    }

    await Orm.execute(
      options.databaseOptions,
      "UPDATE FILTRI_TIPO SET DESFIL = ?, FLDFIL = ? WHERE TIPFIL = ?",
      [desfil, fldfil, tipfil]
    );
  }

  private static async upsertMenu(
    options: AccessiOptions,
    menu: {
      CODMNU: string;
      DESMNU: string;
      CODGRP: string;
      FLGENABLED: number;
      ICON: string;
      ORDINE: number;
      CODTIP: string;
      PAGINA: string;
      RIFMENU: string | null;
    }
  ): Promise<void> {
    const existing = await Orm.query(
      options.databaseOptions,
      "SELECT CODMNU FROM MENU WHERE CODMNU = ?",
      [menu.CODMNU]
    );

    if (existing.length === 0) {
      await Orm.execute(
        options.databaseOptions,
        `INSERT INTO MENU (CODMNU, DESMNU, CODGRP, FLGENABLED, ICON, ORDINE, CODTIP, PAGINA, RIFMENU)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          menu.CODMNU,
          menu.DESMNU,
          menu.CODGRP,
          menu.FLGENABLED,
          menu.ICON,
          menu.ORDINE,
          menu.CODTIP,
          menu.PAGINA,
          menu.RIFMENU,
        ]
      );
      return;
    }

    await Orm.execute(
      options.databaseOptions,
      `UPDATE MENU
       SET DESMNU = ?,
           CODGRP = ?,
           FLGENABLED = COALESCE(FLGENABLED, ?),
           ICON = ?,
           ORDINE = ?,
           CODTIP = ?,
           PAGINA = ?,
           RIFMENU = ?
       WHERE CODMNU = ?`,
      [
        menu.DESMNU,
        menu.CODGRP,
        menu.FLGENABLED,
        menu.ICON,
        menu.ORDINE,
        menu.CODTIP,
        menu.PAGINA,
        menu.RIFMENU,
        menu.CODMNU,
      ]
    );
  }
}
