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

    await AccessiDatabaseUpdater.run(this.accessiOptions);
  }

  static async run(options: AccessiOptions): Promise<void> {
    await this.createParametersTable(options.databaseOptions);

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
      this.logger.info(
        `Applico aggiornamento accessi ${update.fromVersion} -> ${update.toVersion}: ${update.description}`
      );
      await update.apply(options);
      await this.setDatabaseVersion(options.databaseOptions, update.toVersion);
    }
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
