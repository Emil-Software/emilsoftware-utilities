require('ts-node/register/transpile-only');
require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { AuthService } = require('../src/accessi-module/Services/AuthService/AuthService');
const { createMemorySessionRevocationStore } = require('../src/accessi-module/security/sessionRevocation');
const {
  createMemoryRefreshTokenRotationStore,
  createRedisRefreshTokenRotationStore,
} = require('../src/accessi-module/security/refreshTokenRotation');
const { getAccessiJwtSecret } = require('../src/accessi-module/security/passwordResetToken');

const USER = {
  codiceUtente: 42,
  email: 'refresh@example.test',
  flagSuper: false,
  flagAdmin: false,
  flagDueFattori: false,
  statoRegistrazione: 20,
};

function buildService(extra = {}) {
  const options = {
    databaseOptions: {},
    encryptionKey: '0123456789ABCDEF',
    jwtOptions: {
      secret: 'r'.repeat(32),
      expiresIn: '1h',
      refreshExpiresIn: '30d',
      issuer: 'accessi',
      audience: 'backend-a',
    },
    ...extra,
  };
  let currentUser = { ...USER };
  const userService = {
    async getAuthenticatedUserSnapshot() {
      return currentUser;
    },
    async getUsers() {
      return [{ utente: { ...currentUser } }];
    },
  };
  const filtriService = {
    async getFiltriUser() {
      return [];
    },
  };
  const authService = new AuthService(userService, filtriService, options, {});
  return {
    authService,
    options,
    setCurrentUser(user) {
      currentUser = user;
    },
  };
}

test('login token pair contains access and refresh tokens', () => {
  const { authService, options } = buildService();
  const pair = authService.createTokenPair(USER, ['password']);

  assert.ok(pair.access.value);
  assert.ok(pair.refresh?.value);
  const refreshPayload = jwt.verify(pair.refresh.value, getAccessiJwtSecret(options, 'refresh'), {
    algorithms: ['HS256'],
    issuer: 'accessi',
    audience: 'backend-a',
  });
  assert.equal(refreshPayload.typ, 'refresh');
  assert.equal(refreshPayload.utente.codiceUtente, 42);
  assert.ok(refreshPayload.jti);
});

test('refresh token can be exchanged for a new pair', async () => {
  const { authService } = buildService();
  const pair = authService.createTokenPair(USER, ['password']);
  const refreshed = await authService.refreshAccessToken(pair.refresh.value);

  assert.ok(refreshed.token?.value);
  assert.ok(refreshed.refreshToken?.value);
  assert.notEqual(refreshed.token.value, pair.access.value);
});

test('access token cannot be used as refresh token', async () => {
  const { authService } = buildService();
  const pair = authService.createTokenPair(USER, ['password']);

  await assert.rejects(
    () => authService.refreshAccessToken(pair.access.value),
    /Refresh token non valido/,
  );
});

test('refresh token is rejected after session revocation', async () => {
  const store = createMemorySessionRevocationStore();
  const { authService } = buildService({ sessionRevocation: { store } });
  const pair = authService.createTokenPair(USER, ['password']);
  await store.revokeUser(USER.codiceUtente, Date.now() + 5_000);

  await assert.rejects(
    () => authService.refreshAccessToken(pair.refresh.value),
    /Sessione revocata/,
  );
});

test('refresh token is rejected for a disabled user', async () => {
  const { authService, setCurrentUser } = buildService();
  const pair = authService.createTokenPair(USER, ['password']);
  setCurrentUser({ ...USER, statoRegistrazione: 99 });

  await assert.rejects(
    () => authService.refreshAccessToken(pair.refresh.value),
    /non piu autorizzato/,
  );
});

test('refresh token rotation makes a refresh token single-use', async () => {
  const store = createMemoryRefreshTokenRotationStore();
  const { authService } = buildService({ refreshTokenRotation: { store } });
  const pair = authService.createTokenPair(USER, ['password']);

  const first = await authService.refreshAccessToken(pair.refresh.value);
  assert.ok(first.token?.value);

  await assert.rejects(
    () => authService.refreshAccessToken(pair.refresh.value),
    /gia utilizzato/,
  );
});

test('concurrent refresh calls succeed only once with rotation', async () => {
  const store = createMemoryRefreshTokenRotationStore();
  const { authService } = buildService({ refreshTokenRotation: { store } });
  const pair = authService.createTokenPair(USER, ['password']);

  const results = await Promise.allSettled([
    authService.refreshAccessToken(pair.refresh.value),
    authService.refreshAccessToken(pair.refresh.value),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
});

test('redis refresh rotation store uses atomic SET NX', async () => {
  const data = new Set();
  const client = {
    async eval(script, _numKeys, ...args) {
      if (script.includes("redis.call('PING')")) return 'PONG';
      if (script.includes("redis.call('SET'")) {
        const key = args[0];
        if (data.has(key)) return null;
        data.add(key);
        return 'OK';
      }
      throw new Error(`Script non gestito: ${script}`);
    },
  };
  const store = createRedisRefreshTokenRotationStore({ client });
  assert.equal(await store.consume('jti-1', Date.now() + 60_000), true);
  assert.equal(await store.consume('jti-1', Date.now() + 60_000), false);
  assert.equal(await store.healthCheck(), true);
});

test('refresh token is not emitted without refreshExpiresIn', () => {
  const { authService } = buildService({
    jwtOptions: {
      secret: 'r'.repeat(32),
      expiresIn: '1h',
    },
  });
  const pair = authService.createTokenPair(USER, ['password']);
  assert.equal(pair.refresh, undefined);
});
