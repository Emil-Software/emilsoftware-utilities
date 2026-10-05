require('ts-node/register/transpile-only');
require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DailyFileTransport } = require('../src/DailyFileTransport');
const { Logger } = require('../src/Logger');
const { Orm } = require('../src/Orm');
const { PermissionService } = require('../src/accessi-module/Services/PermissionService/PermissionService');
const { UserService } = require('../src/accessi-module/Services/UserService/UserService');
const { buildAuthenticatedTokenPayload, resolveCodiceUtenteFromTokenPayload, extractAccessiBearerToken } = require('../src/accessi-module/security/authenticatedToken');
const { ensureSuperUser, ensureAdmin, ensureUserManagement, ensureConsoleAccess, ensureSelfOrSuperUser, ensurePrivilegeFlagChanges } = require('../src/accessi-module/security/accessControl');
const { collectPasswordPolicyViolations, assertStrongPassword } = require('../src/accessi-module/security/passwordPolicy');
const { AuthService } = require('../src/accessi-module/Services/AuthService/AuthService');
const { SchemaExportService } = require('../src/accessi-module/Services/SchemaExportService/SchemaExportService');
const { AdminBootstrapService } = require('../src/accessi-module/Services/AdminBootstrapService/AdminBootstrapService');
const adminBootstrap = require('../src/accessi-module/security/adminBootstrap');

test('daily logs append across restart and rotate at local midnight even when idle', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'accessi-logs-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: new Date(2026, 8, 11, 23, 59, 59) });
  const transport = new DailyFileTransport(path.join(directory, 'nested', 'logs'));
  t.after(() => transport.close());
  const write = (target, text, time = new Date()) => new Promise((resolve, reject) => target.log({ time, [Symbol.for('message')]: JSON.stringify({ text }) }, error => error ? reject(error) : resolve()));
  const previousDay = new Date();
  await write(transport, 'before');
  t.mock.timers.tick(1000);
  const today = path.join(directory, 'nested', 'logs', '2026-09-12.json');
  assert.equal(fs.readFileSync(today, 'utf8'), '');
  await write(transport, 'after');
  await write(transport, 'queued-before', previousDay);
  const restarted = new DailyFileTransport(path.dirname(today));
  await write(restarted, 'restart');
  restarted.close();
  assert.deepEqual(fs.readFileSync(today, 'utf8').trim().split('\n').map(JSON.parse), [{ text: 'after' }, { text: 'restart' }]);
  assert.equal(fs.readFileSync(path.join(path.dirname(today), '2026-09-11.json'), 'utf8').trim().split('\n').length, 2);
  t.mock.timers.tick(86400000);
  assert.ok(fs.existsSync(path.join(path.dirname(today), '2026-09-13.json')));
});

test('all public log levels reach the file', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'accessi-levels-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const logger = new Logger('test', { logDirectory: directory });
  for (const method of ['info', 'error', 'debug', 'warning', 'log', 'dbLog']) logger[method](method);
  await new Promise((resolve, reject) => { logger.winstonLogger.once('error', reject); logger.winstonLogger.end(resolve); });
  logger.winstonLogger.close();
  const lines = fs.readdirSync(directory).flatMap(file => fs.readFileSync(path.join(directory, file), 'utf8').trim().split('\n')).map(JSON.parse);
  assert.equal(lines.length, 6);
  assert.deepEqual(new Set(lines.map(line => line.level)), new Set(['info', 'error', 'debug', 'warning', 'log', 'database']));
});

test('strict Bearer and current privileges replace legacy top-level claims', () => {
  assert.equal(extractAccessiBearerToken('Basic abc'), undefined);
  assert.equal(extractAccessiBearerToken(['Bearer abc']), undefined);
  assert.equal(extractAccessiBearerToken('Bearer abc extra'), undefined);
  assert.equal(extractAccessiBearerToken('bearer\tabc'), 'abc');
  assert.equal(resolveCodiceUtenteFromTokenPayload({ codiceUtente: 1.5 }), undefined);
  assert.equal(resolveCodiceUtenteFromTokenPayload({ codiceUtente: 1, typ: 'password-reset' }), undefined);
  const payload = buildAuthenticatedTokenPayload({ codiceUtente: 1, flagSuper: true }, { codiceUtente: 1, flagSuper: false, flagAdmin: false, statoRegistrazione: 1 });
  assert.equal(payload.flagSuper, false);
  assert.equal(payload.utente.flagSuper, false);
  assert.equal(payload.userData.utente.flagSuper, false);
});

test('role grants use maximum level and direct denials retain precedence', async t => {
  t.mock.method(Orm, 'query', async () => [{ FLAG_SUPER: '0' }]);
  const service = new PermissionService({ databaseOptions: {} });
  t.mock.method(service, 'getUserDirectPermissions', async () => [{ codiceMenu: 'denied', tipoAbilitazione: 0 }]);
  t.mock.method(service, 'getUserRoles', async () => [
    { menu: [{ codiceMenu: 'shared', tipoAbilitazione: 10 }, { codiceMenu: 'denied', tipoAbilitazione: 30 }] },
    { menu: [{ codiceMenu: 'shared', tipoAbilitazione: 30 }] },
  ]);
  const result = await service.getUserRolesAndGrants(1);
  assert.equal(result.grants.find(g => g.codiceMenu === 'shared').tipoAbilitazione, 30);
  assert.equal(result.grants.find(g => g.codiceMenu === 'denied').tipoAbilitazione, 0);
});

test('empty role and permission updates revoke assignments', async () => {
  const calls = [];
  const permissions = { assignRolesToUser: async (...args) => calls.push(args), assignPermissionsToUser: async (...args) => calls.push(args) };
  const service = new UserService({}, {}, permissions, { upsertFiltriUtente: async () => {} });
  await service.updateUser(1, { roles: [], permissions: [] }, { allowPrivilegedChanges: true });
  assert.deepEqual(calls, [[1, []], [1, []]]);
});

test('password policy rejects weak passwords and reports missing requirements', () => {
  assert.deepEqual(collectPasswordPolicyViolations('Aa1!aaaa'), []);
  assert.ok(collectPasswordPolicyViolations('aaaa').length > 0);
  assert.ok(collectPasswordPolicyViolations('Aaaa1111').some((item) => /speciale/.test(item)));
  assert.ok(collectPasswordPolicyViolations('Aa1! aaa').some((item) => /spazio/.test(item)));
  assert.ok(collectPasswordPolicyViolations('Aa1!aa').some((item) => /8 caratteri/.test(item)));
  assert.ok(collectPasswordPolicyViolations('Passw0rd').some((item) => /comune/.test(item)));

  assert.throws(() => assertStrongPassword('password'), (error) => {
    assert.equal(error.getStatus(), 400);
    const response = error.getResponse();
    assert.equal(response.code, 'ACCESSI_WEAK_PASSWORD');
    assert.ok(Array.isArray(response.details) && response.details.length > 0);
    return true;
  });

  assert.doesNotThrow(() => assertStrongPassword('Aa1!aaaa'));
});

test('setPassword enforces the policy unless disabled for legacy migration', async t => {
  t.mock.method(Orm, 'execute', async () => 'OK');
  const service = new AuthService({}, {}, { databaseOptions: {} }, {});
  await assert.rejects(() => service.setPassword(1, 'password'), /requisiti di sicurezza/);
  await service.setPassword(1, 'weakpass', { enforcePolicy: false });
  await service.setPassword(1, 'Aa1!aaaa');
});

test('updateUser writes every editable field with idempotent upsert', async t => {
  const executions = [];
  t.mock.method(Orm, 'execute', async (_options, query, params) => { executions.push({ query, params }); return 'OK'; });
  t.mock.method(Orm, 'query', async (_options, sql) => {
    if (String(sql).includes('C.FLGSUPER')) {
      return [{ codice_utente: 7, email: 'x@y.z', stato_registrazione: 20, flag_super: 0, flag_admin: 0, flag_due_fattori: 0, passwordless_login_enabled: 0, password_login_enabled: 1 }];
    }
    return [];
  });
  const service = new UserService(
    { databaseOptions: {} },
    {},
    { assignRolesToUser: async () => {}, assignPermissionsToUser: async () => {} },
    { upsertFiltriUtente: async () => {} },
  );

  await service.updateUser(7, {
    codiceUtente: 7,
    email: 'x@y.z',
    nome: 'Mario',
    cognome: 'Rossi',
    cellulare: '+393401234567',
    codiceLingua: 'it',
    avatar: 'mario.png',
    paginaDefault: '/dashboard',
    jsonMetadata: '{"theme":"dark"}',
    dataScadenzaPassword: '2026-01-01',
    statoRegistrazione: 20,
    flagGdpr: true,
    flagSuper: true,
    flagAdmin: true,
    flagDueFattori: true,
    passwordlessLoginEnabled: false,
    passwordLoginEnabled: true,
  }, { allowPrivilegedChanges: true });

  const utentiQuery = executions.find((entry) => entry.query.startsWith('UPDATE UTENTI SET'));
  assert.ok(utentiQuery, 'manca l update di UTENTI');
  assert.match(utentiQuery.query, /usrname = \?/);
  assert.match(utentiQuery.query, /stareg = \?/);
  assert.match(utentiQuery.query, /flggdpr = \?/);
  assert.match(utentiQuery.query, /DATSCAPWD = CAST\(\? AS DATE\)/);

  const configQuery = executions.find((entry) => entry.query.includes('UTENTI_CONFIG'));
  assert.ok(configQuery, 'manca l upsert di UTENTI_CONFIG');
  assert.match(configQuery.query, /UPDATE OR INSERT INTO UTENTI_CONFIG/);
  assert.match(configQuery.query, /MATCHING \(CODUTE\)/);
  for (const column of ['cognome', 'nome', 'avatar', 'cellulare', 'codlingua', 'PAGDEF', 'json_metadata', 'flg2fatt', 'flgpwdless', 'flgsuper', 'FLGADMIN', 'flgpassword']) {
    assert.ok(configQuery.query.includes(column), `colonna mancante: ${column}`);
  }
});

test('permanent delete removes the user and all dependent rows in one transaction', async t => {
  const calls = [];
  t.mock.method(Orm, 'executeMultiple', async (_options, queries) => { calls.push(queries); return 'OK'; });
  const service = new UserService({ databaseOptions: {} }, {}, { assignRolesToUser: async () => {}, assignPermissionsToUser: async () => {} }, { upsertFiltriUtente: async () => {} });
  t.mock.method(service, 'getUsers', async () => [{ utente: { codiceUtente: 7, email: 'x@y.z' } }]);

  await service.deleteUserPermanently(7);

  const queries = calls[0].map((entry) => entry.query);
  assert.equal(queries.length, 10);
  assert.match(queries[0], /DELETE FROM ABILITAZIONI WHERE CODUTE = \?/);
  assert.match(queries.at(-1), /DELETE FROM UTENTI WHERE CODUTE = \?/);
  assert.ok(calls[0].every((entry) => entry.params[0] === 7));
});

test('permanent delete rejects an unknown user', async t => {
  const service = new UserService({ databaseOptions: {} }, {}, {}, {});
  t.mock.method(service, 'getUsers', async () => []);
  await assert.rejects(() => service.deleteUserPermanently(404), /Nessun utente/);
});

test('batch grants match the historical single-user composition', async t => {
  t.mock.method(Orm, 'query', async (_options, sql) => {
    if (sql.includes('FLGSUPER')) {
      return [
        { codice_utente: 1, flag_super: 0 },
        { codice_utente: 2, flag_super: 1 },
      ];
    }
    if (sql.includes('FROM ABILITAZIONI')) {
      return [
        { codice_utente: 1, codice_menu: 'shared', tipo_abilitazione: 10, descrizione_menu: 'Shared' },
        { codice_utente: 1, codice_menu: 'denied', tipo_abilitazione: 30, descrizione_menu: 'Denied' },
        { codice_utente: 2, codice_menu: 'other', tipo_abilitazione: 10, descrizione_menu: 'Other' },
      ];
    }
    if (sql.includes('FROM UTENTI_RUOLI')) {
      return [
        { codice_utente: 1, codice_ruolo: 5, descrizione_ruolo: 'R5', codice_menu: 'shared', tipo_abilitazione: 30, descrizione_menu: 'Shared' },
        { codice_utente: 1, codice_ruolo: 5, descrizione_ruolo: 'R5', codice_menu: 'denied', tipo_abilitazione: 30, descrizione_menu: 'Denied' },
      ];
    }
    if (sql.includes('FROM MENU M')) {
      return [{ codice_menu: 'm1', tipo_abilitazione: 30, descrizione_menu: 'M1' }];
    }
    return [];
  });

  const service = new PermissionService({ databaseOptions: {} });
  const result = await service.getUsersRolesAndGrants([1, 2]);
  assert.equal(result.size, 2);

  const user1 = result.get(1);
  assert.equal(user1.grants.find(g => g.codiceMenu === 'shared').tipoAbilitazione, 10);
  assert.equal(user1.grants.find(g => g.codiceMenu === 'denied').tipoAbilitazione, 30);
  assert.equal(user1.ruoli.length, 1);

  const user2 = result.get(2);
  assert.deepEqual(user2.grants.map(g => g.codiceMenu), ['m1']);
});

test('super and admin responsibilities stay separate', () => {
  const superUser = { codiceUtente: 1, flagSuper: true, flagAdmin: false };
  const admin = { codiceUtente: 2, flagSuper: false, flagAdmin: true };
  const plain = { codiceUtente: 3, flagSuper: false, flagAdmin: false };

  // Admin: catalogo/token/SSO, ma non e un superutente.
  assert.doesNotThrow(() => ensureAdmin(admin));
  assert.throws(() => ensureAdmin(superUser), /riservata agli amministratori/);
  assert.throws(() => ensureAdmin(plain));

  // Superutente: gestione utenti (non quella del catalogo).
  assert.doesNotThrow(() => ensureSuperUser(superUser));
  assert.throws(() => ensureSuperUser(admin));

  // Console: super o admin; utenti: entrambi.
  assert.doesNotThrow(() => ensureConsoleAccess(superUser));
  assert.doesNotThrow(() => ensureConsoleAccess(admin));
  assert.throws(() => ensureConsoleAccess(plain));
  assert.doesNotThrow(() => ensureUserManagement(superUser));
  assert.doesNotThrow(() => ensureUserManagement(admin));
  assert.throws(() => ensureUserManagement(plain));

  // Self-or-super lascia passare anche l'admin sui dati altrui.
  assert.doesNotThrow(() => ensureSelfOrSuperUser(admin, 999));
  assert.doesNotThrow(() => ensureSelfOrSuperUser(plain, 3));
  assert.throws(() => ensureSelfOrSuperUser(plain, 999));
});

test('privilege flag changes follow the actor role', () => {
  const superUser = { codiceUtente: 1, flagSuper: true, flagAdmin: false };
  const admin = { codiceUtente: 2, flagSuper: false, flagAdmin: true };
  const superAdmin = { codiceUtente: 4, flagSuper: true, flagAdmin: true };
  const plain = { codiceUtente: 3, flagSuper: false, flagAdmin: false };

  // Superutente: solo il flag super, mai quello admin.
  assert.doesNotThrow(() => ensurePrivilegeFlagChanges(superUser, { flagSuper: true }));
  assert.throws(() => ensurePrivilegeFlagChanges(superUser, { flagAdmin: true }), /admin/);

  // Admin (anche non super): entrambi i flag.
  assert.doesNotThrow(() => ensurePrivilegeFlagChanges(admin, { flagSuper: true, flagAdmin: true }));
  assert.doesNotThrow(() => ensurePrivilegeFlagChanges(superAdmin, { flagSuper: true, flagAdmin: true }));

  // Utente semplice: nessun flag.
  assert.throws(() => ensurePrivilegeFlagChanges(plain, { flagSuper: false }));
  assert.throws(() => ensurePrivilegeFlagChanges(plain, { flagAdmin: false }));
});

test('schema export generates the complete DDL from the canonical schema', () => {
  const service = new SchemaExportService({});
  const ddl = service.buildDdl();
  assert.deepEqual(ddl.sections.map((section) => section.id), ['tables', 'generators', 'foreignKeys', 'indexes', 'checks', 'triggers']);
  assert.match(ddl.script, /CREATE TABLE MENU \(/);
  assert.match(ddl.script, /ALTER TABLE MENU ADD CONSTRAINT PK_MENU PRIMARY KEY \(CODMNU\);/);
  assert.match(ddl.script, /CREATE SEQUENCE GEN_UTENTI_ID;/);
  assert.match(ddl.script, /ADD CONSTRAINT FK_MENU_1 FOREIGN KEY \(CODGRP\) REFERENCES MENU_GRP \(CODGRP\);/);
  assert.match(ddl.script, /CREATE TRIGGER UTENTI_BI FOR UTENTI ACTIVE BEFORE INSERT/);
  assert.match(ddl.script, /SET TERM \^ ;/);
  // Ogni tabella ha CREATE TABLE e PRIMARY KEY.
  for (const table of ['UTENTI', 'UTENTI_CONFIG', 'MENU', 'ABILITAZIONI', 'ACCESSI_CATALOG_SCRIPT']) {
    assert.match(ddl.script, new RegExp(`CREATE TABLE ${table} \\(`));
    assert.match(ddl.script, new RegExp(`PK_${table} PRIMARY KEY`));
  }
});

test('admin bootstrap token is per-process and constant-time validated', () => {
  adminBootstrap.clearAdminBootstrapToken();
  const token = adminBootstrap.getOrCreateAdminBootstrapToken();
  assert.equal(adminBootstrap.getOrCreateAdminBootstrapToken(), token);
  assert.equal(adminBootstrap.isValidAdminBootstrapToken(token), true);
  assert.equal(adminBootstrap.isValidAdminBootstrapToken('nope'), false);
  assert.equal(adminBootstrap.isValidAdminBootstrapToken(undefined), false);
  adminBootstrap.clearAdminBootstrapToken();
  assert.equal(adminBootstrap.isValidAdminBootstrapToken(token), false);
});

test('admin bootstrap service creates a confirmed admin without email and invalidates the token', async () => {
  adminBootstrap.clearAdminBootstrapToken();
  const calls = { register: [], setPassword: [] };
  const userService = { register: async (data, opts) => { calls.register.push([data, opts]); return 42; } };
  const authService = { setPassword: async (code, pwd) => { calls.setPassword.push([code, pwd]); } };

  const disabled = new AdminBootstrapService({ adminBootstrap: { enabled: false } }, userService, authService);
  await assert.rejects(disabled.bootstrap({ token: 'x', email: 'a@b.c' }), /non e abilitato/);

  const enabled = new AdminBootstrapService({ adminBootstrap: { enabled: true } }, userService, authService);
  const token = adminBootstrap.getOrCreateAdminBootstrapToken();
  await assert.rejects(enabled.bootstrap({ token: 'wrong', email: 'a@b.c' }), /Token di bootstrap non valido/);

  const result = await enabled.bootstrap({ token, email: 'Admin@Example.com', nome: 'A', cognome: 'B' });
  assert.equal(result.codiceUtente, 42);
  assert.equal(result.email, 'admin@example.com');
  assert.equal(result.passwordGenerated, true);
  assert.ok(result.password && result.password.length >= 12);
  assert.equal(calls.register[0][0].flagAdmin, true);
  assert.equal(calls.register[0][0].flagSuper, true);
  assert.equal(calls.register[0][1].initialState, 20);
  assert.deepEqual(calls.setPassword[0], [42, result.password]);
  await assert.rejects(enabled.bootstrap({ token, email: 'x@y.z' }), /Token di bootstrap non valido/);
});
