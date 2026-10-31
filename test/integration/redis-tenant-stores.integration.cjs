// Test di isolamento degli store Redis multi-tenant contro un Redis reale.
//
//   ACCESSI_TEST_REDIS_URL=redis://127.0.0.1:6379/5 npm run test:integration:redis
//
// Due tenant condividono lo stesso client ma devono avere chiavi disgiunte:
// rate limit, revoche, refresh rotation e ticket console non devono incrociarsi.
require('ts-node/register/transpile-only');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { RedisTestClient } = require('./helpers/redisTestClient.cjs');
const {
  createAccessiTenantStores,
  getAccessiTenantStorePrefixes,
} = require('../../src/accessi/server');

const REDIS_URL = (process.env.ACCESSI_TEST_REDIS_URL ?? '').trim();
const REQUIRE_REDIS = process.env.ACCESSI_TEST_REQUIRE_REDIS === '1';
const RUN_PREFIX = `accessi-tenant-it:${process.pid}:${randomBytes(4).toString('hex')}:`;

let client = null;
let skipReason = 'ACCESSI_TEST_REDIS_URL non impostata: test tenant Redis saltati.';

before(async () => {
  if (!REDIS_URL) {
    if (REQUIRE_REDIS) throw new Error('ACCESSI_TEST_REQUIRE_REDIS=1 ma ACCESSI_TEST_REDIS_URL non e impostata.');
    return;
  }
  try {
    client = await new RedisTestClient(REDIS_URL).connect();
    assert.equal(String(await client.command('PING')).toUpperCase(), 'PONG');
  } catch (error) {
    client = null;
    if (REQUIRE_REDIS) throw new Error(`Redis non raggiungibile su ${REDIS_URL}: ${error.message}`);
    skipReason = `Redis non raggiungibile (${REDIS_URL}): test tenant Redis saltati.`;
  }
});

after(async () => {
  if (!client) return;
  const active = client;
  client = null;
  try {
    await deleteByPrefix(active, `${RUN_PREFIX}*`);
  } finally {
    await active.quit().catch(() => undefined);
  }
});

async function deleteByPrefix(activeClient, pattern) {
  let cursor = '0';
  do {
    const reply = await activeClient.command('SCAN', cursor, 'MATCH', pattern, 'COUNT', '500');
    cursor = String(reply[0]);
    const keys = reply[1];
    if (Array.isArray(keys) && keys.length > 0) await activeClient.command('DEL', ...keys);
  } while (cursor !== '0');
}

function stores(tenantId) {
  return createAccessiTenantStores({
    tenantId,
    client,
    encryptionKey: `secret-${tenantId}-0123456789`,
    prefix: `${RUN_PREFIX}${tenantId}:`,
  });
}

function redisTest(name, fn) {
  test(name, async (t) => {
    if (!client) {
      t.skip(skipReason);
      return;
    }
    await fn(t);
  });
}

redisTest('#21: rate limit indipendente tra tenant', async () => {
  const acme = stores('acme');
  const beta = stores('beta');

  assert.equal((await acme.rateLimit.consume('login|ip|203.0.113.1', 60_000, 1)).allowed, true);
  assert.equal((await acme.rateLimit.consume('login|ip|203.0.113.1', 60_000, 1)).allowed, false);
  assert.equal((await beta.rateLimit.consume('login|ip|203.0.113.1', 60_000, 1)).allowed, true);

  const acmePrefix = getAccessiTenantStorePrefixes('acme', { base: `${RUN_PREFIX}acme:` });
  const betaPrefix = getAccessiTenantStorePrefixes('beta', { base: `${RUN_PREFIX}beta:` });
  assert.notEqual(acmePrefix.rateLimit, betaPrefix.rateLimit);
  assert.equal(await acme.rateLimit.healthCheck(), true);
  assert.equal(await beta.rateLimit.healthCheck(), true);
});

redisTest('#21: revoche sessione e jti non si propagano tra tenant', async () => {
  const acme = stores('acme');
  const beta = stores('beta');

  await acme.sessionRevocation.revokeUser(42, Date.now());
  assert.notEqual(await acme.sessionRevocation.getUserRevocation(42), null);
  assert.equal(await beta.sessionRevocation.getUserRevocation(42), null);

  const expiresAt = Date.now() + 60_000;
  await acme.accessTokenRevocation.revoke('jti-condiviso', expiresAt);
  assert.equal(await acme.accessTokenRevocation.isRevoked('jti-condiviso'), true);
  assert.equal(await beta.accessTokenRevocation.isRevoked('jti-condiviso'), false);
});

redisTest('#21: refresh rotation isolata tra tenant', async () => {
  const acme = stores('acme');
  const beta = stores('beta');
  const expiresAt = Date.now() + 60_000;

  assert.equal(await acme.refreshTokenRotation.consume('jti-refresh', expiresAt), true);
  assert.equal(await acme.refreshTokenRotation.consume('jti-refresh', expiresAt), false);
  // Lo stesso jti su un altro tenant e un token diverso.
  assert.equal(await beta.refreshTokenRotation.consume('jti-refresh', expiresAt), true);

  await acme.refreshTokenRotation.revokeFamily('famiglia', expiresAt);
  assert.equal(await acme.refreshTokenRotation.isFamilyRevoked('famiglia'), true);
  assert.equal(await beta.refreshTokenRotation.isFamilyRevoked('famiglia'), false);
});

redisTest('#21: ticket console consumabile solo dal tenant che lo emette', async () => {
  const acme = stores('acme');
  const beta = stores('beta');
  const record = { token: 'jwt-ticket-tenant', codiceUtente: 7 };

  const { ticket } = await acme.consoleEntry.issue(record, 30_000);
  assert.equal(await beta.consoleEntry.consume(ticket), null);
  assert.deepEqual(await acme.consoleEntry.consume(ticket), record);
  assert.equal(await acme.consoleEntry.consume(ticket), null);
});
