require('ts-node/register/transpile-only');
require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Orm } = require('../src/Orm');
const { Logger } = require('../src/Logger');
const {
  splitSqlStatements,
  computeCatalogScriptChecksum,
  discoverCatalogScripts,
  applyCatalogScripts,
  analyzeCatalogScript,
} = require('../src/accessi-service/database-updates/AccessiCatalogMigrator');

for (const method of ['info', 'log', 'warning', 'error']) Logger.prototype[method] = () => {};

function scriptsFolder(files) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'accessi-catalog-'));
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(directory, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, 'utf8');
  }
  return directory;
}

test('splitSqlStatements splits on terminator, protects strings and comments', () => {
  assert.deepEqual(splitSqlStatements('SELECT 1; SELECT 2;'), ['SELECT 1', 'SELECT 2']);
  assert.deepEqual(splitSqlStatements("INSERT INTO T (A) VALUES ('a;b'); SELECT 3"), ["INSERT INTO T (A) VALUES ('a;b')", 'SELECT 3']);
  assert.deepEqual(splitSqlStatements("SELECT 'it''s'; SELECT 2"), ["SELECT 'it''s'", 'SELECT 2']);
  assert.deepEqual(splitSqlStatements('SELECT 1; -- comment; with semicolon\nSELECT 2;'), ['SELECT 1', '-- comment; with semicolon\nSELECT 2']);
  assert.deepEqual(splitSqlStatements('/* a; b */ SELECT 1;'), ['/* a; b */ SELECT 1']);
});

test('splitSqlStatements honors SET TERM blocks', () => {
  const sql = [
    'SET TERM ^ ;',
    'CREATE TRIGGER T_BI FOR T ACTIVE BEFORE INSERT AS',
    'BEGIN',
    '  NEW.ID = 1;',
    'END^',
    'SET TERM ; ^',
    'UPDATE OR INSERT INTO MENU (CODMNU) VALUES (?) MATCHING (CODMNU);',
  ].join('\n');
  const statements = splitSqlStatements(sql);
  assert.equal(statements.length, 2);
  assert.match(statements[0], /CREATE TRIGGER T_BI/);
  assert.match(statements[0], /NEW\.ID = 1;/);
  assert.match(statements[1], /UPDATE OR INSERT INTO MENU/);
});

test('computeCatalogScriptChecksum is stable and content sensitive', () => {
  assert.equal(computeCatalogScriptChecksum('ABC'), computeCatalogScriptChecksum('ABC'));
  assert.notEqual(computeCatalogScriptChecksum('ABC'), computeCatalogScriptChecksum('ABC '));
});

test('discoverCatalogScripts lists .sql recursively in lexical order', () => {
  const folder = scriptsFolder({
    '0002_roles.sql': 'SELECT 2;',
    '0001_menus.sql': 'SELECT 1;',
    'notes.txt': 'ignore me',
    'nested/0003_menu_types.SQL': 'SELECT 3;',
  });
  const found = discoverCatalogScripts({ folder });
  assert.deepEqual(found.map((entry) => entry.name), ['0001_menus.sql', '0002_roles.sql', 'nested/0003_menu_types.SQL']);
});

test('applyCatalogScripts is idempotent and tracks the ledger', async (t) => {
  const folder = scriptsFolder({
    '0001_menu.sql': 'UPDATE OR INSERT INTO MENU (CODMNU) VALUES (?) MATCHING (CODMNU);',
    '0002_role.sql': 'UPDATE OR INSERT INTO RUOLI (CODRUO) VALUES (?) MATCHING (CODRUO);',
  });
  const executed = [];
  const ledger = [];
  t.mock.method(Orm, 'query', async (_options, sql) => {
    if (sql.includes('RDB$RELATIONS')) return [{ '1': 1 }];
    if (sql.includes('FROM ACCESSI_CATALOG_SCRIPT')) {
      return ledger.map((entry) => ({ NAME: entry.name, CHECKSUM: entry.checksum }));
    }
    return [];
  });
  t.mock.method(Orm, 'execute', async (_options, sql, params) => {
    if (sql.includes('ACCESSI_CATALOG_SCRIPT')) {
      ledger.push({ name: params[0], checksum: params[1] });
      return [];
    }
    executed.push(sql);
    return [];
  });

  const options = { databaseOptions: {}, catalogScripts: { enabled: true, folder } };

  const first = await applyCatalogScripts(options);
  assert.deepEqual(first.applied, ['0001_menu.sql', '0002_role.sql']);
  assert.equal(first.skipped.length, 0);
  assert.equal(executed.length, 2);
  assert.equal(ledger.length, 2);

  executed.length = 0;
  const second = await applyCatalogScripts(options);
  assert.equal(second.applied.length, 0);
  assert.deepEqual(second.skipped, ['0001_menu.sql', '0002_role.sql']);
  assert.equal(executed.length, 0);
});

test('applyCatalogScripts fails on checksum mismatch by default and can reapply', async (t) => {
  const folder = scriptsFolder({ '0001_menu.sql': 'SELECT 1;' });
  const checksum = computeCatalogScriptChecksum('SELECT 1;');
  const executed = [];
  t.mock.method(Orm, 'query', async (_options, sql) => {
    if (sql.includes('RDB$RELATIONS')) return [{ '1': 1 }];
    if (sql.includes('FROM ACCESSI_CATALOG_SCRIPT')) return [{ NAME: '0001_menu.sql', CHECKSUM: `${checksum}-old` }];
    return [];
  });
  t.mock.method(Orm, 'execute', async (_options, sql) => {
    if (!sql.includes('ACCESSI_CATALOG_SCRIPT')) executed.push(sql);
    return [];
  });

  await assert.rejects(
    applyCatalogScripts({ databaseOptions: {}, catalogScripts: { enabled: true, folder } }),
    /checksum diverso/,
  );

  const report = await applyCatalogScripts({
    databaseOptions: {},
    catalogScripts: { enabled: true, folder, onChecksumMismatch: 'reapply' },
  });
  assert.deepEqual(report.applied, ['0001_menu.sql']);
  assert.equal(executed.length, 1);
});

test('analyzeCatalogScript allows row statements and rejects schema changes', () => {
  assert.deepEqual(analyzeCatalogScript(['UPDATE OR INSERT INTO MENU (CODMNU) VALUES (?) MATCHING (CODMNU)']), []);
  assert.deepEqual(analyzeCatalogScript(['MERGE INTO MENU USING (SELECT 1 FROM RDB$DATABASE) ON 1=0 WHEN NOT MATCHED THEN INSERT (CODMNU) VALUES (?)']), []);
  assert.deepEqual(analyzeCatalogScript(['-- comment\nDELETE FROM ABILITAZIONI WHERE CODUTE = ?']), []);

  const ddl = analyzeCatalogScript(['ALTER TABLE MENU ADD COLUMN X INTEGER']);
  assert.equal(ddl.length, 1);
  assert.match(ddl[0], /ALTER/);
  assert.equal(analyzeCatalogScript(['CREATE TRIGGER T FOR MENU AS BEGIN END']).length, 1);
  assert.equal(analyzeCatalogScript(['DROP TABLE MENU']).length, 1);
});

test('applyCatalogScripts reports invalid files but keeps applying the valid ones', async (t) => {
  const folder = scriptsFolder({
    '0001_menu.sql': 'UPDATE OR INSERT INTO MENU (CODMNU) VALUES (?) MATCHING (CODMNU);',
    '0002_schema.sql': 'ALTER TABLE MENU ADD COLUMN TEMP INTEGER;',
    '0003_role.sql': 'DELETE FROM RUOLI WHERE CODRUO = -1;',
  });
  const executed = [];
  const ledger = [];
  t.mock.method(Orm, 'query', async (_options, sql) => {
    if (sql.includes('RDB$RELATIONS')) return [{ '1': 1 }];
    if (sql.includes('FROM ACCESSI_CATALOG_SCRIPT')) return ledger.map((entry) => ({ NAME: entry.name, CHECKSUM: entry.checksum }));
    return [];
  });
  t.mock.method(Orm, 'execute', async (_options, sql, params) => {
    if (sql.includes('ACCESSI_CATALOG_SCRIPT')) { ledger.push({ name: params[0], checksum: params[1] }); return []; }
    executed.push(sql);
    return [];
  });

  const report = await applyCatalogScripts({ databaseOptions: {}, catalogScripts: { enabled: true, folder } });
  assert.deepEqual(report.applied, ['0001_menu.sql', '0003_role.sql']);
  assert.deepEqual(report.invalid.map((entry) => entry.script), ['0002_schema.sql']);
  assert.match(report.invalid[0].violations[0], /ALTER/);
  assert.equal(executed.length, 2);
  assert.equal(ledger.length, 2);
});
