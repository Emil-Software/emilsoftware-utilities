require('ts-node/register/transpile-only');
require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const accessiModule = require('../src/accessi-module');
const { AccessiDatabaseUpdater } = require('../src/accessi-module/database-updates/AccessiDatabaseUpdater');
const { createAccessiService } = require('../src/accessi/server/standalone');
const { validateAccessiOptions } = require('../src/accessi-module/security/validateOptions');

const VALID_OPTIONS = {
  databaseOptions: {},
  confirmationEmailUrl: 'http://localhost',
  confirmationEmailReturnUrl: 'http://localhost',
  encryptionKey: '0123456789ABCDEF',
  mockDemoUser: false,
  autoUpdateDatabase: false,
  legacyPasswordMigrationOnStartup: false,
  jwtOptions: {
    secret: 'x'.repeat(32),
    expiresIn: '1h',
    issuer: 'accessi',
    audience: 'backend',
  },
};

function fakeNestApp() {
  return { close: async () => undefined };
}

async function withService(t, { databaseVersion = '1.12.0' } = {}) {
  t.mock.method(accessiModule, 'initializeAccessiModule', async () => ({
    nestApp: fakeNestApp(),
    document: { openapi: '3.0.0', paths: {} },
  }));
  t.mock.method(AccessiDatabaseUpdater, 'getCurrentVersion', async () => databaseVersion);
  const service = await createAccessiService({
    accessiOptions: VALID_OPTIONS,
    port: 0,
    metrics: true,
  });
  const server = await service.start();
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  t.after(() => service.stop());
  return { service, port };
}

test('createAccessiService espone live, ready e metrics', async t => {
  const { port } = await withService(t);

  const live = await fetch(`http://127.0.0.1:${port}/health/live`);
  assert.equal(live.status, 200);

  const ready = await fetch(`http://127.0.0.1:${port}/health/ready`);
  assert.equal(ready.status, 200);
  const readyBody = await ready.json();
  assert.equal(readyBody.status, 'ok');
  assert.equal(readyBody.checks.database.ok, true);

  const metrics = await fetch(`http://127.0.0.1:${port}/health/metrics`);
  assert.equal(metrics.status, 200);
  const metricsText = await metrics.text();
  assert.match(metricsText, /accessi_process_uptime_seconds/);
  assert.match(metricsText, /accessi_http_requests_total/);
});

test('readiness fallisce se il database non risponde o non e inizializzato', async t => {
  const { port } = await withService(t, { databaseVersion: null });
  const ready = await fetch(`http://127.0.0.1:${port}/health/ready`);
  assert.equal(ready.status, 503);
  const body = await ready.json();
  assert.equal(body.status, 'error');
  assert.equal(body.checks.database.ok, false);
});

test('validateAccessiOptions segnala configurazioni pericolose', () => {
  const result = validateAccessiOptions({
    ...VALID_OPTIONS,
    encryptionKey: 'short',
    jwtOptions: { secret: 'short', expiresIn: '1h' },
  });
  assert.ok(result.warnings.some(issue => issue.code === 'ACCESSI_JWT_SECRET_WEAK'));
  assert.ok(result.warnings.some(issue => issue.code === 'ACCESSI_ENCRYPTION_KEY_WEAK'));
  assert.ok(result.warnings.some(issue => issue.code === 'ACCESSI_JWT_ISSUER_MISSING'));
});

test('createAccessiService rifiuta una configurazione non valida', async () => {
  await assert.rejects(
    () => createAccessiService({
      accessiOptions: { ...VALID_OPTIONS, jwtOptions: { expiresIn: '1h' } },
    }),
    /jwtOptions\.secret/,
  );
});
