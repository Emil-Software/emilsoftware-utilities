require('ts-node/register/transpile-only');
require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { plainToInstance } = require('class-transformer');
const { validate } = require('class-validator');
const { Orm } = require('../src/Orm');
const { AuthService } = require('../src/accessi-module/Services/AuthService/AuthService');
const { TwoFactorService } = require('../src/accessi-module/Services/TwoFactorService/TwoFactorService');
const { FederatedAuthService } = require('../src/accessi-module/federated-auth/FederatedAuthService');
const { UserService } = require('../src/accessi-module/Services/UserService/UserService');
const { UserDto } = require('../src/accessi-module/Dtos/UserDto');
const { StatoRegistrazione } = require('../src/accessi-module/Dtos/StatoRegistrazione');
const { isAccessiTokenAllowedForUser } = require('../src/accessi-module/security/authenticatedToken');
const { getAccessiJwtSecret } = require('../src/accessi-module/security/passwordResetToken');
const options = { databaseOptions: {}, jwtOptions: { secret: 'test-two-factor-secret', expiresIn: '1h' }, federatedAuthentication: { enabled: true } };
const baseUser = { codiceUtente: 1, email: 'user@example.com', statoRegistrazione: StatoRegistrazione.CONF, flagSuper: false, flagAdminConfigurator: false, flagDueFattori: false, passwordlessLoginEnabled: false, passwordLoginEnabled: true };

/** Isolated transactional adapter: real service hashing, limits and lifecycle, no live database or email. */
function challengeFixture(t) {
  const rows = new Map();
  const emails = [];
  let now = Date.now();
  let failDelivery = false;
  let gate = Promise.resolve();
  const query = (sql, params = []) => {
    if (sql.startsWith('SELECT CODUTE FROM UTENTI')) return [{ CODUTE: 1 }];
    if (sql.startsWith('SELECT COUNT')) return [{ TOTAL: [...rows.values()].filter(row => row.CREATED_AT > now - 900000).length }];
    if (sql.startsWith('DELETE')) return [];
    if (sql.startsWith('INSERT')) {
      const [id, user, email, mode, identity, hash] = params;
      const row = { CODUTE: user, EMAIL: email, AUTHMODE: mode, IDNKEY: identity, CODEHASH: hash, CREATED_AT: now, EXPIRES_AT: new Date(now + 600000), SENT_AT: new Date(now), ATTEMPTS: 0, SENDS: 1 };
      rows.set(id, row);
      return { EXPIRES_AT: row.EXPIRES_AT };
    }
    if (sql.startsWith('SELECT')) {
      const row = rows.get(params[0]);
      return row && row.EXPIRES_AT > now && row.ATTEMPTS < 5 ? [{ ...row }] : [];
    }
    if (sql.includes('ATTEMPTS = ATTEMPTS + 1')) {
      const row = rows.get(params[0]);
      if (!row || row.EXPIRES_AT <= now || row.ATTEMPTS >= 5) return { CODUTE: null };
      row.ATTEMPTS++;
      return { ...row };
    }
    if (sql.includes('SENDS = SENDS + 1')) {
      const row = rows.get(params[1]);
      if (!row || row.EXPIRES_AT <= now || row.ATTEMPTS >= 5 || row.SENDS >= 3 || row.SENT_AT > now - 60000) return { CODUTE: null };
      row.CODEHASH = params[0]; row.SENDS++; row.SENT_AT = new Date(now);
      return { ...row };
    }
    if (sql.startsWith('UPDATE ACCESSI_2FA SET ATTEMPTS = ?')) {
      const row = rows.get(params[1]);
      if (row && (params.length < 3 || row.CODEHASH === params[2])) row.ATTEMPTS = params[0];
      return [];
    }
    throw new Error(`Unexpected query: ${sql}`);
  };
  t.mock.method(Orm, 'connect', async () => ({ detach: callback => callback() }));
  t.mock.method(Orm, 'startTransaction', async () => {
    let release;
    const previous = gate;
    gate = new Promise(resolve => { release = resolve; });
    await previous;
    const snapshot = structuredClone(rows);
    return { release, snapshot, query(sql, params, callback) {
      try { callback(null, query(sql, params)); } catch (error) { callback(error); }
    } };
  });
  t.mock.method(Orm, 'commitTransaction', async transaction => transaction.release());
  t.mock.method(Orm, 'rollbackTransaction', async transaction => {
    rows.clear(); for (const [key, value] of transaction.snapshot) rows.set(key, value);
    transaction.release();
  });
  t.mock.method(Orm, 'query', async (_options, sql, params, logging) => { assert.equal(logging, false); return query(sql, params); });
  t.mock.method(Orm, 'execute', async (_options, sql, params, logging) => { assert.equal(logging, false); return query(sql, params); });
  const service = new TwoFactorService(options, { sendTwoFactorCode: async (email, code) => { if (failDelivery) throw new Error('SMTP failed'); emails.push({ email, code }); } });
  return { service, rows, emails, advance: ms => { now += ms; }, fail: () => { failDelivery = true; } };
}

test('OTP issuance, hashing, no premature JWT, single-use under concurrency', async t => {
  const f = challengeFixture(t);
  const challenge = await f.service.issue({ codiceUtente: 1, email: baseUser.email, mode: 'password' });
  assert.equal(challenge.twoFactorRequired, true);
  assert.equal(challenge.token, undefined);
  assert.match(f.emails[0].code, /^\d{6}$/);
  assert.notEqual(f.rows.get(challenge.challengeId).CODEHASH, f.emails[0].code);
  const attempts = await Promise.allSettled([f.service.consume(challenge.challengeId, f.emails[0].code), f.service.consume(challenge.challengeId, f.emails[0].code)]);
  assert.equal(attempts.filter(a => a.status === 'fulfilled').length, 1);
});

test('failed codes persist, five attempts lock the challenge and resends never reset attempts', async t => {
  const f = challengeFixture(t);
  const challenge = await f.service.issue({ codiceUtente: 1, email: baseUser.email, mode: 'password' });
  const wrong = f.emails[0].code === '000000' ? '111111' : '000000';
  await assert.rejects(f.service.consume(challenge.challengeId, wrong));
  f.advance(60000);
  await f.service.resend(challenge.challengeId);
  assert.equal(f.rows.get(challenge.challengeId).ATTEMPTS, 1);
  for (let i = 0; i < 4; i++) await assert.rejects(f.service.consume(challenge.challengeId, f.emails.at(-1).code === '000000' ? '111111' : '000000'));
  await assert.rejects(f.service.consume(challenge.challengeId, f.emails.at(-1).code));
  await assert.rejects(f.service.resend(challenge.challengeId));
  assert.equal(f.rows.get(challenge.challengeId).ATTEMPTS, 5);
});

test('resend cooldown, old code invalidation and original expiration', async t => {
  const f = challengeFixture(t);
  const challenge = await f.service.issue({ codiceUtente: 1, email: baseUser.email, mode: 'passwordless' });
  const originalHash = f.rows.get(challenge.challengeId).CODEHASH;
  await assert.rejects(f.service.resend(challenge.challengeId), error => error.getStatus() === 429);
  f.advance(60000);
  const resent = await f.service.resend(challenge.challengeId);
  assert.equal(resent.expiresAt, challenge.expiresAt);
  assert.notEqual(f.rows.get(challenge.challengeId).CODEHASH, originalHash);
  f.advance(600000);
  await assert.rejects(f.service.consume(challenge.challengeId, f.emails.at(-1).code));
});

test('SMTP failure invalidates the challenge', async t => {
  const f = challengeFixture(t); f.fail();
  await assert.rejects(f.service.issue({ codiceUtente: 1, email: baseUser.email, mode: 'password' }), error => error.getStatus() === 503);
  assert.equal([...f.rows.values()][0].ATTEMPTS, 5);
});

test('database limits bound resends and new challenges per account', async t => {
  const f = challengeFixture(t);
  const proof = { codiceUtente: 1, email: baseUser.email, mode: 'password' };
  const challenge = await f.service.issue(proof);
  f.advance(60000); await f.service.resend(challenge.challengeId);
  f.advance(60000); await f.service.resend(challenge.challengeId);
  f.advance(60000); await assert.rejects(f.service.resend(challenge.challengeId));
  for (let i = 0; i < 4; i++) await f.service.issue(proof);
  await assert.rejects(f.service.issue(proof), error => error.getStatus() === 429);
});

test('wrong password never issues a second-factor challenge', async t => {
  const user = { ...baseUser, flagDueFattori: true };
  let issued = false;
  const service = new AuthService({ getUserByEmail: async () => user, getAuthenticatedUserSnapshot: async () => user }, {}, { ...options, federatedAuthentication: { enabled: false } }, { issue: async () => { issued = true; } });
  t.mock.method(service, 'verifyPassword', async () => false);
  await assert.rejects(service.login({ email: user.email, password: 'wrong-password' }));
  assert.equal(issued, false);
});

test('Nest guard, Express middleware and token lookup all reject sessions missing required OTP', async () => {
  const { JwtSimpleGuard } = require('../src/accessi-module/jwt/jwt.strategy');
  const { AuthenticateGenService } = require('../src/accessi-module/middleware/authenticateGen');
  const user = { ...baseUser, flagDueFattori: true };
  const users = { getAuthenticatedUserSnapshot: async () => user };
  const token = jwt.sign({ utente: baseUser, typ: 'access', amr: ['federated'] }, getAccessiJwtSecret(options, 'access'));
  const request = { headers: { authorization: `Bearer ${token}` }, method: 'GET', url: '/protected' };
  const guard = new JwtSimpleGuard(options, users);
  await assert.rejects(guard.canActivate({ switchToHttp: () => ({ getRequest: () => request }) }), error => error.getStatus() === 401);
  let status;
  const response = { status(value) { status = value; return this; }, json(value) { return value; } };
  await new AuthenticateGenService(options, {}, users).authorize(request, response, () => assert.fail('Protected handler must not run'));
  assert.equal(status, 401);
  await assert.rejects(new AuthService(users, {}, options, {}).getAuthenticatedTokenPayload(token));
});

for (const mode of ['off', 'password', 'passwordless']) {
  test(`local login policy: ${mode}`, async t => {
    const user = { ...baseUser, flagDueFattori: mode !== 'off', passwordlessLoginEnabled: mode === 'passwordless' };
    const challenge = { challengeId: 'a'.repeat(64), twoFactorRequired: true };
    const users = { getUserByEmail: async () => user, getAuthenticatedUserSnapshot: async () => user };
    const service = new AuthService(users, {}, { ...options, federatedAuthentication: { enabled: false } }, { issue: async proof => { assert.equal(proof.mode, mode); return challenge; } });
    const verify = t.mock.method(service, 'verifyPassword', async () => true);
    t.mock.method(service, 'getLoginResultForUser', async () => ({ utente: user }));
    t.mock.method(Orm, 'query', async () => []);
    const response = await service.login({ email: user.email, ...(mode === 'passwordless' ? {} : { password: 'Password-123' }) });
    assert.equal(verify.mock.callCount(), mode === 'passwordless' ? 0 : 1);
    if (mode === 'off') assert.equal(response.utente.codiceUtente, 1);
    else { assert.deepEqual(response, { challenge }); assert.equal(response.token, undefined); }
  });
}

test('unknown user and password users have identical email-only first step', async () => {
  for (const user of [null, baseUser]) {
    const service = new AuthService({ getUserByEmail: async () => user, getAuthenticatedUserSnapshot: async () => user }, {}, options, {});
    assert.deepEqual(await service.login({ email: baseUser.email }), { passwordRequired: true });
  }
});

test('JWT policy enforces optional 2FA and revokes passwordless sessions when disabled', () => {
  assert.equal(isAccessiTokenAllowedForUser({}, baseUser), true);
  const enabled = { ...baseUser, flagDueFattori: true };
  assert.equal(isAccessiTokenAllowedForUser({ amr: ['password'] }, enabled), false);
  assert.equal(isAccessiTokenAllowedForUser({ amr: ['federated'] }, enabled), false);
  assert.equal(isAccessiTokenAllowedForUser({ amr: ['federated', 'otp'] }, enabled), true);
  assert.equal(isAccessiTokenAllowedForUser({ amr: ['passwordless', 'otp'] }, enabled), false);
  assert.equal(isAccessiTokenAllowedForUser({ amr: ['passwordless', 'otp'] }, { ...enabled, passwordlessLoginEnabled: true }), true);
});

test('SSO respects the optional flag and returns a challenge without token when enabled', async t => {
  for (const enabled of [false, true]) {
    const user = { ...baseUser, flagDueFattori: enabled };
    const challenge = { challengeId: 'b'.repeat(64) };
    const service = new FederatedAuthService(options, { getAuthenticatedUserSnapshot: async () => user }, {
      getLoginResultForUser: async () => ({ utente: user }), createAccessiToken: () => ({ value: 'session' }),
      beginFederatedTwoFactor: async () => ({ challenge }),
    });
    t.mock.method(service, 'assertProviderActive', async () => ({}));
    t.mock.method(service, 'findIdentity', async () => ({ codiceUtente: 1, identityKey: 'identity' }));
    t.mock.method(Orm, 'execute', async () => []);
    const response = await service.authenticate({ provider: 'test-provider', subject: 'external-user' });
    if (enabled) { assert.equal(response.token, undefined); assert.deepEqual(response.login, { challenge }); }
    else assert.equal(response.token.value, 'session');
  }
});

test('completion checks current state, email, local policy and active SSO provider', async t => {
  const user = { ...baseUser, flagDueFattori: true };
  const proof = { codiceUtente: 1, email: baseUser.email, mode: 'federated', identityKey: 'identity' };
  const service = new AuthService({ getAuthenticatedUserSnapshot: async () => user }, {}, options, { consume: async () => proof });
  t.mock.method(service, 'getLoginResultForUser', async () => ({ utente: user }));
  const query = t.mock.method(Orm, 'query', async () => []);
  t.mock.method(Orm, 'execute', async () => []);
  await assert.rejects(service.verifyTwoFactor('challenge', '123456'));
  query.mock.mockImplementation(async () => [{ IDNKEY: 'identity' }]);
  const response = await service.verifyTwoFactor('challenge', '123456');
  assert.deepEqual(jwt.verify(response.token.value, getAccessiJwtSecret(options, 'access')).amr, ['federated', 'otp']);
  user.email = 'changed@example.com';
  await assert.rejects(service.verifyTwoFactor('challenge', '123456'));
  user.email = baseUser.email; user.statoRegistrazione = StatoRegistrazione.BLOCC;
  await assert.rejects(service.verifyTwoFactor('challenge', '123456'));
});

test('2FA settings are privileged, require a valid combination, and reject string booleans', async () => {
  const service = new UserService({}, {}, {}, {});
  await assert.rejects(service.updateUser(1, { flagDueFattori: false }));
  service.getAuthenticatedUserSnapshot = async () => baseUser;
  await assert.rejects(service.updateUser(1, { passwordlessLoginEnabled: true }, { allowPrivilegedChanges: true }));
  const invalid = plainToInstance(UserDto, { flagDueFattori: 'false', passwordlessLoginEnabled: 'false' }, { enableImplicitConversion: true });
  assert.equal((await validate(invalid)).length, 2);
});
