import { Inject, Injectable } from '@nestjs/common';
import { Orm } from '../../../Orm';
import { RestUtilities } from '../../../Utilities';
import type { AccessiOptions } from '../../AccessiModule';
import {
  ACCESSI_SCHEMA_VERSION,
  accessiTables,
  accessiForeignKeys,
  accessiIndexes,
  accessiChecks,
  accessiTriggers,
  accessiGenerators,
} from '../../database-updates/accessiSchema';

export interface SchemaDdlSection {
  id: string;
  title: string;
  sql: string;
}

export interface SchemaDdlResult {
  version: string;
  sections: SchemaDdlSection[];
  script: string;
}

export interface SchemaEntitiesResult {
  presentTables: string[];
  extraTables: string[];
  canonicalTables: string[];
  presentGenerators: string[];
}

/**
 * Genera il DDL delle entita Accessi a partire dallo schema canonico (stessa fonte della
 * riconciliazione) e rileva le entita effettivamente presenti nel database. Serve a
 * esportare lo schema per replicarlo su altre installazioni.
 */
@Injectable()
export class SchemaExportService {
  constructor(@Inject('ACCESSI_OPTIONS') private readonly options: AccessiOptions) {}

  /** DDL completo e deterministico dello schema Accessi. */
  buildDdl(): SchemaDdlResult {
    const sections: SchemaDdlSection[] = [
      this.buildTablesSection(),
      this.buildGeneratorsSection(),
      this.buildForeignKeysSection(),
      this.buildIndexesSection(),
      this.buildChecksSection(),
      this.buildTriggersSection(),
    ];

    const script = sections
      .map((section) => `-- ============================================================\n-- ${section.title}\n-- ============================================================\n${section.sql}`)
      .join('\n\n');

    return { version: ACCESSI_SCHEMA_VERSION, sections, script };
  }

  /** Elenca le tabelle/generatori presenti nel database e segnala quelli fuori schema canonical. */
  async presentEntities(): Promise<SchemaEntitiesResult> {
    const canonicalTables = Object.keys(accessiTables).sort();
    const canonicalSet = new Set(canonicalTables);

    const tableRows = (await Orm.query(
      this.options.databaseOptions,
      `SELECT TRIM(RDB$RELATION_NAME) AS NAME
       FROM RDB$RELATIONS
       WHERE COALESCE(RDB$SYSTEM_FLAG, 0) = 0 AND RDB$VIEW_BLR IS NULL
       ORDER BY RDB$RELATION_NAME`,
      [],
      false,
    )) as Array<Record<string, unknown>>;
    const presentTables = tableRows
      .map((row) => String(RestUtilities.convertKeysToCamelCase(row).name ?? '').trim())
      .filter(Boolean);

    const generatorRows = (await Orm.query(
      this.options.databaseOptions,
      `SELECT TRIM(RDB$GENERATOR_NAME) AS NAME
       FROM RDB$GENERATORS
       WHERE COALESCE(RDB$SYSTEM_FLAG, 0) = 0
       ORDER BY RDB$GENERATOR_NAME`,
      [],
      false,
    )) as Array<Record<string, unknown>>;
    const presentGenerators = generatorRows
      .map((row) => String(RestUtilities.convertKeysToCamelCase(row).name ?? '').trim())
      .filter(Boolean);

    return {
      presentTables,
      extraTables: presentTables.filter((name) => !canonicalSet.has(name)),
      canonicalTables,
      presentGenerators,
    };
  }

  private buildTablesSection(): SchemaDdlSection {
    const statements: string[] = [];
    for (const [table, schema] of Object.entries(accessiTables)) {
      const columns = Object.entries(schema.columns)
        .map(([name, definition]) => `    ${name} ${definition}`)
        .join(',\n');
      statements.push(`CREATE TABLE ${table} (\n${columns}\n);`);
      statements.push(`ALTER TABLE ${table} ADD CONSTRAINT PK_${table} PRIMARY KEY (${schema.primaryKey.join(', ')});`);
    }
    return { id: 'tables', title: `Tabelle (${Object.keys(accessiTables).length})`, sql: statements.join('\n\n') };
  }

  private buildGeneratorsSection(): SchemaDdlSection {
    const statements = accessiGenerators.map(
      (generator) =>
        `-- Firebird 2.5: CREATE GENERATOR ${generator.name}\nCREATE SEQUENCE ${generator.name};`,
    );
    return { id: 'generators', title: `Generatori/Sequenze (${accessiGenerators.length})`, sql: statements.join('\n\n') };
  }

  private buildForeignKeysSection(): SchemaDdlSection {
    const statements = accessiForeignKeys.map(
      (fk) =>
        `ALTER TABLE ${fk.table} ADD CONSTRAINT ${fk.name} FOREIGN KEY (${fk.column}) REFERENCES ${fk.target} (${fk.targetColumn})${fk.cascade ? ' ON DELETE CASCADE' : ''};`,
    );
    return { id: 'foreignKeys', title: `Chiavi esterne (${accessiForeignKeys.length})`, sql: statements.join('\n\n') };
  }

  private buildIndexesSection(): SchemaDdlSection {
    const statements = accessiIndexes.map(
      (index) => `CREATE INDEX ${index.name} ON ${index.table} (${index.columns.join(', ')});`,
    );
    return { id: 'indexes', title: `Indici (${accessiIndexes.length})`, sql: statements.join('\n\n') };
  }

  private buildChecksSection(): SchemaDdlSection {
    const statements = accessiChecks.map(
      (check) => `ALTER TABLE ${check.table} ADD CONSTRAINT ${check.name} CHECK (${check.expression});`,
    );
    return { id: 'checks', title: `Vincoli CHECK (${accessiChecks.length})`, sql: statements.join('\n\n') };
  }

  private buildTriggersSection(): SchemaDdlSection {
    if (accessiTriggers.length === 0) {
      return { id: 'triggers', title: 'Trigger (0)', sql: '-- Nessun trigger di dominio.' };
    }
    const statements = accessiTriggers.map(
      (trigger) => `CREATE TRIGGER ${trigger.name} FOR ${trigger.table} ACTIVE ${trigger.event} ${trigger.body}`,
    );
    return {
      id: 'triggers',
      title: `Trigger (${accessiTriggers.length})`,
      sql: `SET TERM ^ ;\n\n${statements.join('^\n\n')}^\n\nSET TERM ; ^`,
    };
  }
}
