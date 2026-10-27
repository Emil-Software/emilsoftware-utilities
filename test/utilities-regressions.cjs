require('ts-node/register/transpile-only');
require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PasswordUtilities, RestUtilities, DateUtilities } = require('../src/Utilities');
const { Orm } = require('../src/Orm');
const { getTableColumns, clearTableColumnsCache } = require('../src/accessi-module/database-updates/optionalColumns');
const { autobind } = require('../src/autobind');
const { Logger } = require('../src/Logger');
const { checkPublicAuthRateLimit } = require('../src/accessi-module/security/publicAuthRateLimit');
const { AllegatiAuthorizationGuard } = require('../src/allegati-module/security/allegatiAuthorizationGuard');
const { toUtcDate, normalizeFirebirdResult } = require('../src/firebird-compat');

test('timingSafeStringEquals accepts equal values and rejects different ones', () => {
  assert.equal(PasswordUtilities.timingSafeStringEquals('abc', 'abc'), true);
  assert.equal(PasswordUtilities.timingSafeStringEquals('abc', 'abd'), false);
  assert.equal(PasswordUtilities.timingSafeStringEquals('abc', 'abcd'), false);
  assert.equal(PasswordUtilities.timingSafeStringEquals('', ''), true);
  // Tipi non stringa non devono lanciare.
  assert.equal(PasswordUtilities.timingSafeStringEquals(undefined, 'x'), false);
});

test('printQueryWithParams sostituisce i placeholder letteralmente', () => {
  assert.equal(
    RestUtilities.printQueryWithParams('SELECT * FROM T WHERE A = ? AND B = ?', ['x?y', 'a$&b']),
    'SELECT * FROM T WHERE A = x?y AND B = a$&b',
  );
  // Placeholder senza parametro restano intatti; null diventa NULL.
  assert.equal(RestUtilities.printQueryWithParams('SELECT ?', []), 'SELECT ?');
  assert.equal(RestUtilities.printQueryWithParams('SELECT ?', [null]), 'SELECT NULL');
});

test('autobind lega i metodi e mantiene la catena dei metadata (DI Nest)', () => {
  class Service {
    constructor(value) {
      this.value = value;
    }
    read() {
      return this.value;
    }
  }

  Reflect.defineMetadata('design:paramtypes', [Number], Service);

  const Bound = autobind(Service);
  const instance = new Bound(7);

  assert.equal(instance.read(), 7);
  assert.equal(instance instanceof Service, true);
  assert.equal(Reflect.getMetadata('design:paramtypes', Bound)[0], Number);

  // Il metodo staccato resta legato all'istanza.
  const detachedRead = instance.read;
  assert.equal(detachedRead(), 7);
});

test('rate limit blocca dopo il numero massimo e non e aggirabile cambiando soggetto', () => {
  const options = { publicAuthRateLimit: { login: { windowMs: 60000, maxAttempts: 2 } } };
  const req = { ip: '203.0.113.77', socket: {} };

  assert.equal(checkPublicAuthRateLimit(options, 'login', req).allowed, true);
  assert.equal(checkPublicAuthRateLimit(options, 'login', req).allowed, true);

  const blocked = checkPublicAuthRateLimit(options, 'login', req);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds > 0);

  // Con IP gia bloccato un nuovo identificatore resta bloccato (short-circuit).
  const blockedByIp = checkPublicAuthRateLimit(options, 'login', req, ['nuovo@example.com']);
  assert.equal(blockedByIp.allowed, false);
});

test('allegati guard: secure by default, opt-out esplicito, nega/consente dalla callback', async () => {
  const context = { switchToHttp: () => ({ getRequest: () => ({ headers: {} }) }) };

  // Secure by default: senza authorize le richieste sono rifiutate.
  const secureDefault = new AllegatiAuthorizationGuard({ databaseOptions: {} });
  await assert.rejects(() => secureDefault.canActivate(context));

  // Opt-out esplicito: comportamento storico (aperto).
  const optedOut = new AllegatiAuthorizationGuard({ databaseOptions: {}, requireAuthorization: false });
  assert.equal(await optedOut.canActivate(context), true);

  const deny = new AllegatiAuthorizationGuard({ databaseOptions: {}, authorize: async () => false });
  await assert.rejects(() => deny.canActivate(context));

  const allow = new AllegatiAuthorizationGuard({ databaseOptions: {}, authorize: () => true });
  assert.equal(await allow.canActivate(context), true);
});

test('sendErrorMessage deriva lo status dalla HttpException', () => {
  const { BadRequestException } = require('@nestjs/common');
  const capture = () => {
    const state = {};
    return { state, res: { status(code) { state.status = code; return this; }, send(payload) { state.payload = payload; return this; } } };
  };

  const bad = capture();
  RestUtilities.sendErrorMessage(bad.res, new BadRequestException('campo non valido'), 'test');
  assert.equal(bad.state.status, 400, 'una BadRequestException deve produrre 400');
  assert.equal(bad.state.payload.statusCode, 2);

  const generic = capture();
  RestUtilities.sendErrorMessage(generic.res, new Error('boom'), 'test');
  assert.equal(generic.state.status, 500, 'un errore generico resta 500');
});

test('getTableColumns usa una cache a breve TTL e si invalida', async (t) => {
  clearTableColumnsCache();
  let calls = 0;
  t.mock.method(Orm, 'query', async () => {
    calls += 1;
    return [{ COLUMN_NAME: 'CODUTE' }];
  });

  const options = { databaseOptions: { host: 'cache-host', database: 'cache-db' } };
  const first = await getTableColumns(options, 'UTENTI');
  const second = await getTableColumns(options, 'UTENTI');

  assert.ok(first.has('CODUTE'));
  assert.equal(second, first);
  assert.equal(calls, 1, 'la seconda lettura deve usare la cache');

  clearTableColumnsCache();
  await getTableColumns(options, 'UTENTI');
  assert.equal(calls, 2, 'dopo l invalidazione si rilegge dal database');
});

test('Logger redige i campi sensibili e serializza gli Error', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'accessi-log-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  const logger = new Logger('redaction', { logDirectory: directory });
  logger.info({ utente: 'mario', password: 'segretissima', nested: { token: 'abc' }, ok: 1 });
  logger.error(new Error('boom'));

  await new Promise((resolve, reject) => {
    logger.winstonLogger.once('error', reject);
    logger.winstonLogger.end(resolve);
  });

  const content = fs.readdirSync(directory)
    .map((file) => fs.readFileSync(path.join(directory, file), 'utf8'))
    .join('\n');

  assert.ok(content.includes('[REDACTED]'));
  assert.ok(!content.includes('segretissima'));
  assert.ok(!content.includes('"abc"'));
  assert.ok(content.includes('boom'));
});

test('Logger rispetta il livello minimo configurato', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'accessi-level-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));

  const logger = new Logger('level', { logDirectory: directory, level: 'error' });
  logger.info('messaggio-info-da-escludere');
  logger.error('messaggio-errore-da-includere');

  await new Promise((resolve, reject) => {
    logger.winstonLogger.once('error', reject);
    logger.winstonLogger.end(resolve);
  });

  const content = fs.readdirSync(directory)
    .map((file) => fs.readFileSync(path.join(directory, file), 'utf8'))
    .join('\n');

  assert.ok(content.includes('messaggio-errore-da-includere'));
  assert.ok(!content.includes('messaggio-info-da-escludere'));
});

test('Logger condivide un solo winston logger per la stessa directory', () => {
  const directory = path.join(os.tmpdir(), `accessi-shared-${process.pid}`);
  const first = new Logger('uno', { logDirectory: directory });
  const second = new Logger('due', { logDirectory: directory });
  assert.equal(first.winstonLogger, second.winstonLogger);
});

test('DateUtilities formatta in modo stabile', () => {
  const date = new Date(2026, 0, 2, 3, 4, 5);
  assert.equal(DateUtilities.dateToSql(date), '2026-01-02 03:04:05');
  assert.equal(DateUtilities.dateToSimple(date), '02-01-2026');
});

test('toUtcDate reinterpreta il wall-clock locale come UTC (compat es-node-firebird)', () => {
  // node-firebird 2.x decodifica DATE/TIME/TIMESTAMP come ora locale; il fork
  // es-node-firebird li restituiva come UTC. toUtcDate deve riprodurre il fork.
  const local = new Date(2026, 0, 2, 3, 4, 5); // 2026-01-02 03:04:05 locale
  const utc = toUtcDate(local);
  assert.equal(utc.toISOString(), '2026-01-02T03:04:05.000Z');
  // L'istanza originale non deve essere mutata.
  assert.equal(local.getFullYear(), 2026);
  assert.equal(local.getHours(), 3);
});

test('toUtcDate riproduce setUTCMilliseconds del fork per DATE/TIME/TIMESTAMP', () => {
  // Il fork (stato finale) usava setUTCMilliseconds per DATE, TIME e TIMESTAMP.
  // Simuliamo ciò che node-firebird 2.x restituisce (ora locale) e verifichiamo
  // che toUtcDate produca lo stesso valore UTC del fork.
  const DateOffset = 40587; // giorni dal 17/11/1858 al 01/01/1970
  const TimeCoeff = 24 * 60 * 60 * 1000; // ms per giorno

  // DATE: 2026-01-02 (giorni dal 17/11/1858)
  const dateDays = Math.floor(Date.UTC(2026, 0, 2) / TimeCoeff) + DateOffset;
  const forkDate = new Date(0);
  forkDate.setUTCMilliseconds((dateDays - DateOffset) * TimeCoeff);
  const driverDate = new Date(0);
  driverDate.setMilliseconds((dateDays - DateOffset) * TimeCoeff + driverDate.getTimezoneOffset() * 60000);
  assert.equal(toUtcDate(driverDate).getTime(), forkDate.getTime());

  // TIME: 03:04:05 (frazioni di giorno * 10)
  const timeValue = ((3 * 3600 + 4 * 60 + 5) * 1000) * 10;
  const forkTime = new Date(0);
  forkTime.setUTCMilliseconds(Math.floor(timeValue / 10));
  const driverTime = new Date(0);
  driverTime.setMilliseconds(Math.floor(timeValue / 10) + driverTime.getTimezoneOffset() * 60000);
  assert.equal(toUtcDate(driverTime).getTime(), forkTime.getTime());

  // TIMESTAMP: 2026-01-02 03:04:05
  const tsDate = Math.floor(Date.UTC(2026, 0, 2) / TimeCoeff) + DateOffset;
  const tsTime = ((3 * 3600 + 4 * 60 + 5) * 1000) * 10;
  const forkTs = new Date(0);
  forkTs.setUTCMilliseconds((tsDate - DateOffset) * TimeCoeff + Math.floor(tsTime / 10));
  const driverTs = new Date(0);
  driverTs.setMilliseconds((tsDate - DateOffset) * TimeCoeff + Math.floor(tsTime / 10) + driverTs.getTimezoneOffset() * 60000);
  assert.equal(toUtcDate(driverTs).getTime(), forkTs.getTime());
});

test('normalizeFirebirdResult trima le stringhe come il fork (.trim)', () => {
  // Il fork chiamava .trim() (spazi iniziali e finali) sui campi testo.
  assert.equal(normalizeFirebirdResult('  abc  ', true, true), 'abc');
  assert.equal(normalizeFirebirdResult('abc   ', true, true), 'abc');
  assert.equal(normalizeFirebirdResult('   abc', true, true), 'abc');
  // Con trimStringResults=false la stringa resta intatta.
  assert.equal(normalizeFirebirdResult('  abc  ', false, true), '  abc  ');
});

test('normalizeFirebirdResult converte le Date in UTC e ricorre in array/oggetti', () => {
  const local = new Date(2026, 0, 2, 3, 4, 5);
  const expected = toUtcDate(local).toISOString();

  // Data diretta.
  assert.equal(normalizeFirebirdResult(local, true, true).toISOString(), expected);
  // Data dentro array.
  const arr = normalizeFirebirdResult([local, '  x  '], true, true);
  assert.equal(arr[0].toISOString(), expected);
  assert.equal(arr[1], 'x');
  // Data dentro oggetto annidato.
  const obj = normalizeFirebirdResult({ a: { b: local }, c: '  y  ' }, true, true);
  assert.equal(obj.a.b.toISOString(), expected);
  assert.equal(obj.c, 'y');
  // Con utcDates=false la data resta invariata.
  assert.equal(normalizeFirebirdResult(local, true, false), local);
});

test('normalizeFirebirdResult lascia intatti Buffer, null e undefined', () => {
  const buf = Buffer.from('abc');
  assert.equal(normalizeFirebirdResult(buf, true, true), buf);
  assert.equal(normalizeFirebirdResult(null, true, true), null);
  assert.equal(normalizeFirebirdResult(undefined, true, true), undefined);
  assert.equal(normalizeFirebirdResult(42, true, true), 42);
  assert.equal(normalizeFirebirdResult(true, true, true), true);
});

test('emilsoftware-utilities serve node-firebird come drop-in di es-node-firebird', () => {
  // Il pacchetto deve ri-esporre l'intera API di node-firebird (funzioni,
  // costanti e namespace) cosi che migrare da es-node-firebird richieda solo
  // il cambio dell'import, senza toccare il resto del codice.
  const index = require('../src/index');

  // Funzioni principali.
  for (const fn of ['attach', 'create', 'attachOrCreate', 'pool', 'drop', 'escape']) {
    assert.equal(typeof index[fn], 'function', `manca la funzione ${fn}`);
  }

  // Costanti di isolamento e autenticazione usate dal fork.
  for (const c of [
    'ISOLATION_READ_UNCOMMITTED',
    'ISOLATION_READ_COMMITTED',
    'ISOLATION_REPEATABLE_READ',
    'ISOLATION_SERIALIZABLE',
    'ISOLATION_READ_COMMITTED_READ_ONLY',
    'AUTH_PLUGIN_LEGACY',
    'AUTH_PLUGIN_SRP',
    'WIRE_CRYPT_ENABLE',
    'WIRE_CRYPT_DISABLE',
  ]) {
    assert.ok(index[c] !== undefined, `manca la costante ${c}`);
  }

  // Namespace Firebird: deve esporre le stesse funzioni.
  assert.equal(typeof index.Firebird, 'object', 'manca il namespace Firebird');
  assert.equal(typeof index.Firebird.attach, 'function');
  assert.equal(typeof index.Firebird.pool, 'function');
  assert.equal(index.Firebird.ISOLATION_READ_COMMITTED, index.ISOLATION_READ_COMMITTED);
});
