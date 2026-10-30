require('ts-node/register/transpile-only');
require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  checkAccessiDatabase,
  checkAccessiReadiness,
  collectAccessiHealthStores,
  createAccessiHealthModule,
  createAccessiLiveReport,
  readinessHttpStatus,
} = require('../src/accessi-module');
const {
  createMemoryRateLimitStore,
} = require('../src/accessi-module/security/rateLimitStore');
const {
  ACCESSI_SCHEMA_VERSION,
} = require('../src/accessi-module/database-updates/accessiSchema');

const OPTIONS = { databaseOptions: {}, encryptionKey: '0123456789ABCDEF', mockDemoUser: false };

function healthStore(healthy = true) {
  return {
    async healthCheck() {
      return healthy;
    },
  };
}

test('il check database distingue schema assente, versione attesa e versione diversa', async () => {
  const missing = await checkAccessiDatabase(OPTIONS, async () => undefined);
  assert.deepEqual(missing, { ok: false, detail: 'schema Accessi non inizializzato' });

  const current = await checkAccessiDatabase(OPTIONS, async () => ACCESSI_SCHEMA_VERSION);
  assert.deepEqual(current, { ok: true, detail: ACCESSI_SCHEMA_VERSION });

  const stale = await checkAccessiDatabase(OPTIONS, async () => '1.0.0');
  assert.deepEqual(stale, { ok: true, detail: `1.0.0 (atteso ${ACCESSI_SCHEMA_VERSION})` });

  const broken = await checkAccessiDatabase(OPTIONS, async () => {
    throw new Error('database non raggiungibile');
  });
  assert.deepEqual(broken, { ok: false, detail: 'database non raggiungibile' });
});

test('collectAccessiHealthStores raccoglie gli store con healthCheck ed evita i duplicati', () => {
  const rateLimit = createMemoryRateLimitStore();
  const consoleEntry = healthStore();
  const delegated = {
    async healthCheck() {
      return true;
    },
  };
  const options = {
    ...OPTIONS,
    publicAuthRateLimit: { store: rateLimit },
    serviceTokens: { rateLimitStore: rateLimit },
    consoleEntry: { store: consoleEntry },
    accessTokenRevocation: { store: { ...delegated, async healthCheck() { return true; } } },
  };

  const stores = collectAccessiHealthStores(options);
  assert.deepEqual(stores.map((entry) => entry.name), [
    'publicAuthRateLimit',
    'consoleEntry',
    'accessTokenRevocation',
  ]);
});

test('la readiness aggrega bootstrap, database, store e check applicativi', async () => {
  const options = {
    ...OPTIONS,
    publicAuthRateLimit: { store: healthStore(true) },
    consoleEntry: { store: healthStore(false) },
    sessionRevocation: {
      store: {
        async healthCheck() {
          throw new Error('redis offline');
        },
      },
    },
  };

  const report = await checkAccessiReadiness(
    options,
    [
      { name: 'coda', check: () => true },
      { name: 'smtp', check: async () => false },
    ],
    { databaseVersion: async () => ACCESSI_SCHEMA_VERSION },
  );

  assert.equal(report.status, 'error');
  assert.equal(report.checks.bootstrap.ok, true);
  assert.equal(report.checks.database.ok, true);
  assert.equal(report.checks.publicAuthRateLimit.ok, true);
  assert.equal(report.checks.consoleEntry.ok, false);
  assert.deepEqual(report.checks.sessionRevocation, { ok: false, detail: 'redis offline' });
  assert.equal(report.checks.coda.ok, true);
  assert.equal(report.checks.smtp.ok, false);
  assert.equal(readinessHttpStatus(report), 503);
  assert.ok(!Number.isNaN(Date.parse(report.timestamp)));
});

test('la readiness e ok solo se tutti i check passano', async () => {
  const report = await checkAccessiReadiness(
    { ...OPTIONS, consoleEntry: { store: healthStore(true) } },
    [{ name: 'coda', check: () => true }],
    { databaseVersion: async () => ACCESSI_SCHEMA_VERSION },
  );

  assert.equal(report.status, 'ok');
  assert.equal(report.checks.bootstrap.ok, true);
  assert.equal(report.checks.database.ok, true);
  assert.equal(report.checks.consoleEntry.ok, true);
  assert.equal(readinessHttpStatus(report), 200);
});

test('il check database di default riporta l\'errore invece di lanciare', async () => {
  const { AccessiDatabaseUpdater } = require('../src/accessi-module/database-updates/AccessiDatabaseUpdater');
  const original = AccessiDatabaseUpdater.getCurrentVersion;
  AccessiDatabaseUpdater.getCurrentVersion = async () => {
    throw new Error('pool non disponibile');
  };

  try {
    const report = await checkAccessiReadiness(OPTIONS);
    assert.equal(report.status, 'error');
    assert.deepEqual(report.checks.database, { ok: false, detail: 'pool non disponibile' });
  } finally {
    AccessiDatabaseUpdater.getCurrentVersion = original;
  }
});

test('la liveness non tocca database ne store', () => {
  const report = createAccessiLiveReport();
  assert.equal(report.status, 'ok');
  assert.ok(Number.isInteger(report.uptimeSeconds));
  assert.ok(report.uptimeSeconds >= 0);
});

test('createAccessiHealthModule espone live e ready con lo stesso contratto', async () => {
  const dynamicModule = createAccessiHealthModule({
    accessiOptions: {
      ...OPTIONS,
      consoleEntry: { store: healthStore(true) },
    },
    readinessChecks: [{ name: 'coda', check: () => true }],
    readinessDependencies: { databaseVersion: async () => ACCESSI_SCHEMA_VERSION },
    path: '/healthz',
  });

  assert.ok(dynamicModule.module);
  assert.equal(dynamicModule.controllers?.length, 1);

  const ControllerClass = dynamicModule.controllers[0];
  const controller = new ControllerClass();

  assert.deepEqual(controller.live(), { status: 'ok', uptimeSeconds: controller.live().uptimeSeconds });
  assert.equal(typeof controller.live().uptimeSeconds, 'number');

  const response = {
    statusCode: 0,
    status(code) {
      this.statusCode = code;
      return this;
    },
  };
  const report = await controller.ready(response);

  assert.equal(response.statusCode, 200);
  assert.equal(report.status, 'ok');
  assert.equal(report.checks.bootstrap.ok, true);
  assert.equal(report.checks.consoleEntry.ok, true);
  assert.equal(report.checks.coda.ok, true);
});

test('createAccessiHealthModule risponde 503 quando un check fallisce', async () => {
  const dynamicModule = createAccessiHealthModule({
    accessiOptions: OPTIONS,
    readinessChecks: [{ name: 'smtp', check: () => false }],
    readinessDependencies: { databaseVersion: async () => ACCESSI_SCHEMA_VERSION },
  });
  const controller = new dynamicModule.controllers[0]();
  const response = {
    statusCode: 0,
    status(code) {
      this.statusCode = code;
      return this;
    },
  };

  const report = await controller.ready(response);
  assert.equal(response.statusCode, 503);
  assert.equal(report.status, 'error');
  assert.equal(report.checks.smtp.ok, false);
});
