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
