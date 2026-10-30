require('ts-node/register/transpile-only');
require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { AuthService } = require('../src/accessi-module/Services/AuthService/AuthService');
const { UserService } = require('../src/accessi-module/Services/UserService/UserService');
const { Orm } = require('../src/Orm');
const { StatoRegistrazione } = require('../src/accessi-module/Dtos/StatoRegistrazione');
const {
  createMemorySessionRevocationStore,
  isAccessiTokenRevoked,
  revokeAccessiUserSessionsIfConfigured,
} = require('../src/accessi-module/security/sessionRevocation');
const {
  createMemoryRefreshTokenRotationStore,
  createRedisRefreshTokenRotationStore,
} = require('../src/accessi-module/security/refreshTokenRotation');
const {
  createMemoryAccessTokenRevocationStore,
  createRedisAccessTokenRevocationStore,
  revokeAccessiAccessToken,
  revokeAccessiAccessTokenIfConfigured,
} = require('../src/accessi-module/security/accessTokenRevocation');

const USER = {
  codiceUtente: 42,
  email: 'revocation@example.test',
  flagSuper: false,
  flagAdmin: false,
  flagDueFattori: false,
  statoRegistrazione: StatoRegistrazione.CONF,
};

function buildOptions(extra = {}) {
  return {
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
}

function buildService(extra = {}) {
  const options = buildOptions(extra);
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

function buildUserService(options) {
  return new UserService(options, {}, {}, {});
}

async function rejectsWithCode(promiseFactory, code) {
  try {
    await promiseFactory();
  } catch (error) {
    const response = typeof error?.getResponse === 'function' ? error.getResponse() : undefined;
    assert.equal(response?.code, code, `atteso code ${code}, ricevuto ${JSON.stringify(response)}`);
    return error;
  }
  assert.fail(`Atteso rifiuto con code ${code}.`);
}

async function withStubbedOrm(t, execute = async () => 1) {
  const originalExecute = Orm.execute;
  const originalExecuteMultiple = Orm.executeMultiple;
  Orm.execute = execute;
  Orm.executeMultiple = async (_db, statements) => {
    for (const statement of statements ?? []) await execute(_db, statement.query, statement.params);
    return [];
  };
  t.after(() => {
    Orm.execute = originalExecute;
    Orm.executeMultiple = originalExecuteMultiple;
  });
}

// ---------------------------------------------------------------- issue #5

test('access e refresh token condividono lo stesso fid di famiglia', () => {
  const { authService } = buildService();
  const pair = authService.createTokenPair(USER, ['password']);
  const access = jwt.decode(pair.access.value);
  const refresh = jwt.decode(pair.refresh.value);

  assert.ok(access.fid);
  assert.equal(access.fid, refresh.fid);
  assert.ok(Number.isFinite(access.iatMs));
});

test('riuso di un refresh token consumato revoca la famiglia', async () => {
  const rotation = createMemoryRefreshTokenRotationStore();
  const { authService, options } = buildService({
    refreshTokenRotation: { store: rotation, reuseGraceMs: 0 },
  });
  const pair = authService.createTokenPair(USER, ['password']);
  const first = await authService.refreshAccessToken(pair.refresh.value);

  await rejectsWithCode(
    () => authService.refreshAccessToken(pair.refresh.value),
    'ACCESSI_REFRESH_TOKEN_REUSE',
  );

  // I token emessi dal primo scambio appartengono alla famiglia revocata.
  await rejectsWithCode(
    () => authService.refreshAccessToken(first.refreshToken.value),
    'ACCESSI_REFRESH_FAMILY_REVOKED',
  );
  assert.equal(
    await isAccessiTokenRevoked(options, jwt.decode(first.token.value), USER.codiceUtente),
    true,
  );
});

test('il riuso entro la finestra di grazia non revoca la famiglia', async () => {
  const rotation = createMemoryRefreshTokenRotationStore();
  const { authService } = buildService({ refreshTokenRotation: { store: rotation } });
  const pair = authService.createTokenPair(USER, ['password']);

  const results = await Promise.allSettled([
    authService.refreshAccessToken(pair.refresh.value),
    authService.refreshAccessToken(pair.refresh.value),
  ]);
  const fulfilled = results.filter((result) => result.status === 'fulfilled');
  assert.equal(fulfilled.length, 1);

  // Il refresh token del vincitore resta utilizzabile: nessuna revoca famiglia.
  const next = await authService.refreshAccessToken(fulfilled[0].value.refreshToken.value);
  assert.ok(next.token?.value);
});

test('riuso con revokeUserSessionsOnReuse revoca anche le altre sessioni utente', async () => {
  const rotation = createMemoryRefreshTokenRotationStore();
  const session = createMemorySessionRevocationStore();
  const { authService, options } = buildService({
    sessionRevocation: { store: session },
    refreshTokenRotation: {
      store: rotation,
      reuseGraceMs: 0,
      revokeUserSessionsOnReuse: true,
    },
  });
  const otherDevice = authService.createTokenPair(USER, ['password']);
  const pair = authService.createTokenPair(USER, ['password']);
  await authService.refreshAccessToken(pair.refresh.value);

  await rejectsWithCode(
    () => authService.refreshAccessToken(pair.refresh.value),
    'ACCESSI_REFRESH_TOKEN_REUSE',
  );

  assert.equal(
    await isAccessiTokenRevoked(options, jwt.decode(otherDevice.access.value), USER.codiceUtente),
    true,
  );
});

test('store di rotazione senza supporto famiglie rifiuta comunque il riuso', async () => {
  const used = new Set();
  const legacyStore = {
    async consume(jti) {
      if (used.has(jti)) return false;
      used.add(jti);
      return true;
    },
  };
  const { authService } = buildService({ refreshTokenRotation: { store: legacyStore } });
  const pair = authService.createTokenPair(USER, ['password']);
  await authService.refreshAccessToken(pair.refresh.value);

  await assert.rejects(() => authService.refreshAccessToken(pair.refresh.value), /gia utilizzato/);
});

test('store Redis di rotazione espone consumo con timestamp e revoca famiglia', async () => {
  const used = new Map();
  const families = new Set();
  const client = {
    async eval(script, _numKeys, ...args) {
      if (script.includes("'PING'")) return 'PONG';
      if (script.includes("'EXISTS'")) return families.has(args[0]) ? 1 : 0;
      if (script.includes("'GET'") && script.includes("'SET'")) {
        const key = args[0];
        if (used.has(key)) return [0, used.get(key)];
        used.set(key, Number(args[1]));
        return [1, 0];
      }
      if (script.includes("'SET'")) {
        families.add(args[0]);
        return 'OK';
      }
      throw new Error(`Script non gestito: ${script}`);
    },
  };
  const store = createRedisRefreshTokenRotationStore({ client });
  const expiresAt = Date.now() + 60_000;

  const first = await store.consumeWithMetadata('jti-1', expiresAt);
  assert.equal(first.consumed, true);

  const second = await store.consumeWithMetadata('jti-1', expiresAt);
  assert.equal(second.consumed, false);
  assert.ok(Number.isFinite(second.consumedAtMs));

  assert.equal(await store.isFamilyRevoked('family-1'), false);
  await store.revokeFamily('family-1', expiresAt);
  assert.equal(await store.isFamilyRevoked('family-1'), true);
  assert.equal(await store.healthCheck(), true);
});

// ---------------------------------------------------------------- issue #4

test('cambio password revoca i token emessi prima e lascia validi i nuovi', async (t) => {
  await withStubbedOrm(t);
  const store = createMemorySessionRevocationStore();
  const { authService, options } = buildService({ sessionRevocation: { store } });
  const previous = authService.createTokenPair(USER, ['password']);

  await authService.setPassword(USER.codiceUtente, 'NuovaPassword1!');

  assert.equal(
    await isAccessiTokenRevoked(options, jwt.decode(previous.access.value), USER.codiceUtente),
    true,
  );
  assert.equal(
    await isAccessiTokenRevoked(options, jwt.decode(previous.refresh.value), USER.codiceUtente),
    true,
  );

  // Attende il millisecondo successivo al cutoff prima del nuovo login.
  await new Promise((resolve) => setTimeout(resolve, 5));
  const fresh = authService.createTokenPair(USER, ['password']);
  assert.equal(
    await isAccessiTokenRevoked(options, jwt.decode(fresh.access.value), USER.codiceUtente),
    false,
  );
});

test('cambio password senza store di revoca non fallisce', async (t) => {
  await withStubbedOrm(t);
  const { authService, options } = buildService();
  await authService.setPassword(USER.codiceUtente, 'NuovaPassword1!');
  assert.equal(await revokeAccessiUserSessionsIfConfigured(options, USER.codiceUtente), false);
});

test('la migrazione trasparente della password non revoca le sessioni', async (t) => {
  await withStubbedOrm(t);
  const store = createMemorySessionRevocationStore();
  const { authService, options } = buildService({ sessionRevocation: { store } });
  const previous = authService.createTokenPair(USER, ['password']);

  await authService.setPassword(USER.codiceUtente, 'AltraPassword1!', {
    enforcePolicy: false,
    revokeSessions: false,
  });

  assert.equal(
    await isAccessiTokenRevoked(options, jwt.decode(previous.access.value), USER.codiceUtente),
    false,
  );
});

test('blocco ed eliminazione utente revocano le sessioni, la conferma no', async (t) => {
  await withStubbedOrm(t);
  const store = createMemorySessionRevocationStore();
  const options = buildOptions({ sessionRevocation: { store } });
  const userService = buildUserService(options);
  const previous = buildService({ sessionRevocation: { store } }).authService.createTokenPair(USER, ['password']);
  const payload = jwt.decode(previous.access.value);

  await userService.setStato(USER.codiceUtente, StatoRegistrazione.CONF);
  assert.equal(await isAccessiTokenRevoked(options, payload, USER.codiceUtente), false);

  await userService.setStato(USER.codiceUtente, StatoRegistrazione.BLOCC);
  assert.equal(await isAccessiTokenRevoked(options, payload, USER.codiceUtente), true);

  store.clear();
  await userService.deleteUser(USER.codiceUtente);
  assert.equal(await isAccessiTokenRevoked(options, payload, USER.codiceUtente), true);
});

test('eliminazione definitiva revoca le sessioni residue', async (t) => {
  const calls = [];
  await withStubbedOrm(t, async (_db, query) => {
    calls.push(query);
    return 1;
  });
  const store = createMemorySessionRevocationStore();
  const options = buildOptions({ sessionRevocation: { store } });
  const userService = buildUserService(options);
  userService.getUsers = async () => [{ utente: { ...USER } }];
  const previous = buildService({ sessionRevocation: { store } }).authService.createTokenPair(USER, ['password']);

  await userService.deleteUserPermanently(USER.codiceUtente);

  assert.equal(
    await isAccessiTokenRevoked(options, jwt.decode(previous.access.value), USER.codiceUtente),
    true,
  );
});

// ---------------------------------------------------------------- issue #3

test('revoca jti invalida solo il token indicato', async () => {
  const store = createMemoryAccessTokenRevocationStore();
  const options = buildOptions({ accessTokenRevocation: { store } });
  const { authService } = buildService({ accessTokenRevocation: { store } });
  const first = authService.createTokenPair(USER, []);
  const second = authService.createTokenPair(USER, []);
  const firstPayload = jwt.decode(first.access.value);

  await revokeAccessiAccessToken(options, firstPayload.jti, firstPayload.exp * 1000);

  assert.equal(await isAccessiTokenRevoked(options, firstPayload, USER.codiceUtente), true);
  assert.equal(
    await isAccessiTokenRevoked(options, jwt.decode(second.access.value), USER.codiceUtente),
    false,
  );
});

test('revoca jti senza store configurato e un no-op esplicito', async () => {
  const options = buildOptions();
  const { authService } = buildService();
  const pair = authService.createTokenPair(USER, []);
  const payload = jwt.decode(pair.access.value);

  assert.equal(await revokeAccessiAccessTokenIfConfigured(options, payload.jti), false);
  assert.equal(await isAccessiTokenRevoked(options, payload, USER.codiceUtente), false);
});

test('store Redis per jti usa SET con TTL e EXISTS', async () => {
  const revoked = new Set();
  const client = {
    async eval(script, _numKeys, ...args) {
      if (script.includes("'PING'")) return 'PONG';
      if (script.includes("'EXISTS'")) return revoked.has(args[0]) ? 1 : 0;
      if (script.includes("'SET'")) {
        revoked.add(args[0]);
        return 'OK';
      }
      throw new Error(`Script non gestito: ${script}`);
    },
  };
  const store = createRedisAccessTokenRevocationStore({ client });
  assert.equal(await store.isRevoked('jti-x'), false);
  await store.revoke('jti-x', Date.now() + 60_000);
  assert.equal(await store.isRevoked('jti-x'), true);
  assert.equal(await store.healthCheck(), true);
});

test('un token emesso dopo il cutoff di revoca utente resta valido', async () => {
  const store = createMemorySessionRevocationStore();
  const { authService, options } = buildService({ sessionRevocation: { store } });
  await store.revokeUser(USER.codiceUtente, Date.now());
  await new Promise((resolve) => setTimeout(resolve, 5));
  const fresh = authService.createTokenPair(USER, []);
  assert.equal(
    await isAccessiTokenRevoked(options, jwt.decode(fresh.access.value), USER.codiceUtente),
    false,
  );
});
