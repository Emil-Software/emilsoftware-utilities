import { Injectable, Inject, OnModuleInit } from '@nestjs/common';
import type { AccessiOptions } from '../AccessiModule';
import { DatabaseUpdater } from '../../DatabaseUpdater';
import { Orm } from '../../Orm';
import { Logger } from '../../Logger';
import { ACCESSI_SCHEMA_VERSION, ACCESSI_VERSION_KEY, accessiTables, accessiForeignKeys, accessiIndexes, accessiTriggers, accessiGenerators, accessiChecks } from './accessiSchema';

type Row = Record<string, unknown>;
export interface AccessiSchemaReport { compatible: boolean; issues: string[]; }

/** Reconciles the actual schema; version labels never bypass verification. */
@Injectable()
export class AccessiDatabaseUpdater extends DatabaseUpdater implements OnModuleInit {
  protected static override logger = new Logger(AccessiDatabaseUpdater.name);
  private static readonly initialization = new WeakMap<AccessiOptions, Promise<void>>();
  private static readonly running = new Map<string, Promise<void>>();

  constructor(@Inject('ACCESSI_OPTIONS') private readonly accessiOptions: AccessiOptions) { super(); }

  async onModuleInit(): Promise<void> { await AccessiDatabaseUpdater.initialize(this.accessiOptions); }

  /** Shared bootstrap barrier for services in the same Nest module. Failed attempts may be retried. */
  static initialize(options: AccessiOptions): Promise<void> {
    let pending = this.initialization.get(options);
    if (!pending) {
      pending = options.autoUpdateDatabase === false ? this.assertCompatible(options) : this.run(options);
      this.initialization.set(options, pending);
      const cleanup = () => this.initialization.delete(options);
      pending.then(cleanup, cleanup);
    }
    return pending;
  }

  static getLatestVersion(): string { return ACCESSI_SCHEMA_VERSION; }

  static async getCurrentVersion(options: AccessiOptions): Promise<string | null> {
    if (!(await this.tableExists(options.databaseOptions, 'PARAMETRI'))) return null;
    const rows = await Orm.query(options.databaseOptions,
      'SELECT DESPAR FROM PARAMETRI WHERE CODPAR = ?', [ACCESSI_VERSION_KEY], false);
    const version = rows[0]?.DESPAR;
    return typeof version === 'string' ? version.trim() : version == null ? null : String(version).trim();
  }

  /** Serialize callers targeting the same database in this process. Cross-process DDL is a deployment concern. */
  static run(options: AccessiOptions): Promise<void> {
    const db = options.databaseOptions;
    const key = JSON.stringify([db.host ?? 'localhost', db.port ?? 3050, db.database]);
    const previous = this.running.get(key) ?? Promise.resolve();
    const pending = previous.catch(() => {}).then(() => this.reconcile(options));
    this.running.set(key, pending);
    const cleanup = () => { if (this.running.get(key) === pending) this.running.delete(key); };
    pending.then(cleanup, cleanup);
    return pending;
  }

  private static async query(options: AccessiOptions, sql: string, params: unknown[] = []): Promise<Row[]> {
    return Orm.query(options.databaseOptions, sql, params, false);
  }

  private static async execute(options: AccessiOptions, sql: string, params: unknown[] = []): Promise<void> {
    try { await Orm.execute(options.databaseOptions, sql, params, false); }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Migrazione Accessi interrotta: ${sql}. ${message}. Correggere lo schema/dati indicati e rilanciare; la versione non e stata avanzata.`);
    }
  }

  private static async sequenceExists(options: AccessiOptions, name: string): Promise<boolean> {
    const rows = await this.query(options, 'SELECT 1 FROM RDB$GENERATORS WHERE RDB$GENERATOR_NAME = ?', [name.toUpperCase()]);
    return rows.length > 0;
  }

  private static async relationIssues(options: AccessiOptions): Promise<string[]> {
    // RDB$VIEW_BLR esiste in tutte le versioni; RDB$RELATION_TYPE solo da Firebird 3.0.
    // Una vista ha RDB$VIEW_BLR non nullo: se una tabella Accessi esiste come vista, va segnalato.
    const rows = await this.query(options, `SELECT TRIM(RDB$RELATION_NAME) AS NAME
      FROM RDB$RELATIONS WHERE COALESCE(RDB$SYSTEM_FLAG, 0) = 0 AND RDB$VIEW_BLR IS NOT NULL`);
    return rows.filter(row => accessiTables[String(row.NAME)]).map(row => `${row.NAME}: richiesta tabella persistente, trovata vista`);
  }

  private static async engineInfo(options: AccessiOptions): Promise<{ version: string; major: number; minor: number }> {
    const rows = await this.query(options, "SELECT RDB$GET_CONTEXT('SYSTEM', 'ENGINE_VERSION') AS ENGINE_VERSION FROM RDB$DATABASE");
    const version = String(rows[0]?.ENGINE_VERSION ?? 'sconosciuta');
    const match = /^(\d+)(?:\.(\d+))?/.exec(version);
    return { version, major: match ? Number(match[1]) : Number.NaN, minor: match?.[2] ? Number(match[2]) : 0 };
  }

  private static async engineIssue(options: AccessiOptions): Promise<string | undefined> {
    const { version, major, minor } = await this.engineInfo(options);
    // Firebird 2.5 e successivi: la 2.5 usa CREATE GENERATOR, dalla 3.0 lo schema usa CREATE SEQUENCE.
    const supported = major > 2 || (major === 2 && minor >= 5);
    if (!supported) return `Firebird ${version}: lo schema Accessi richiede Firebird 2.5 o successivo`;
  }

  private static async columns(options: AccessiOptions): Promise<Row[]> {
    return this.query(options, `SELECT TRIM(RF.RDB$RELATION_NAME) AS TABLE_NAME, TRIM(RF.RDB$FIELD_NAME) AS COLUMN_NAME,
      F.RDB$FIELD_TYPE AS FIELD_TYPE, F.RDB$FIELD_SUB_TYPE AS SUB_TYPE, F.RDB$FIELD_SCALE AS FIELD_SCALE,
      F.RDB$CHARACTER_LENGTH AS TEXT_LENGTH, TRIM(CS.RDB$CHARACTER_SET_NAME) AS CHARSET_NAME,
      COALESCE(RF.RDB$NULL_FLAG, F.RDB$NULL_FLAG, 0) AS NOT_NULL,
      CAST(COALESCE(RF.RDB$DEFAULT_SOURCE, F.RDB$DEFAULT_SOURCE) AS VARCHAR(1024)) AS DEFAULT_SOURCE,
      CASE WHEN F.RDB$COMPUTED_BLR IS NULL THEN 0 ELSE 1 END AS IS_COMPUTED
      FROM RDB$RELATION_FIELDS RF JOIN RDB$FIELDS F ON F.RDB$FIELD_NAME = RF.RDB$FIELD_SOURCE
      LEFT JOIN RDB$CHARACTER_SETS CS ON CS.RDB$CHARACTER_SET_ID = F.RDB$CHARACTER_SET_ID
      WHERE RF.RDB$RELATION_NAME IN (${Object.keys(accessiTables).map(name => `'${name}'`).join(', ')})`);
  }

  private static defaultValue(definition: string): string | undefined {
    return /\bDEFAULT\s+('[^']*'|\S+)/i.exec(definition)?.[1];
  }

  private static typeIssue(row: Row, definition: string): string | undefined {
    if (Number(row.IS_COMPUTED)) return 'colonna calcolata invece di scrivibile';
    const stringLength = /^(?:VAR)?CHAR\((\d+)\)/.exec(definition);
    if (stringLength) {
      if (![14, 37].includes(Number(row.FIELD_TYPE))) return `richiesto testo (${definition})`;
      if (Number(row.TEXT_LENGTH) < Number(stringLength[1])) return `lunghezza ${row.TEXT_LENGTH}, richiesta almeno ${stringLength[1]}`;
      const charset = /CHARACTER SET (\w+)/.exec(definition)?.[1];
      if (charset && typeof row.CHARSET_NAME === 'string' && row.CHARSET_NAME.trim() !== charset) return `character set ${row.CHARSET_NAME}, richiesto ${charset}`;
    } else if (/^(SMALLINT|INTEGER)/.test(definition)) {
      const acceptable = definition.startsWith('SMALLINT') ? [7, 8, 16] : [8, 16];
      if (!acceptable.includes(Number(row.FIELD_TYPE)) || Number(row.FIELD_SCALE) !== 0) return `richiesto intero (${definition})`;
    } else if (definition.startsWith('DATE')) {
      if (![12, 35].includes(Number(row.FIELD_TYPE))) return 'richiesto DATE o TIMESTAMP';
    } else if (definition.startsWith('TIMESTAMP')) {
      if (Number(row.FIELD_TYPE) !== 35) return 'richiesto TIMESTAMP';
    } else if (definition.startsWith('BLOB')) {
      if (Number(row.FIELD_TYPE) !== 261 || Number(row.SUB_TYPE) !== 1) return 'richiesto BLOB testuale';
    }
    return undefined;
  }

  private static async constraints(options: AccessiOptions): Promise<Row[]> {
    return this.query(options, `SELECT TRIM(C.RDB$CONSTRAINT_NAME) AS NAME, TRIM(C.RDB$RELATION_NAME) AS TABLE_NAME,
      TRIM(C.RDB$CONSTRAINT_TYPE) AS KIND, TRIM(S.RDB$FIELD_NAME) AS COLUMN_NAME, S.RDB$FIELD_POSITION AS POS,
      TRIM(T.RDB$RELATION_NAME) AS TARGET_TABLE, TRIM(TS.RDB$FIELD_NAME) AS TARGET_COLUMN,
      TRIM(R.RDB$DELETE_RULE) AS DELETE_RULE
      FROM RDB$RELATION_CONSTRAINTS C
      LEFT JOIN RDB$INDEX_SEGMENTS S ON S.RDB$INDEX_NAME = C.RDB$INDEX_NAME
      LEFT JOIN RDB$REF_CONSTRAINTS R ON R.RDB$CONSTRAINT_NAME = C.RDB$CONSTRAINT_NAME
      LEFT JOIN RDB$RELATION_CONSTRAINTS T ON T.RDB$CONSTRAINT_NAME = R.RDB$CONST_NAME_UQ
      LEFT JOIN RDB$INDEX_SEGMENTS TS ON TS.RDB$INDEX_NAME = T.RDB$INDEX_NAME AND TS.RDB$FIELD_POSITION = S.RDB$FIELD_POSITION
      ORDER BY C.RDB$CONSTRAINT_NAME, S.RDB$FIELD_POSITION`);
  }

  /** Raggruppa per nome; ogni gruppo e non vuoto per costruzione (tupla non vuota). */
  private static groups(rows: Row[]): Array<[Row, ...Row[]]> {
    const groups = new Map<string, [Row, ...Row[]]>();
    for (const row of rows) {
      const key = String(row.NAME);
      const existing = groups.get(key);
      if (existing) {
        existing.push(row);
      } else {
        groups.set(key, [row]);
      }
    }
    return Array.from(groups.values());
  }

  private static async checks(options: AccessiOptions): Promise<Row[]> {
    return this.query(options, `SELECT DISTINCT TRIM(C.RDB$CONSTRAINT_NAME) AS NAME,
      TRIM(C.RDB$RELATION_NAME) AS TABLE_NAME, CAST(T.RDB$TRIGGER_SOURCE AS VARCHAR(2048)) AS CHECK_SOURCE
      FROM RDB$RELATION_CONSTRAINTS C JOIN RDB$CHECK_CONSTRAINTS K ON K.RDB$CONSTRAINT_NAME = C.RDB$CONSTRAINT_NAME
      JOIN RDB$TRIGGERS T ON T.RDB$TRIGGER_NAME = K.RDB$TRIGGER_NAME
      WHERE C.RDB$CONSTRAINT_TYPE = 'CHECK'`);
  }

  private static sameCheck(source: string, expression: string): boolean {
    const normalize = (s: string) => s.replace(/^\s*CHECK\s*/i, '').replace(/[\s()]/g, '').toUpperCase();
    return normalize(source ?? '') === normalize(expression);
  }

  private static async indexes(options: AccessiOptions): Promise<Array<[Row, ...Row[]]>> {
    return this.groups(await this.query(options, `SELECT TRIM(I.RDB$INDEX_NAME) AS NAME, TRIM(I.RDB$RELATION_NAME) AS TABLE_NAME,
      COALESCE(I.RDB$INDEX_INACTIVE, 0) AS INACTIVE, TRIM(S.RDB$FIELD_NAME) AS COLUMN_NAME
      FROM RDB$INDICES I LEFT JOIN RDB$INDEX_SEGMENTS S ON S.RDB$INDEX_NAME = I.RDB$INDEX_NAME
      ORDER BY I.RDB$INDEX_NAME, S.RDB$FIELD_POSITION`));
  }

  private static sameColumns(rows: Row[], columns: string[]): boolean {
    return rows.map(row => row.COLUMN_NAME).join(',') === columns.join(',');
  }

  private static async triggers(options: AccessiOptions): Promise<Row[]> {
    return this.query(options, `SELECT TRIM(RDB$TRIGGER_NAME) AS NAME, TRIM(RDB$RELATION_NAME) AS TABLE_NAME,
      RDB$TRIGGER_INACTIVE AS INACTIVE, RDB$TRIGGER_TYPE AS TRIGGER_TYPE,
      CAST(RDB$TRIGGER_SOURCE AS VARCHAR(8191)) AS SOURCE
      FROM RDB$TRIGGERS WHERE COALESCE(RDB$SYSTEM_FLAG, 0) = 0
      AND RDB$RELATION_NAME IN (${Object.keys(accessiTables).map(name => `'${name}'`).join(', ')})`);
  }

  /** Accept historical formatting and renamed triggers, but require the operations used by Accessi. */
  private static compatibleTrigger(row: Row, trigger: typeof accessiTriggers[number]): boolean {
    if (row.TABLE_NAME !== trigger.table || Number(row.INACTIVE) || Number(row.TRIGGER_TYPE) !== trigger.type) return false;
    const source = String(row.SOURCE ?? '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\r\n]*/g, '').replace(/[\s()]/g, '').toUpperCase();
    const required: Record<string, string[]> = {
      UTENTI_BI: ['IFNEW.CODUTEISNULL', 'NEW.CODUTE=GEN_IDGEN_UTENTI_ID,1', 'NEW.DATINS=CURRENT_TIMESTAMP'],
      RUOLI_BI: ['IFNEW.CODRUOISNULL', 'NEW.CODRUO=GEN_IDGEN_RUOLI_ID,1'],
      FILTRI_BI0: ['IFNEW.PROGISNULL', 'MAXPROG', 'FROMFILTRIWHERECODUTE=NEW.CODUTE', 'NEW.PROG=TOT+1'],
      UTENTI_GDPR_BI0: ['NEW.DATACC=CURRENT_TIMESTAMP', 'UPDATEUTENTISETFLGGDPR=1', 'DATGDPR=CURRENT_TIMESTAMP', 'WHERECODUTE=NEW.CODUTE'],
    };
    return (required[trigger.name] ?? []).every(fragment => source.includes(fragment));
  }

  private static async futureVersionIssue(options: AccessiOptions, columns: Row[]): Promise<string | undefined> {
    if (!['CODPAR', 'DESPAR'].every(name => columns.some(row => row.TABLE_NAME === 'PARAMETRI' && row.COLUMN_NAME === name))) return;
    const version = await this.getCurrentVersion(options);
    if (!version) return;
    if (!/^\d+\.\d+\.\d+$/.test(version)) return `Versione Accessi non riconosciuta: ${version}`;
    const actual = version.split('.').map(Number), latest = ACCESSI_SCHEMA_VERSION.split('.').map(Number);
    for (let i = 0; i < 3; i++) {
      if ((actual[i] ?? 0) > (latest[i] ?? 0)) return `Schema Accessi ${version} piu recente della libreria (${ACCESSI_SCHEMA_VERSION}); downgrade automatico non consentito`;
      if ((actual[i] ?? 0) < (latest[i] ?? 0)) return;
    }
  }

  /** Read-only diagnostics, including when automatic updates are disabled. */
  static async inspectSchema(options: AccessiOptions): Promise<AccessiSchemaReport> {
    const engine = await this.engineIssue(options);
    if (engine) return { compatible: false, issues: [engine] };
    const issues: string[] = await this.relationIssues(options);
    const columns = await this.columns(options);
    const future = await this.futureVersionIssue(options, columns);
    if (future) issues.push(future);
    for (const [table, schema] of Object.entries(accessiTables)) {
      const present = columns.filter(row => row.TABLE_NAME === table);
      if (!present.length) { issues.push(`Tabella mancante: ${table}`); continue; }
      for (const [name, definition] of Object.entries(schema.columns)) {
        const row = present.find(row => row.COLUMN_NAME === name);
        if (!row) { issues.push(`Colonna mancante: ${table}.${name}`); continue; }
        const problem = this.typeIssue(row, definition);
        if (problem) issues.push(`${table}.${name}: ${problem}`);
        if (definition.includes('NOT NULL') && !Number(row.NOT_NULL)) issues.push(`${table}.${name}: manca NOT NULL`);
        const expected = this.defaultValue(definition);
        if (expected && this.normalizeDefault(row.DEFAULT_SOURCE) !== this.normalizeDefault(expected)) issues.push(`${table}.${name}: richiesto DEFAULT ${expected}`);
      }
    }
    const checks = await this.checks(options);
    for (const check of accessiChecks) {
      if (!checks.some(row => row.TABLE_NAME === check.table && this.sameCheck(String(row.CHECK_SOURCE), check.expression))) issues.push(`${check.table}: manca CHECK (${check.expression})`);
    }
    const constraints = this.groups(await this.constraints(options));
    for (const [table, schema] of Object.entries(accessiTables)) {
      if (!constraints.some(rows => rows[0].TABLE_NAME === table && rows[0].KIND === 'PRIMARY KEY' && this.sameColumns(rows, schema.primaryKey))) issues.push(`${table}: chiave primaria richiesta (${schema.primaryKey.join(', ')})`);
    }
    for (const fk of accessiForeignKeys) {
      if (!constraints.some(rows => rows.length === 1 && rows[0].KIND === 'FOREIGN KEY' && rows[0].TABLE_NAME === fk.table && rows[0].COLUMN_NAME === fk.column && rows[0].TARGET_TABLE === fk.target && rows[0].TARGET_COLUMN === fk.targetColumn && (fk.cascade ? rows[0].DELETE_RULE === 'CASCADE' : ['NO ACTION', 'RESTRICT'].includes(String(rows[0].DELETE_RULE))))) issues.push(`${fk.name}: manca FK compatibile ${fk.table}.${fk.column} -> ${fk.target}.${fk.targetColumn}`);
    }
    const indexes = await this.indexes(options);
    for (const index of accessiIndexes) {
      if (!indexes.some(rows => rows[0].TABLE_NAME === index.table && !Number(rows[0].INACTIVE) && this.sameColumns(rows, index.columns))) issues.push(`${index.name}: indice mancante o inattivo`);
    }
    const triggers = await this.triggers(options);
    for (const trigger of accessiTriggers) {
      if (!triggers.some(row => this.compatibleTrigger(row, trigger))) issues.push(`${trigger.name}: trigger richiesto attivo ${trigger.event} su ${trigger.table}, con le operazioni Accessi previste`);
    }
    for (const generator of accessiGenerators) {
      if (!(await this.sequenceExists(options, generator.name))) issues.push(`${generator.name}: sequence/generatore mancante`);
      else if (columns.some(row => row.TABLE_NAME === generator.table && row.COLUMN_NAME === generator.column)) {
        const rows = await this.query(options, `SELECT GEN_ID(${generator.name}, 0) AS CURRENT_VALUE, (SELECT COALESCE(MAX(${generator.column}), 0) FROM ${generator.table}) AS MAX_VALUE FROM RDB$DATABASE`);
        if (Number(rows[0]?.CURRENT_VALUE) < Number(rows[0]?.MAX_VALUE)) issues.push(`${generator.name}: sequence inferiore agli identificativi esistenti`);
      }
    }
    return { compatible: issues.length === 0, issues };
  }

  static async assertCompatible(options: AccessiOptions): Promise<void> {
    const report = await this.inspectSchema(options);
    if (!report.compatible) throw new Error(`Schema database Accessi incompatibile:\n- ${report.issues.join('\n- ')}\nEseguire AccessiDatabaseUpdater.run con un utente autorizzato o correggere lo schema prima dell'avvio.`);
  }

  private static normalizeDefault(value: unknown): string {
    return String(value ?? '').replace(/^\s*DEFAULT\s+/i, '').replace(/[()\s]/g, '').toUpperCase();
  }

  /**
   * Riconciliazione idempotente e ripartibile. Firebird non rende utilizzabili gli oggetti
   * creati nella stessa transazione (metadata cache), quindi il DDL resta auto-commit per
   * statement: eventuali errori a meta vengono recuperati rieseguendo la migrazione e la
   * versione viene avanzata solo dopo la verifica finale `assertCompatible`.
   */
  private static async reconcile(options: AccessiOptions): Promise<void> {
    this.logger.info('Verifica dello schema effettivo Accessi.');
    const engine = await this.engineIssue(options);
    if (engine) throw new Error(engine);
    const { major: engineMajor } = await this.engineInfo(options);
    const columns = await this.columns(options);
    const future = await this.futureVersionIssue(options, columns);
    if (future) throw new Error(future);
    // Detect incompatible existing definitions before making any changes. Never guess at data conversion.
    const problems: string[] = await this.relationIssues(options);
    for (const [table, schema] of Object.entries(accessiTables)) {
      for (const [name, definition] of Object.entries(schema.columns)) {
        const row = columns.find(row => row.TABLE_NAME === table && row.COLUMN_NAME === name);
        if (row) {
          const problem = this.typeIssue(row, definition);
          if (problem) problems.push(`${table}.${name}: ${problem}`);
        }
      }
    }
    if (problems.length) throw new Error(`Schema Accessi richiede intervento sui tipi:\n- ${problems.join('\n- ')}`);
    for (const [table, schema] of Object.entries(accessiTables)) {
      const present = columns.filter(row => row.TABLE_NAME === table);
      if (!present.length) {
        await this.execute(options, `CREATE TABLE ${table} (${Object.entries(schema.columns).map(([name, definition]) => `${name} ${definition}`).join(', ')})`);
        continue;
      }
      for (const [name, definition] of Object.entries(schema.columns)) {
        const row = present.find(row => row.COLUMN_NAME === name);
        if (!row) {
          if (definition.includes('NOT NULL') && !this.defaultValue(definition)) {
            const data = await this.query(options, `SELECT FIRST 1 1 AS HAS_DATA FROM ${table}`);
            if (data.length) throw new Error(`Impossibile aggiungere ${table}.${name} obbligatoria: tabella popolata, serve un backfill esplicito. Nessun valore identificativo viene inventato.`);
          }
          await this.execute(options, `ALTER TABLE ${table} ADD ${name} ${definition}`);
        } else {
          const expected = this.defaultValue(definition);
          if (expected && this.normalizeDefault(row.DEFAULT_SOURCE) !== this.normalizeDefault(expected)) await this.execute(options, `ALTER TABLE ${table} ALTER ${name} SET DEFAULT ${expected}`);
          if (definition.includes('NOT NULL') && !Number(row.NOT_NULL)) {
            if (expected) await this.execute(options, `UPDATE ${table} SET ${name} = ${expected} WHERE ${name} IS NULL`);
            await this.execute(options, `ALTER TABLE ${table} ALTER ${name} SET NOT NULL`);
          }
        }
      }
    }
    const constraints = this.groups(await this.constraints(options));
    for (const [table, schema] of Object.entries(accessiTables)) {
      const primary = constraints.find(rows => rows[0].TABLE_NAME === table && rows[0].KIND === 'PRIMARY KEY');
      if (primary && !this.sameColumns(primary, schema.primaryKey)) throw new Error(`${table}: chiave primaria esistente incompatibile; nessun vincolo viene eliminato automaticamente.`);
      if (!primary) await this.execute(options, `ALTER TABLE ${table} ADD CONSTRAINT PK_${table} PRIMARY KEY (${schema.primaryKey.join(', ')})`);
    }
    // Only preserve provider namespaces already referenced by historical SSO identities.
    await this.execute(options, `INSERT INTO SSO_PROVIDER (PROVIDER, DESCRIZIONE, FLGATTIVO)
      SELECT DISTINCT I.PROVIDER, I.PROVIDER, 1 FROM UTENTI_IDENTITA_EXT I
      WHERE NOT EXISTS (SELECT 1 FROM SSO_PROVIDER P WHERE P.PROVIDER = I.PROVIDER)`);
    for (const fk of accessiForeignKeys) {
      const existing = constraints.find(rows => rows[0].KIND === 'FOREIGN KEY' && rows[0].TABLE_NAME === fk.table && this.sameColumns(rows, [fk.column]));
      if (existing) {
        // Una FK sulla stessa colonna ma verso un target/regola diverso non e compatibile:
        // correggere il target cambiando semantica e va segnalato, non ignorato.
        const deleteRuleOk = fk.cascade
          ? existing[0].DELETE_RULE === 'CASCADE'
          : ['NO ACTION', 'RESTRICT'].includes(String(existing[0].DELETE_RULE));
        if (existing[0].TARGET_TABLE !== fk.target || existing[0].TARGET_COLUMN !== fk.targetColumn || !deleteRuleOk) {
          throw new Error(`${fk.name}: FK esistente su ${fk.table}.${fk.column} incompatibile (target ${existing[0].TARGET_TABLE}.${existing[0].TARGET_COLUMN}, delete rule ${existing[0].DELETE_RULE}); correggerla esplicitamente.`);
        }
        continue;
      }
      await this.execute(options, `ALTER TABLE ${fk.table} ADD CONSTRAINT ${fk.name} FOREIGN KEY (${fk.column}) REFERENCES ${fk.target} (${fk.targetColumn})${fk.cascade ? ' ON DELETE CASCADE' : ''}`);
    }
    const checks = await this.checks(options);
    for (const check of accessiChecks) {
      if (!checks.some(row => row.TABLE_NAME === check.table && this.sameCheck(String(row.CHECK_SOURCE), check.expression))) {
        await this.execute(options, `ALTER TABLE ${check.table} ADD CONSTRAINT ${check.name} CHECK (${check.expression})`);
      }
    }
    const indexes = await this.indexes(options);
    for (const index of accessiIndexes) {
      if (!indexes.some(rows => rows[0].TABLE_NAME === index.table && !Number(rows[0].INACTIVE) && this.sameColumns(rows, index.columns))) {
        if (indexes.some(rows => rows[0].NAME === index.name)) throw new Error(`${index.name}: indice esistente incompatibile o inattivo; correggerlo esplicitamente.`);
        await this.execute(options, `CREATE INDEX ${index.name} ON ${index.table} (${index.columns.join(', ')})`);
      }
    }
    for (const generator of accessiGenerators) {
      if (!(await this.sequenceExists(options, generator.name))) {
        // Firebird 2.5 non conosce CREATE SEQUENCE: usa CREATE GENERATOR. Da 3.0 si usa la sintassi standard.
        await this.execute(options, engineMajor >= 3 ? `CREATE SEQUENCE ${generator.name}` : `CREATE GENERATOR ${generator.name}`);
      }
      // Advance by a positive delta only: do not reset an existing sequence or reuse an allocated value.
      await this.execute(options, `EXECUTE BLOCK AS DECLARE VARIABLE MAX_ID BIGINT; DECLARE VARIABLE CURRENT_ID BIGINT; DECLARE VARIABLE NEXT_ID BIGINT;
        BEGIN SELECT COALESCE(MAX(${generator.column}), 0) FROM ${generator.table} INTO :MAX_ID;
        CURRENT_ID = GEN_ID(${generator.name}, 0);
        IF (MAX_ID > CURRENT_ID) THEN NEXT_ID = GEN_ID(${generator.name}, MAX_ID - CURRENT_ID); END`);
    }
    const triggers = await this.triggers(options);
    for (const trigger of accessiTriggers) {
      if (!triggers.some(row => this.compatibleTrigger(row, trigger)) && !triggers.some(row => row.NAME === trigger.name)) {
        if (triggers.some(row => row.TABLE_NAME === trigger.table && Number(row.TRIGGER_TYPE) === trigger.type)) {
          throw new Error(`${trigger.table}: trigger ${trigger.event} personalizzato non riconosciuto; verificare le operazioni di ${trigger.name} prima di aggiungere trigger concorrenti.`);
        }
        await this.execute(options, `CREATE TRIGGER ${trigger.name} FOR ${trigger.table} ACTIVE ${trigger.event} POSITION 0 ${trigger.body}`);
      }
    }
    await this.assertCompatible(options);
    // The host's VersioneDB/DBVERSION values belong to the host and are never overwritten.
    await this.execute(options, 'UPDATE OR INSERT INTO PARAMETRI (CODPAR, DESPAR) VALUES (?, ?) MATCHING (CODPAR)', [ACCESSI_VERSION_KEY, ACCESSI_SCHEMA_VERSION]);
    this.logger.info(`Schema Accessi verificato: ${ACCESSI_SCHEMA_VERSION}.`);
  }
}
