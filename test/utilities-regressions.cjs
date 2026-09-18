require('ts-node/register/transpile-only');
require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PasswordUtilities, RestUtilities, DateUtilities } = require('../src/Utilities');
const { autobind } = require('../src/autobind');
const { checkPublicAuthRateLimit } = require('../src/accessi-module/security/publicAuthRateLimit');
const { AllegatiAuthorizationGuard } = require('../src/allegati-module/security/allegatiAuthorizationGuard');

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

test('allegati guard: no-op senza authorize, nega/consente in base alla callback', async () => {
  const context = { switchToHttp: () => ({ getRequest: () => ({ headers: {} }) }) };

  const noHook = new AllegatiAuthorizationGuard({ databaseOptions: {} });
  assert.equal(await noHook.canActivate(context), true);

  const deny = new AllegatiAuthorizationGuard({ databaseOptions: {}, authorize: async () => false });
  await assert.rejects(() => deny.canActivate(context));

  const allow = new AllegatiAuthorizationGuard({ databaseOptions: {}, authorize: () => true });
  assert.equal(await allow.canActivate(context), true);
});

test('DateUtilities formatta in modo stabile', () => {
  const date = new Date(2026, 0, 2, 3, 4, 5);
  assert.equal(DateUtilities.dateToSql(date), '2026-01-02 03:04:05');
  assert.equal(DateUtilities.dateToSimple(date), '02-01-2026');
});
