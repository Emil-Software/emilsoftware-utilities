require('ts-node/register/transpile-only');
require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  createAccessiTenantStores,
  getAccessiTenantStorePrefixes,
} = require('../src/accessi/server');

function fakeRedisClient() {
  return {
    calls: [],
    async eval(script, _numKeys, ...args) {
      this.calls.push({ script, args });
      if (script.includes("redis.call('PING')")) return 'PONG';
      if (script.includes('INCR')) return [1, 1000];
      return 1;
    },
  };
}

function baseOptions(extra = {}) {
  return {
    databaseOptions: {},
    encryptionKey: '0123456789ABCDEF',
    confirmationEmailUrl: 'http://localhost',
    confirmationEmailReturnUrl: 'http://localhost',
    jwtOptions: { secret: 'x'.repeat(40), expiresIn: '1h' },
    ...extra,
  };
}

test('#21: i prefissi sono distinti per store e per tenant', () => {
  const acme = getAccessiTenantStorePrefixes('acme');
  const beta = getAccessiTenantStorePrefixes('beta');

  assert.equal(acme.base, 'accessi:acme:');
  assert.equal(acme.rateLimit, 'accessi:acme:rate:');
  assert.equal(acme.serviceTokenRateLimit, 'accessi:acme:service-token-rate:');
  assert.equal(acme.consoleEntry, 'accessi:acme:console-entry:');

  const all = Object.values(acme);
  assert.equal(new Set(all).size, all.length, 'ogni store deve avere un prefisso diverso');
  for (const prefix of all) {
    assert.ok(!beta.base.startsWith(prefix) && !prefix.startsWith(beta.base), `prefisso condiviso: ${prefix}`);
  }

  const custom = getAccessiTenantStorePrefixes('acme', { base: 'custom:', rateLimit: 'custom:rl:' });
  assert.equal(custom.base, 'custom:');
  assert.equal(custom.rateLimit, 'custom:rl:');
  assert.equal(custom.consoleEntry, 'custom:console-entry:');
});

test('#21: applyTo collega tutti gli store senza perdere la configurazione', () => {
  const client = fakeRedisClient();
  const stores = createAccessiTenantStores({
    tenantId: 'acme',
    client,
    encryptionKey: 'un-segreto-lungo-per-i-ticket-console',
    sessionRevocationTtlMs: 60_000,
    accessTokenRevocationTtlMs: 30_000,
    consoleEntryMaxIssueAttempts: 3,
  });

  const options = stores.applyTo(baseOptions({
    tenantId: 'altro',
    publicAuthRateLimit: { login: { windowMs: 1000, maxAttempts: 2 } },
    serviceTokens: { enabled: true, defaultTtlDays: 5 },
    sessionRevocation: { enabled: true },
    refreshTokenRotation: { reuseGraceMs: 5000 },
    consoleEntry: { ttlMs: 30_000 },
  }));

  assert.equal(options.tenantId, 'acme');
  assert.equal(options.publicAuthRateLimit.store, stores.rateLimit);
  assert.equal(options.publicAuthRateLimit.login.maxAttempts, 2);
  assert.equal(options.serviceTokens.rateLimitStore, stores.serviceTokenRateLimit);
  assert.equal(options.serviceTokens.defaultTtlDays, 5);
  assert.equal(options.sessionRevocation.store, stores.sessionRevocation);
  assert.equal(options.accessTokenRevocation.store, stores.accessTokenRevocation);
  assert.equal(options.refreshTokenRotation.store, stores.refreshTokenRotation);
  assert.equal(options.refreshTokenRotation.enabled, true);
  assert.equal(options.refreshTokenRotation.reuseGraceMs, 5000);
  assert.equal(options.consoleEntry.store, stores.consoleEntry);
  assert.equal(options.consoleEntry.ttlMs, 30_000);

  // Le opzioni originali non vengono mutate.
  assert.equal(baseOptions().tenantId, undefined);
});

test('#21: store separati per tenant sullo stesso client', async () => {
  const client = fakeRedisClient();
  const acme = createAccessiTenantStores({ tenantId: 'acme', client, encryptionKey: 'secret-acme-0123456789' });
  const beta = createAccessiTenantStores({ tenantId: 'beta', client, encryptionKey: 'secret-beta-0123456789' });

  await acme.rateLimit.consume('login|ip|1.2.3.4', 1000, 1);
  await beta.rateLimit.consume('login|ip|1.2.3.4', 1000, 1);
  const keys = client.calls
    .filter((call) => call.script.includes('INCR'))
    .map((call) => call.args[0]);
  assert.equal(new Set(keys).size, 2);
  assert.ok(keys[0].startsWith(acme.prefixes.rateLimit));
  assert.ok(keys[1].startsWith(beta.prefixes.rateLimit));
  assert.equal(await acme.rateLimit.healthCheck(), true);
});

test('#21: configurazione non valida viene rifiutata', () => {
  const client = fakeRedisClient();
  assert.throws(() => createAccessiTenantStores({ tenantId: 'BAD ID', client, encryptionKey: 'x' }), /tenantId/);
  assert.throws(() => createAccessiTenantStores({ tenantId: 'acme', client: {}, encryptionKey: 'x' }), /client\.eval/);
  assert.throws(() => createAccessiTenantStores({ tenantId: 'acme', client, encryptionKey: '' }), /encryptionKey/);
});
