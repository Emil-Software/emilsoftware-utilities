import { Orm } from '../../Orm';
import { Logger } from '../../Logger';
import type { AccessiOptions } from '../AccessiModule';
import { MENU_SCOPE_SEED, MENU_SCOPE_SEED_VERSION, SCOPE_SEED } from './menuScopeSeed';

/**
 * Seed di sistema degli scope applicativi.
 *
 * Gira al bootstrap, dopo la riconciliazione dello schema e prima delle
 * catalog migration dell'host. E' idempotente:
 * - inserisce gli scope mancanti senza sovrascrivere nome/descrizioni esistenti;
 * - inserisce le associazioni menu/scope mancanti, senza cancellare quelle
 *   aggiunte a mano dalla console;
 * - assegna un fallback ai menu nuovi in base al prefisso del gruppo
 *   (`ESGESTX_`, `TINTEMIX_`, ...), cosi un menu creato dopo l'installazione
 *   non resta senza scope;
 * - logga i menu rimasti senza scope senza bloccare l'avvio.
 *
 * Il seed "grande" (314 menu) viene applicato una volta per versione; il
 * fallback gira a ogni avvio ed e' una singola query.
 */
const SEED_VERSION_KEY = 'MenuScopesSeed';

/** Prefisso della descrizione gruppo -> scope. */
const GROUP_PREFIXES: ReadonlyArray<readonly [string, string]> = [
  ['ESGESTX_', 'ESGESTX'],
  ['TINTEMIX_', 'TINTEMIX'],
  ['MAGAZTINT_', 'MAGAZTINT'],
  ['STEX_', 'STEX'],
  ['STAFFX_', 'STAFFX'],
  ['STERILIX_', 'STERILIX'],
  ['CENTROCONTROLLO_', 'CENTROCONTROLLO'],
];

export interface MenuScopeSeedReport {
  scopesEnsured: number;
  assignmentsInserted: number;
  fallbackInserted: number;
  unassigned: string[];
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

async function insertScope(options: AccessiOptions, code: string, name: string): Promise<void> {
  await Orm.execute(
    options.databaseOptions,
    `INSERT INTO SCOPES (CODICE, NOME)
     SELECT ?, ? FROM RDB$DATABASE
     WHERE NOT EXISTS (SELECT 1 FROM SCOPES S WHERE S.CODICE = ?)`,
    [code, name, code],
    false,
  );
}

async function insertAssignment(
  options: AccessiOptions,
  menuCode: string,
  scopeCode: string,
): Promise<void> {
  await Orm.execute(
    options.databaseOptions,
    `INSERT INTO MENU_SCOPES (CODICE_MENU, CODICE_SCOPE)
     SELECT ?, ? FROM RDB$DATABASE
     WHERE EXISTS (SELECT 1 FROM MENU M WHERE M.CODMNU = ?)
       AND NOT EXISTS (
         SELECT 1 FROM MENU_SCOPES MS
         WHERE MS.CODICE_MENU = ? AND MS.CODICE_SCOPE = ?
       )`,
    [menuCode, scopeCode, menuCode, menuCode, scopeCode],
    false,
  );
}

function fallbackCaseExpression(): string {
  const branches = GROUP_PREFIXES.map(
    ([prefix, scope]) => `WHEN TRIM(G.DESGRP) STARTING WITH ${sqlString(prefix)} THEN ${sqlString(scope)}`,
  );
  return `CASE ${branches.join(' ')} ELSE NULL END`;
}

async function applyFallback(options: AccessiOptions): Promise<void> {
  const scopeExpression = fallbackCaseExpression();
  await Orm.execute(
    options.databaseOptions,
    `INSERT INTO MENU_SCOPES (CODICE_MENU, CODICE_SCOPE)
     SELECT M.CODMNU, ${scopeExpression}
     FROM MENU M
     LEFT JOIN MENU_GRP G ON G.CODGRP = M.CODGRP
     WHERE ${scopeExpression} IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM MENU_SCOPES MS WHERE MS.CODICE_MENU = M.CODMNU
       )`,
    [],
    false,
  );
}

async function unassignedMenus(options: AccessiOptions): Promise<string[]> {
  const rows = (await Orm.query(
    options.databaseOptions,
    `SELECT M.CODMNU AS CODE
     FROM MENU M
     WHERE NOT EXISTS (SELECT 1 FROM MENU_SCOPES MS WHERE MS.CODICE_MENU = M.CODMNU)
     ORDER BY M.CODMNU`,
    [],
    false,
  )) as Array<Record<string, unknown>>;
  return rows
    .map((row) => String(row.CODE ?? row.code ?? '').trim())
    .filter((code) => code.length > 0);
}

export async function applyMenuScopeSeeds(
  options: AccessiOptions,
): Promise<MenuScopeSeedReport | null> {
  if (options.systemSeeds?.enabled === false) {
    return null;
  }

  for (const scope of SCOPE_SEED) {
    await insertScope(options, scope.code, scope.name);
  }

  const current = (await Orm.query(
    options.databaseOptions,
    'SELECT DESPAR FROM PARAMETRI WHERE CODPAR = ?',
    [SEED_VERSION_KEY],
    false,
  )) as Array<Record<string, unknown>>;
  const installedVersion = String(current[0]?.DESPAR ?? current[0]?.despar ?? '').trim();

  let assignmentsInserted = 0;
  if (installedVersion !== MENU_SCOPE_SEED_VERSION) {
    for (const [menuCode, scopes] of Object.entries(MENU_SCOPE_SEED)) {
      for (const scopeCode of scopes) {
        await insertAssignment(options, menuCode, scopeCode);
        assignmentsInserted += 1;
      }
    }
    await Orm.execute(
      options.databaseOptions,
      'UPDATE OR INSERT INTO PARAMETRI (CODPAR, DESPAR) VALUES (?, ?) MATCHING (CODPAR)',
      [SEED_VERSION_KEY, MENU_SCOPE_SEED_VERSION],
      false,
    );
  }

  const beforeFallback = await unassignedMenus(options);
  await applyFallback(options);
  const unassigned = await unassignedMenus(options);

  const logger = new Logger('MenuScopeSeed');
  logger.info(
    `Scope applicativi: ${SCOPE_SEED.length} scope, ${assignmentsInserted} associazioni dal catalogo, ` +
      `${beforeFallback.length - unassigned.length} dal fallback gruppo.`,
  );
  if (unassigned.length > 0) {
    logger.warning(
      `Menu senza scope applicativo (${unassigned.length}): ${unassigned.join(', ')}. ` +
        'Assegna uno scope dalla console o aggiorna il catalogo menu.',
    );
  }

  return {
    scopesEnsured: SCOPE_SEED.length,
    assignmentsInserted,
    fallbackInserted: Math.max(0, beforeFallback.length - unassigned.length),
    unassigned,
  };
}
