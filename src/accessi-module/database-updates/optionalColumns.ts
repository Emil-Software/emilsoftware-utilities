import type { AccessiOptions } from '../AccessiModule';
import { Orm } from '../../Orm';

type ColumnCacheEntry = { columns: Set<string>; expiresAt: number };

/**
 * I metadati delle colonne sono letti di rado ma usati a ogni operazione. Una cache a breve TTL
 * evita una query di introspezione per richiesta; il TTL limita la finestra di staleness se lo
 * schema viene esteso a runtime (le migrazioni girano comunque al bootstrap).
 */
const COLUMN_CACHE_TTL_MS = 60_000;
const COLUMN_CACHE_MAX_ENTRIES = 100;
const columnCache = new Map<string, ColumnCacheEntry>();

function cacheKey(options: AccessiOptions, table: string): string {
  const db = options.databaseOptions;
  return [db.host ?? '', db.port ?? '', db.database ?? '', table.toUpperCase()].join('|');
}

/** Invalida la cache dei metadati (usata dopo migrazioni o nei test). */
export function clearTableColumnsCache(): void {
  columnCache.clear();
}

/** Metadata is read per operation so host-owned extensions can change without a stale global cache. */
export async function getTableColumns(options: AccessiOptions, table: string): Promise<Set<string>> {
  const key = cacheKey(options, table);
  const now = Date.now();
  const cached = columnCache.get(key);
  if (cached && cached.expiresAt > now) {
    return cached.columns;
  }

  const rows = await Orm.query(options.databaseOptions,
    'SELECT TRIM(RDB$FIELD_NAME) AS COLUMN_NAME FROM RDB$RELATION_FIELDS WHERE RDB$RELATION_NAME = ?', [table], false);
  const columns = new Set(rows.map((row: Record<string, unknown>) => String(row.COLUMN_NAME ?? '').trim()));

  if (columnCache.size >= COLUMN_CACHE_MAX_ENTRIES) {
    const oldestKey = columnCache.keys().next().value;
    if (oldestKey !== undefined) {
      columnCache.delete(oldestKey);
    }
  }
  columnCache.set(key, { columns, expiresAt: now + COLUMN_CACHE_TTL_MS });

  return columns;
}

/** Arguments come exclusively from the library's fixed field mappings, never HTTP input. */
export function optionalColumn(columns: Set<string>, name: string, tableAlias: string, outputAlias: string, numeric = true): string {
  return `${columns.has(name) ? `${tableAlias}.${name}` : `CAST(NULL AS ${numeric ? 'INTEGER' : 'VARCHAR(255)'})`} AS ${outputAlias}`;
}
