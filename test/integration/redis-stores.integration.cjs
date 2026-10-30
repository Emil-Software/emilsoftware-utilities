// Integration test opt-in contro un Redis reale.
//
// Modalita d'uso:
//   ACCESSI_TEST_REDIS_URL=redis://127.0.0.1:6379 npm run test:integration:redis
//
// Senza `ACCESSI_TEST_REDIS_URL` (o con Redis non raggiungibile) i test vengono
// saltati; con `ACCESSI_TEST_REQUIRE_REDIS=1` falliscono invece di essere saltati
// (usato dalla CI). Le chiavi usano un prefisso per processo, quindi la suite puo
// girare su un Redis condiviso senza cancellare dati altrui.
require('ts-node/register/transpile-only');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { RedisTestClient } = require('./helpers/redisTestClient.cjs');
const { createRedisRateLimitStore } = require('../../src/accessi-module/security/rateLimitStore');
const { createRedisConsoleEntryStore } = require('../../src/accessi-module/security/consoleEntry');
const { createRedisSessionRevocationStore } = require('../../src/accessi-module/security/sessionRevocation');
const {
  createRedisRefreshTokenRotationStore,
} = require('../../src/accessi-module/security/refreshTokenRotation');
const {
  createRedisAccessTokenRevocationStore,
} = require('../../src/accessi-module/security/accessTokenRevocation');

const REDIS_URL = (process.env.ACCESSI_TEST_REDIS_URL ?? '').trim();
const REQUIRE_REDIS = process.env.ACCESSI_TEST_REQUIRE_REDIS === '1';
const RUN_PREFIX = `accessi-test:${process.pid}:${randomBytes(4).toString('hex')}:`;

let client = null;
let skipReason = 'ACCESSI_TEST_REDIS_URL non impostata: integration test Redis saltati.';

before(async () => {
  if (!REDIS_URL) {
    if (REQUIRE_REDIS) {
      throw new Error('ACCESSI_TEST_REQUIRE_REDIS=1 ma ACCESSI_TEST_REDIS_URL non e impostata.');
    }
    return;
  }

  try {
    client = await new RedisTestClient(REDIS_URL).connect();
    const pong = await client.command('PING');
    assert.equal(String(pong).toUpperCase(), 'PONG');
  } catch (error) {
    client = null;
    if (REQUIRE_REDIS) {
      throw new Error(`Redis non raggiungibile su ${REDIS_URL}: ${error.message}`);
    }
    skipReason = `Redis non raggiungibile (${REDIS_URL}): integration test Redis saltati.`;
  }
});

after(async () => {
  if (!client) return;
  const current = client;
  client = null;
  try {
    await deleteByPrefix(current, `${RUN_PREFIX}*`);
  } finally {
    await current.quit().catch(() => {});
  }
});

function redisTest(name, fn) {
  test(name, async (t) => {
    if (!client) {
      t.skip(skipReason);
      return;
    }
    await fn(t, client);
  });
}

async function deleteByPrefix(activeClient, pattern) {
  let cursor = '0';
  do {
    const reply = await activeClient.command('SCAN', cursor, 'MATCH', pattern, 'COUNT', '500');
    cursor = String(reply[0]);
    const keys = reply[1];
    if (Array.isArray(keys) && keys.length > 0) {
      await activeClient.command('DEL', ...keys);
    }
  } while (cursor !== '0');
}

async function waitFor(check, { timeoutMs = 5000, intervalMs = 20, message = 'condizione' } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return;
    if (Date.now() > deadline) throw new Error(`timeout in attesa di: ${message}`);
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

function prefix(name) {
  return `${RUN_PREFIX}${name}:`;
}

// ------------------------------------------------------------ rate limit

redisTest('rate limit Redis: INCR/PEXPIRE atomici, blocco e retryAfter', async (_t, active) => {
  const store = createRedisRateLimitStore({ client: active, keyPrefix: prefix('rate') });
  const key = 'login:203.0.113.10';
  const redisKey = `${prefix('rate')}${key}`;

  assert.deepEqual((await store.consume(key, 5000, 3)).allowed, true);
  assert.deepEqual((await store.consume(key, 5000, 3)).allowed, true);
  assert.deepEqual((await store.consume(key, 5000, 3)).allowed, true);

  const blocked = await store.consume(key, 5000, 3);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds >= 1, 'retryAfterSeconds deve essere almeno 1');
  assert.ok(blocked.retryAfterSeconds <= 5, 'retryAfterSeconds non deve superare la finestra');

  // Chiavi diverse hanno bucket indipendenti.
  assert.equal((await store.consume('login:203.0.113.11', 5000, 3)).allowed, true);

  const ttl = await active.command('PTTL', redisKey);
  assert.ok(ttl > 0 && ttl <= 5000, `PTTL inatteso: ${ttl}`);
  assert.equal(await store.healthCheck(), true);
});

redisTest('rate limit Redis: consume concorrenti non superano il limite', async (_t, active) => {
  const store = createRedisRateLimitStore({ client: active, keyPrefix: prefix('rate-conc') });
  const key = 'reset:concorrenza';

  const results = await Promise.all(
    Array.from({ length: 12 }, () => store.consume(key, 60_000, 3)),
  );
  assert.equal(results.filter((decision) => decision.allowed).length, 3);

  const pttl = await active.command('PTTL', `${prefix('rate-conc')}${key}`);
  assert.ok(pttl > 0, 'la finestra deve avere un TTL');
});

redisTest('rate limit Redis: la finestra scade e il bucket riparte', async (_t, active) => {
  const store = createRedisRateLimitStore({ client: active, keyPrefix: prefix('rate-window') });
  const key = '2fa:finestra';

  assert.equal((await store.consume(key, 150, 1)).allowed, true);
  assert.equal((await store.consume(key, 150, 1)).allowed, false);

  await waitFor(
    async () => (await store.consume(key, 150, 1)).allowed,
    { message: 'riapertura della finestra di rate limit' },
  );
});

// ------------------------------------------------------------ console entry

redisTest('console entry Redis: ticket monouso, cifrato a riposo', async (_t, active) => {
  const store = createRedisConsoleEntryStore({
    client: active,
    encryptionKey: 'segreto-di-test-per-la-console',
    keyPrefix: prefix('console'),
  });

  const record = { token: 'jwt-in-chiaro-da-non-persistere', codiceUtente: 7 };
  const { ticket, expiresInSeconds } = await store.issue(record, 30_000);
  assert.match(ticket, /^[a-f0-9]{64}$/);
  assert.ok(expiresInSeconds >= 1 && expiresInSeconds <= 30);

  const raw = await active.command('GET', `${prefix('console')}${ticket}`);
  assert.equal(typeof raw, 'string');
  assert.ok(!raw.includes(record.token), 'il JWT non deve essere scritto in chiaro su Redis');
  assert.ok(!raw.includes('jwt-in-chiaro-da-non-persistere'));

  assert.deepEqual(await store.consume(ticket), record);
  assert.equal(await store.consume(ticket), null, 'il ticket deve essere monouso');
  assert.equal(await active.command('EXISTS', `${prefix('console')}${ticket}`), 0);
  assert.equal(await store.healthCheck(), true);
});

redisTest('console entry Redis: consume concorrenti restituiscono il record una sola volta', async (_t, active) => {
  const store = createRedisConsoleEntryStore({
    client: active,
    encryptionKey: 'segreto-di-test-per-la-console',
    keyPrefix: prefix('console-conc'),
  });

  const record = { token: 'jwt-concorrenza', codiceUtente: 11 };
  const { ticket } = await store.issue(record, 30_000);

  const results = await Promise.all(Array.from({ length: 8 }, () => store.consume(ticket)));
  const consumed = results.filter((value) => value !== null);
  assert.equal(consumed.length, 1);
  assert.deepEqual(consumed[0], record);
});

redisTest('console entry Redis: il ticket scade con il TTL', async (_t, active) => {
  const store = createRedisConsoleEntryStore({
    client: active,
    encryptionKey: 'segreto-di-test-per-la-console',
    keyPrefix: prefix('console-ttl'),
  });

  const { ticket } = await store.issue({ token: 'jwt-scadenza', codiceUtente: 12 }, 120);
  const redisKey = `${prefix('console-ttl')}${ticket}`;
  assert.equal(await active.command('EXISTS', redisKey), 1);

  await waitFor(
    async () => (await active.command('EXISTS', redisKey)) === 0,
    { message: 'scadenza del ticket console' },
  );
  assert.equal(await store.consume(ticket), null);
});

// ------------------------------------------------------------ session revocation

redisTest('session revocation Redis: timestamp esatto, TTL e sovrascrittura', async (_t, active) => {
  const store = createRedisSessionRevocationStore({
    client: active,
    keyPrefix: prefix('session'),
    ttlMs: 60_000,
  });

  assert.equal(await store.getUserRevocation(101), null);

  const firstRevocation = 1_700_000_000_123;
  await store.revokeUser(101, firstRevocation);
  assert.equal(await store.getUserRevocation(101), firstRevocation);

  const pttl = await active.command('PTTL', `${prefix('session')}101`);
  assert.ok(pttl > 0 && pttl <= 60_000, `PTTL inatteso: ${pttl}`);

  const secondRevocation = firstRevocation + 55_000;
  await store.revokeUser(101, secondRevocation);
  assert.equal(await store.getUserRevocation(101), secondRevocation);
  assert.equal(await store.getUserRevocation(102), null);
  assert.equal(await store.healthCheck(), true);
});

redisTest('session revocation Redis: la revoca scade con il TTL', async (_t, active) => {
  const store = createRedisSessionRevocationStore({
    client: active,
    keyPrefix: prefix('session-ttl'),
    ttlMs: 120,
  });

  await store.revokeUser(202, Date.now());
  assert.notEqual(await store.getUserRevocation(202), null);

  await waitFor(
    async () => (await store.getUserRevocation(202)) === null,
    { message: 'scadenza della revoca sessione' },
  );
});

// ------------------------------------------------------------ refresh rotation

redisTest('refresh rotation Redis: consumo atomico con timestamp del primo consumo', async (_t, active) => {
  const store = createRedisRefreshTokenRotationStore({ client: active, keyPrefix: prefix('refresh') });
  const expiresAt = Date.now() + 60_000;
  const beforeConsume = Date.now();

  const first = await store.consumeWithMetadata('jti-1', expiresAt);
  assert.equal(first.consumed, true);
  assert.equal(first.consumedAtMs, undefined);

  const pttl = await active.command('PTTL', `${prefix('refresh')}jti-1`);
  assert.ok(pttl > 0 && pttl <= 60_000, `PTTL inatteso: ${pttl}`);

  const second = await store.consumeWithMetadata('jti-1', expiresAt);
  assert.equal(second.consumed, false);
  assert.ok(Number.isFinite(second.consumedAtMs));
  assert.ok(second.consumedAtMs >= beforeConsume, 'consumedAtMs deve essere il timestamp del primo consumo');

  assert.equal(await store.consume('jti-1', expiresAt), false);
  assert.equal(await store.healthCheck(), true);
});

redisTest('refresh rotation Redis: consume concorrenti dello stesso jti, uno solo vince', async (_t, active) => {
  const store = createRedisRefreshTokenRotationStore({ client: active, keyPrefix: prefix('refresh-conc') });
  const expiresAt = Date.now() + 60_000;

  const results = await Promise.all(
    Array.from({ length: 10 }, () => store.consume('jti-concorrenza', expiresAt)),
  );
  assert.equal(results.filter(Boolean).length, 1);

  const metadata = await store.consumeWithMetadata('jti-concorrenza', expiresAt);
  assert.equal(metadata.consumed, false);
  assert.ok(Number.isFinite(metadata.consumedAtMs));
});

redisTest('refresh rotation Redis: revoca famiglia con TTL e indipendenza tra famiglie', async (_t, active) => {
  const store = createRedisRefreshTokenRotationStore({
    client: active,
    keyPrefix: prefix('refresh-family'),
    familyKeyPrefix: prefix('refresh-family-revoked'),
  });
  const expiresAt = Date.now() + 60_000;

  assert.equal(await store.isFamilyRevoked('famiglia-a'), false);
  await store.revokeFamily('famiglia-a', expiresAt);
  assert.equal(await store.isFamilyRevoked('famiglia-a'), true);
  assert.equal(await store.isFamilyRevoked('famiglia-b'), false);

  const pttl = await active.command('PTTL', `${prefix('refresh-family-revoked')}famiglia-a`);
  assert.ok(pttl > 0 && pttl <= 60_000, `PTTL inatteso: ${pttl}`);
});

redisTest('refresh rotation Redis: revoca famiglia scaduta non blocca piu', async (_t, active) => {
  const store = createRedisRefreshTokenRotationStore({
    client: active,
    keyPrefix: prefix('refresh-family-ttl'),
    familyKeyPrefix: prefix('refresh-family-ttl-revoked'),
  });

  await store.revokeFamily('famiglia-scaduta', Date.now() + 120);
  assert.equal(await store.isFamilyRevoked('famiglia-scaduta'), true);

  await waitFor(
    async () => (await store.isFamilyRevoked('famiglia-scaduta')) === false,
    { message: 'scadenza della revoca famiglia' },
  );
});

// ------------------------------------------------------------ access token revocation

redisTest('access token revocation Redis: revoca jti, TTL e isolamento tra token', async (_t, active) => {
  const store = createRedisAccessTokenRevocationStore({
    client: active,
    keyPrefix: prefix('jti'),
    ttlMs: 60_000,
  });

  assert.equal(await store.isRevoked('jti-a'), false);

  await store.revoke('jti-a', Date.now() + 60_000);
  assert.equal(await store.isRevoked('jti-a'), true);
  assert.equal(await store.isRevoked('jti-b'), false);
  assert.equal(await store.healthCheck(), true);
});

redisTest('access token revocation Redis: revoche concorrenti sono idempotenti', async (_t, active) => {
  const store = createRedisAccessTokenRevocationStore({ client: active, keyPrefix: prefix('jti-conc') });
  const expiresAt = Date.now() + 60_000;

  await Promise.all(Array.from({ length: 10 }, () => store.revoke('jti-concorrenza', expiresAt)));
  assert.equal(await store.isRevoked('jti-concorrenza'), true);
});

redisTest('access token revocation Redis: la revoca scade con exp del token', async (_t, active) => {
  const store = createRedisAccessTokenRevocationStore({ client: active, keyPrefix: prefix('jti-ttl') });

  await store.revoke('jti-scaduto', Date.now() + 120);
  assert.equal(await store.isRevoked('jti-scaduto'), true);

  await waitFor(
    async () => (await store.isRevoked('jti-scaduto')) === false,
    { message: 'scadenza della revoca jti' },
  );
});

// ------------------------------------------------------------ health check

redisTest('healthCheck false quando Redis non risponde', async (_t, active) => {
  assert.equal(await active.command('PING'), 'PONG');

  const disposable = await new RedisTestClient(REDIS_URL).connect();
  const store = createRedisRateLimitStore({ client: disposable, keyPrefix: prefix('dead') });

  assert.equal(await store.healthCheck(), true);
  await disposable.quit();
  assert.equal(await store.healthCheck(), false);
});
