import type { AccessiOptions } from '../AccessiModule';
import { Orm } from '../../Orm';

/** Metadata is read per operation so host-owned extensions can change without a stale global cache. */
export async function getTableColumns(options: AccessiOptions, table: string): Promise<Set<string>> {
  const rows = await Orm.query(options.databaseOptions,
    'SELECT TRIM(RDB$FIELD_NAME) AS COLUMN_NAME FROM RDB$RELATION_FIELDS WHERE RDB$RELATION_NAME = ?', [table], false);
  return new Set(rows.map((row: Record<string, unknown>) => String(row.COLUMN_NAME ?? '').trim()));
}

/** Arguments come exclusively from the library's fixed field mappings, never HTTP input. */
export function optionalColumn(columns: Set<string>, name: string, tableAlias: string, outputAlias: string, numeric = true): string {
  return `${columns.has(name) ? `${tableAlias}.${name}` : `CAST(NULL AS ${numeric ? 'INTEGER' : 'VARCHAR(255)'})`} AS ${outputAlias}`;
}
