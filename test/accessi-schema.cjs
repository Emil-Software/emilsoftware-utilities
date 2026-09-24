require('ts-node/register/transpile-only');
require('reflect-metadata');
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const fb = require('node-firebird');
const { Orm } = require('../src/Orm');
const { Logger } = require('../src/Logger');
const { AccessiDatabaseUpdater: Updater } = require('../src/accessi-module/database-updates/AccessiDatabaseUpdater');
const { ACCESSI_VERSION_KEY, ACCESSI_SCHEMA_VERSION } = require('../src/accessi-module/database-updates/accessiSchema');
const { UserService } = require('../src/accessi-module/Services/UserService/UserService');
const { FiltriService } = require('../src/accessi-module/Services/FiltriService/FiltriService');
const { PermissionService } = require('../src/accessi-module/Services/PermissionService/PermissionService');

for (const method of ['info', 'log', 'warning', 'error']) Logger.prototype[method] = () => {};

// Il pool e' attivo di default: chiudilo a fine suite per permettere l'uscita del processo.
after(async () => { await Orm.closePools(); });

// Use a dedicated, disposable Firebird server/directory. Never run against a host application's database.
const directory = process.env.ACCESSI_TEST_DB_DIRECTORY;
const port = Number(process.env.ACCESSI_TEST_DB_PORT || 3050);
const authPlugin = process.env.ACCESSI_TEST_DB_AUTH_PLUGIN;
const wireCrypt = process.env.ACCESSI_TEST_DB_WIRE_CRYPT;
const integration = directory ? test : test.skip;
let counter = 0;
async function database(t) {
  // Il percorso e' lato server (Linux in docker): separatori forward-slash, non path.join di Windows.
  const file = `${directory.replace(/[\\/]+$/, '')}/accessi-schema-${process.pid}-${++counter}.fdb`;
  // poolSize 0: nessun pool per gli scenari di migrazione, cosi' il DDL non incontra transazioni concorrenti (stabile su Firebird 2.5).
  const databaseOptions = { host: '127.0.0.1', port, database: file, user: 'SYSDBA', password: process.env.ACCESSI_TEST_DB_PASSWORD || 'masterkey', blobAsText: true, poolSize: 0 };
  // Firebird 2.5 usa Legacy_Auth e wire crypt disabilitato (stessi env degli integration test).
  if (wireCrypt) databaseOptions.wireCrypt = wireCrypt === 'disabled' ? fb.WIRE_CRYPT_DISABLE : wireCrypt;
  if (authPlugin) databaseOptions.pluginName = authPlugin;
  await new Promise((resolve, reject) => fb.create(databaseOptions, (error, db) => {
    if (error) return reject(error);
    db.detach(error => error ? reject(error) : resolve());
  }));
  // Il file puo' essere su un server remoto (docker): la pulizia locale e' best-effort.
  t.after(() => { try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch { /* file remoto: il container e' effimero */ } });
  return {
    databaseOptions,
    autoUpdateDatabase: true,
    jwtOptions: { secret: 'schema-test-only', expiresIn: '1h' },
    // L'email e obbligatoria per il bootstrap del modulo.
    emailOptions: { host: 'localhost', port: 25, secure: false, requireTLS: false, tls: { rejectUnauthorized: false }, from: 'test@example.local', auth: { user: 'test', pass: 'test' } },
    mockDemoUser: false,
  };
}
const query = (o, sql, params = []) => Orm.query(o.databaseOptions, sql, params, false);
const exec = (o, sql, params = []) => Orm.execute(o.databaseOptions, sql, params, false);
const engineMajor = async o => {
  const rows = await query(o, "SELECT RDB$GET_CONTEXT('SYSTEM', 'ENGINE_VERSION') AS V FROM RDB$DATABASE");
  return Number.parseInt(String(rows[0]?.V ?? '3'), 10);
};
// Firebird 2.5 non conosce CREATE SEQUENCE / NEXT VALUE FOR.
const createGeneratorSql = (major, name) => major >= 3 ? `CREATE SEQUENCE ${name}` : `CREATE GENERATOR ${name}`;

integration('fresh database: generic schema, actual user operations and idempotent rerun', async t => {
  const o = await database(t);
  await Updater.run(o);
  assert.deepEqual(await Updater.inspectSchema(o), { compatible: true, issues: [] });
  const columns = await query(o, "SELECT TRIM(RDB$FIELD_NAME) AS NAME FROM RDB$RELATION_FIELDS WHERE RDB$RELATION_NAME IN ('UTENTI', 'UTENTI_CONFIG', 'FILTRI')");
  for (const name of ['ENABLEIA', 'NUMMAC', 'IDXPOS', 'CODVET', 'NUMREP', 'RAGSOCCLI', 'CAUMOV', 'FLGMOP', 'FLGINVENTARI', 'FLGDIPENDENTI']) assert(columns.some(c => c.NAME === name), `colonna mancante: ${name}`);
  for (const table of ['UTENTI', 'MENU', 'FILTRI_TIPO', 'SSO_PROVIDER']) assert.equal((await query(o, `SELECT COUNT(*) AS N FROM ${table}`))[0].N, 0);
  const filters = new FiltriService(o);
  const users = new UserService(o, {}, new PermissionService(o), filters);
  const id = await users.register({ email: 'schema@example.test', nome: 'Test', cognome: 'Schema' });
  const user = await users.getUserByEmail('schema@example.test');
  assert.equal(user.codiceUtente, id);
  assert.equal(user.flagDueFattori, false);
  assert.equal(user.passwordLoginEnabled, true);
  assert.equal(user.nummac, null);
  assert.equal((await users.getUsers())[0].utente.codiceUtente, id);
  await filters.upsertFiltriUtente(id, { tipFil: 7 });
  assert.equal((await filters.getFiltriUser(id))[0].tipFil, 7);
  const privilegedId = await users.register({ email: 'flags@example.test', nummac: 10, caumov: 'VEN', flagMop: true }, { allowPrivilegedFields: true });
  const privilegedUser = await users.getUserByEmail('flags@example.test');
  assert.equal(privilegedUser.nummac, 10);
  assert.equal(privilegedUser.caumov, 'VEN');
  assert.equal(privilegedUser.flagMop, true);
  assert.equal((await query(o, 'SELECT COUNT(*) AS N FROM UTENTI'))[0].N, 2);
  await filters.upsertFiltriUtente(privilegedId, { codVet: 20 });
  assert.equal((await filters.getFiltriUser(privilegedId))[0].codVet, 20);
  await users.updateUser(id, { nome: 'Updated', ragSocCli: null, codVet: null });
  await users.setGdpr(id);
  assert.equal((await query(o, 'SELECT FLGGDPR FROM UTENTI WHERE CODUTE = ?', [id]))[0].FLGGDPR, 1);
  const ddl = [];
  const original = Orm.execute;
  t.mock.method(Orm, 'execute', async (...args) => { if (/^(CREATE|ALTER|DROP)/i.test(args[1])) ddl.push(args[1]); return original.apply(Orm, args); });
  await Updater.run(o);
  assert.deepEqual(ddl, []);
  assert.equal(await Updater.getCurrentVersion(o), ACCESSI_SCHEMA_VERSION);
});

integration('legacy partial schema: preserve host data/version and advance sequences past existing IDs', async t => {
  const o = await database(t);
  for (const sql of [
    'CREATE TABLE PARAMETRI (CODPAR VARCHAR(15) NOT NULL PRIMARY KEY, DESPAR VARCHAR(255))',
    "INSERT INTO PARAMETRI VALUES ('DBVERSION', '99.2.0')",
    "INSERT INTO PARAMETRI VALUES ('VersioneDB', '0.0a')",
    'CREATE TABLE UTENTI (CODUTE INTEGER NOT NULL CONSTRAINT CUSTOM_USER_PK PRIMARY KEY, USRNAME CHAR(120))',
    "INSERT INTO UTENTI VALUES (278, 'legacy@example.test')",
    'CREATE TABLE UTENTI_CONFIG (CODUTE INTEGER NOT NULL PRIMARY KEY, NUMMAC INTEGER, RAGSOCCLI VARCHAR(100), FLG2FATT SMALLINT DEFAULT 0, FLGPASSWORD SMALLINT)',
    "INSERT INTO UTENTI_CONFIG VALUES (278, 12, 'Host data', 1, NULL)",
    'CREATE TABLE FILTRI (CODUTE INTEGER NOT NULL, PROG INTEGER NOT NULL, CODVET INTEGER, IDXPOS SMALLINT, PRIMARY KEY (CODUTE, PROG))',
    'INSERT INTO FILTRI VALUES (278, 1, 57, 8)',
    'CREATE TABLE ACCESSI_2FA (CHALLENGE_ID VARCHAR(64) CHARACTER SET ASCII NOT NULL)',
    createGeneratorSql(await engineMajor(o), 'GEN_UTENTI_ID'),
  ]) await exec(o, sql);
  await Updater.run(o);
  assert((await Updater.inspectSchema(o)).compatible);
  assert.deepEqual((await query(o, "SELECT DESPAR FROM PARAMETRI WHERE CODPAR IN ('DBVERSION', 'VersioneDB') ORDER BY CODPAR")).map(r => r.DESPAR), ['99.2.0', '0.0a']);
  const config = (await query(o, 'SELECT NUMMAC, RAGSOCCLI, FLG2FATT, FLGPASSWORD, FLGPWDLESS FROM UTENTI_CONFIG'))[0];
  assert.deepEqual(config, { NUMMAC: 12, RAGSOCCLI: 'Host data', FLG2FATT: 1, FLGPASSWORD: 1, FLGPWDLESS: 0 });
  await exec(o, "INSERT INTO UTENTI (USRNAME) VALUES ('next@example.test')");
  assert.equal((await query(o, 'SELECT MAX(CODUTE) AS N FROM UTENTI'))[0].N, 279);
  const filters = new FiltriService(o);
  const users = new UserService(o, {}, new PermissionService(o), filters);
  const user = await users.getUserByEmail('legacy@example.test');
  assert.equal(user.nummac, 12);
  assert.equal(user.ragSocCli, 'Host data');
  assert.equal(user.codVet, 57);
  await filters.upsertFiltriUtente(278, { codVet: 58 });
  assert.equal((await filters.getFiltriUser(278))[0].codVet, 58);
});

integration('current version cannot hide missing columns; disabled updater is strictly read-only', async t => {
  const o = await database(t);
  await Updater.run(o);
  await exec(o, 'ALTER TABLE MENU DROP NOTE');
  const statements = [];
  const original = Orm.execute;
  const spy = t.mock.method(Orm, 'execute', async (...args) => { statements.push(args[1]); return original.apply(Orm, args); });
  const noUpdate = { ...o, autoUpdateDatabase: false, federatedAuthentication: { enabled: true, autoUpdateSchema: true } };
  await assert.rejects(new Updater(noUpdate).onModuleInit(), /MENU.NOTE/);
  assert.deepEqual(statements, []);
  spy.mock.restore();
  await Updater.run(o);
  assert((await Updater.inspectSchema(o)).compatible);
  await new Updater({ ...o, autoUpdateDatabase: false }).onModuleInit();
});

integration('future Accessi version and incompatible types fail without changing existing data', async t => {
  const o = await database(t);
  await exec(o, 'CREATE TABLE PARAMETRI (CODPAR VARCHAR(15) PRIMARY KEY, DESPAR VARCHAR(255))');
  await exec(o, 'INSERT INTO PARAMETRI VALUES (?, ?)', [ACCESSI_VERSION_KEY, '9.0.0']);
  await assert.rejects(Updater.run(o), /piu recente/);
  assert.equal((await query(o, "SELECT COUNT(*) AS N FROM RDB$RELATIONS WHERE RDB$RELATION_NAME = 'UTENTI'"))[0].N, 0);
  await exec(o, 'UPDATE PARAMETRI SET DESPAR = ? WHERE CODPAR = ?', ['1.4.0', ACCESSI_VERSION_KEY]);
  await exec(o, 'CREATE TABLE UTENTI (CODUTE VARCHAR(20) PRIMARY KEY)');
  await exec(o, "INSERT INTO UTENTI VALUES ('legacy-id')");
  await assert.rejects(Updater.run(o), /UTENTI.CODUTE.*intero/);
  assert.equal((await query(o, 'SELECT CODUTE FROM UTENTI'))[0].CODUTE, 'legacy-id');
  assert.equal(await Updater.getCurrentVersion(o), '1.4.0');
});

integration('populated partial table requires explicit backfill; a repaired rerun succeeds', async t => {
  const o = await database(t);
  await exec(o, 'CREATE TABLE ACCESSI_2FA (CHALLENGE_ID VARCHAR(64) CHARACTER SET ASCII NOT NULL)');
  await exec(o, "INSERT INTO ACCESSI_2FA VALUES ('incomplete')");
  await assert.rejects(Updater.run(o), /ACCESSI_2FA.CODUTE.*backfill/);
  assert.equal(await Updater.getCurrentVersion(o), null);
  assert.equal((await query(o, 'SELECT COUNT(*) AS N FROM ACCESSI_2FA'))[0].N, 1);
  // DBA explicitly discards the unusable fixture, not the migration.
  await exec(o, 'DELETE FROM ACCESSI_2FA');
  await Updater.run(o);
  assert((await Updater.inspectSchema(o)).compatible);
});

integration('detect inactive triggers, missing constraints and damaged sequence despite latest version', async t => {
  const o = await database(t);
  await Updater.run(o);
  await exec(o, 'ALTER TRIGGER RUOLI_BI INACTIVE');
  await exec(o, 'ALTER TABLE UTENTI_IDENTITA_EXT DROP CONSTRAINT FK_UTEIDEXT_PROVIDER');
  await exec(o, 'ALTER TABLE SSO_PROVIDER DROP CONSTRAINT CK_SSO_PROVIDER_ATTIVO');
  await exec(o, 'INSERT INTO RUOLI (CODRUO) VALUES (400)');
  const report = await Updater.inspectSchema(o);
  for (const part of ['RUOLI_BI', 'FK_UTEIDEXT_PROVIDER', 'CHECK', 'GEN_RUOLI_ID']) assert(report.issues.some(i => i.includes(part)), part);
  await assert.rejects(Updater.run(o), /RUOLI_BI/);
  await exec(o, 'ALTER TRIGGER RUOLI_BI ACTIVE');
  await Updater.run(o);
  await exec(o, "INSERT INTO RUOLI (DESRUO) VALUES ('new')");
  assert.equal((await query(o, 'SELECT MAX(CODRUO) AS N FROM RUOLI'))[0].N, 401);
});

test('parallel module lifecycle hooks share one initialization and read-only failures can retry', async t => {
  let calls = 0;
  const o = { databaseOptions: {}, autoUpdateDatabase: false };
  t.mock.method(Updater, 'assertCompatible', async () => { calls++; if (calls === 1) throw new Error('incompatible'); });
  await assert.rejects(Promise.all([Updater.initialize(o), Updater.initialize(o)]), /incompatible/);
  assert.equal(calls, 1);
  await Updater.initialize(o);
  assert.equal(calls, 2);
});
integration('historical SSO namespaces, renamed keys/triggers and legacy CHAR foreign keys remain compatible', async t => {
  const o = await database(t);
  for (const sql of [
    'CREATE TABLE MENU_GRP (CODGRP CHAR(1) NOT NULL PRIMARY KEY)',
    "INSERT INTO MENU_GRP VALUES ('X')",
    'CREATE TABLE MENU (CODMNU CHAR(20) NOT NULL PRIMARY KEY, CODGRP CHAR(1) NOT NULL)',
    "INSERT INTO MENU VALUES ('HOST_MENU', 'X')",
    'CREATE TABLE UTENTI (CODUTE INTEGER NOT NULL PRIMARY KEY, USRNAME CHAR(100))',
    "INSERT INTO UTENTI VALUES (10, 'sso@example.test')",
    'CREATE TABLE UTENTI_IDENTITA_EXT (IDNKEY CHAR(64) CHARACTER SET ASCII NOT NULL PRIMARY KEY, CODUTE INTEGER NOT NULL, PROVIDER VARCHAR(64) CHARACTER SET ASCII NOT NULL, SUBJECT VARCHAR(512) CHARACTER SET UTF8 NOT NULL)',
    "INSERT INTO UTENTI_IDENTITA_EXT VALUES ('identity-key', 10, 'host-provider', 'subject-123')",
  ]) await exec(o, sql);
  await Updater.run(o);
  assert.equal((await query(o, 'SELECT DESCRIZIONE FROM SSO_PROVIDER'))[0].DESCRIZIONE, 'host-provider');
  assert.equal((await query(o, 'SELECT CODMNU FROM MENU'))[0].CODMNU, 'HOST_MENU');
  await exec(o, 'ALTER TABLE UTENTI_IDENTITA_EXT DROP CONSTRAINT FK_UTEIDEXT_PROVIDER');
  await exec(o, 'ALTER TABLE UTENTI_IDENTITA_EXT ADD CONSTRAINT HOST_PROVIDER_LINK FOREIGN KEY (PROVIDER) REFERENCES SSO_PROVIDER (PROVIDER)');
  await exec(o, 'DROP TRIGGER RUOLI_BI');
  await exec(o, 'CREATE TRIGGER HOST_ROLE_ID FOR RUOLI ACTIVE BEFORE INSERT AS BEGIN IF (NEW.CODRUO IS NULL) THEN NEW.CODRUO = GEN_ID(GEN_RUOLI_ID,1); END');
  await Updater.run(o);
  assert((await Updater.inspectSchema(o)).compatible);
  assert.equal((await query(o, "SELECT COUNT(*) AS N FROM RDB$TRIGGERS WHERE RDB$TRIGGER_NAME = 'RUOLI_BI'"))[0].N, 0);
});

integration('orphaned references prevent certification and preserve the data for DBA repair', async t => {
  const o = await database(t);
  await exec(o, 'CREATE TABLE UTENTI_RUOLI (CODUTE INTEGER NOT NULL, CODRUO INTEGER NOT NULL)');
  await exec(o, 'INSERT INTO UTENTI_RUOLI VALUES (999, 999)');
  await assert.rejects(Updater.run(o), /FOREIGN KEY/);
  assert.equal(await Updater.getCurrentVersion(o), null);
  assert.equal((await query(o, 'SELECT COUNT(*) AS N FROM UTENTI_RUOLI'))[0].N, 1);
});

integration('Nest bootstrap awaits validation with SSO enabled and disabled, including repeated starts', async t => {
  const { NestFactory } = require('@nestjs/core');
  const { AccessiModule } = require('../src/accessi-module/AccessiModule');
  const o = await database(t);
  o.federatedAuthentication = { enabled: true, autoUpdateSchema: true };
  const app = await NestFactory.createApplicationContext(AccessiModule.forRoot(o), { logger: false, abortOnError: false });
  assert((await Updater.inspectSchema(o)).compatible);
  await app.close();
  // Reuse the exact options instance: every new application start still validates.
  await exec(o, 'ALTER TABLE MENU DROP NOTE');
  o.autoUpdateDatabase = false;
  o.federatedAuthentication.enabled = false;
  await assert.rejects(NestFactory.createApplicationContext(AccessiModule.forRoot(o), { logger: false, abortOnError: false }), /MENU.NOTE/);
});
integration('generic SQL snapshot and standalone read-only check match the schema contract', async t => {
  const o = await database(t);
  const major = await engineMajor(o);
  const snapshot = fs.readFileSync(path.join(__dirname, '../src/accessi-module/docs/accessi.sql'), 'utf8');
  // Lo snapshot documenta la sintassi 3.0+; su 2.5 i generatori usano CREATE GENERATOR.
  const portable = sql => major >= 3 ? sql : sql.replace(/\bCREATE SEQUENCE\b/gi, 'CREATE GENERATOR');
  const [ddl, rest] = snapshot.split('SET TERM ^ ;');
  for (const sql of ddl.replace(/--[^\n]*/g, '').split(';').map(s => s.trim()).filter(Boolean)) {
    if (!sql.startsWith('SET SQL DIALECT')) await exec(o, portable(sql));
  }
  for (const sql of rest.split('SET TERM ; ^')[0].split('^').map(s => s.trim()).filter(Boolean)) await exec(o, portable(sql));
  await Updater.assertCompatible(o);
  const { spawnSync } = require('node:child_process');
  const result = spawnSync(process.execPath, ['-r', 'ts-node/register/transpile-only', 'src/accessi-module/database-updates/runAccessiDbUpdate.ts', '--check'], {
    cwd: path.join(__dirname, '..'), encoding: 'utf8', env: { ...process.env,
      ACCESSI_DB_HOST: '127.0.0.1', ACCESSI_DB_PORT: String(port), ACCESSI_DB_DATABASE: o.databaseOptions.database,
      ACCESSI_DB_USER: o.databaseOptions.user, ACCESSI_DB_PASSWORD: o.databaseOptions.password,
      ACCESSI_DB_AUTH_PLUGIN: process.env.ACCESSI_TEST_DB_AUTH_PLUGIN, ACCESSI_DB_WIRE_CRYPT: process.env.ACCESSI_TEST_DB_WIRE_CRYPT,
    },
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(await Updater.getCurrentVersion(o), null, 'read-only check must not write the version');
});
