require('ts-node/register/transpile-only');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  createAccessiOptionsFromEnv,
} = require('../src/accessi-service/database-updates/accessiOptionsFromEnv');

function baseEnv(overrides = {}) {
  return {
    ACCESSI_DB_HOST: '127.0.0.1',
    ACCESSI_DB_DATABASE: '/tmp/accessi-test.fdb',
    ACCESSI_DB_USER: 'SYSDBA',
    ACCESSI_DB_PASSWORD: 'masterkey',
    ACCESSI_JWT_SECRET: 'x'.repeat(48),
    ACCESSI_ENCRYPTION_KEY: 'y'.repeat(32),
    ...overrides,
  };
}

test('#27: in sviluppo restano disponibili i default locali', () => {
  const options = createAccessiOptionsFromEnv(baseEnv({
    ACCESSI_JWT_SECRET: undefined,
    ACCESSI_ENCRYPTION_KEY: undefined,
  }));

  assert.equal(options.jwtOptions.secret, 'local-accessi-update');
  assert.equal(options.encryptionKey, '1234567890ABCDEF');
});

test('#27: in produzione un segreto JWT mancante blocca l avvio', () => {
  const env = baseEnv({ NODE_ENV: 'production', ACCESSI_JWT_SECRET: undefined });
  assert.throws(() => createAccessiOptionsFromEnv(env), /ACCESSI_JWT_SECRET/);
});

test('#27: in produzione il default JWT locale blocca l avvio', () => {
  const env = baseEnv({ NODE_ENV: 'production', ACCESSI_JWT_SECRET: 'local-accessi-update' });
  assert.throws(() => createAccessiOptionsFromEnv(env), /default locale/);
});

test('#27: in produzione encryptionKey mancante o di default blocca l avvio', () => {
  assert.throws(
    () => createAccessiOptionsFromEnv(baseEnv({ NODE_ENV: 'production', ACCESSI_ENCRYPTION_KEY: undefined })),
    /ACCESSI_ENCRYPTION_KEY/,
  );
  assert.throws(
    () => createAccessiOptionsFromEnv(baseEnv({ NODE_ENV: 'production', ACCESSI_ENCRYPTION_KEY: '1234567890ABCDEF' })),
    /default locale/,
  );
});

test('#27: mockDemoUser non e ammesso in produzione', () => {
  assert.throws(
    () => createAccessiOptionsFromEnv(baseEnv({ NODE_ENV: 'production', ACCESSI_MOCK_DEMO_USER: 'true' })),
    /ACCESSI_MOCK_DEMO_USER/,
  );
  const development = createAccessiOptionsFromEnv(baseEnv({ ACCESSI_MOCK_DEMO_USER: 'true' }));
  assert.equal(development.mockDemoUser, true);
});

test('#27: una configurazione di produzione completa viene accettata', () => {
  const options = createAccessiOptionsFromEnv(baseEnv({
    NODE_ENV: 'production',
    ACCESSI_JWT_ISSUER: 'https://accessi.example.com',
    ACCESSI_JWT_AUDIENCE: 'backend-app',
  }));
  assert.equal(options.jwtOptions.secret, 'x'.repeat(48));
  assert.equal(options.encryptionKey, 'y'.repeat(32));
  assert.equal(options.mockDemoUser, false);
});

test('#28: migrazioni, seed e bootstrap admin hanno default sicuri', () => {
  const options = createAccessiOptionsFromEnv(baseEnv());
  assert.equal(options.autoUpdateDatabase, true);
  assert.equal(options.legacyPasswordMigrationOnStartup, true);
  assert.equal(options.systemSeeds?.enabled, true);
  assert.equal(options.adminBootstrap, undefined);
});

test('#28: le opzioni di migrazione e bootstrap si leggono da ambiente', () => {
  const options = createAccessiOptionsFromEnv(baseEnv({
    ACCESSI_AUTO_UPDATE_DATABASE: 'false',
    ACCESSI_LEGACY_PASSWORD_MIGRATION: 'off',
    ACCESSI_SYSTEM_SEEDS_ENABLED: '0',
    ACCESSI_ADMIN_BOOTSTRAP_ENABLED: 'yes',
  }));
  assert.equal(options.autoUpdateDatabase, false);
  assert.equal(options.legacyPasswordMigrationOnStartup, false);
  assert.equal(options.systemSeeds?.enabled, false);
  assert.equal(options.adminBootstrap?.enabled, true);
});

test('#28: un booleano non valido blocca l avvio indicando la variabile', () => {
  assert.throws(
    () => createAccessiOptionsFromEnv(baseEnv({ ACCESSI_AUTO_UPDATE_DATABASE: 'forse' })),
    /ACCESSI_AUTO_UPDATE_DATABASE/,
  );
});

test('#29: le opzioni non configurate restano ai default del modulo', () => {
  const options = createAccessiOptionsFromEnv(baseEnv());
  assert.equal(options.authCookie, undefined);
  assert.equal(options.audit, undefined);
  assert.equal(options.metrics, undefined);
  assert.equal(options.serviceTokens, undefined);
  assert.equal(options.federatedAuthentication, undefined);
  assert.equal(options.publicRegistration, undefined);
  assert.equal(options.tenantId, undefined);
});

test('#29: cookie HttpOnly e CSRF si configurano da ambiente', () => {
  const options = createAccessiOptionsFromEnv(baseEnv({
    ACCESSI_AUTH_COOKIE_ENABLED: 'true',
    ACCESSI_AUTH_COOKIE_SECURE: 'false',
    ACCESSI_AUTH_COOKIE_SAME_SITE: 'lax',
    ACCESSI_AUTH_COOKIE_DOMAIN: 'example.com',
    ACCESSI_AUTH_COOKIE_CSRF: 'off',
    ACCESSI_AUTH_COOKIE_EXPOSE_TOKENS: 'true',
  }));
  assert.deepEqual(options.authCookie, {
    enabled: true,
    secure: false,
    sameSite: 'lax',
    domain: 'example.com',
    csrf: 'off',
    exposeTokens: true,
  });
  assert.throws(
    () => createAccessiOptionsFromEnv(baseEnv({ ACCESSI_AUTH_COOKIE_SAME_SITE: 'always' })),
    /ACCESSI_AUTH_COOKIE_SAME_SITE/,
  );
});

test('#29: metriche, audit, service token e tenant si configurano da ambiente', () => {
  const options = createAccessiOptionsFromEnv(baseEnv({
    ACCESSI_METRICS_ENABLED: 'false',
    ACCESSI_METRICS_PREFIX: 'acme',
    ACCESSI_AUDIT_ENABLED: 'false',
    ACCESSI_AUDIT_RETENTION_DAYS: '30',
    ACCESSI_AUDIT_LOGGER: 'false',
    ACCESSI_SERVICE_TOKENS_ENABLED: 'false',
    ACCESSI_SERVICE_TOKENS_DEFAULT_TTL_DAYS: '90',
    ACCESSI_TENANT_ID: 'acme',
    ACCESSI_CONSOLE_ENTRY_TTL_MS: '45000',
  }));
  assert.deepEqual(options.metrics, { enabled: false, prefix: 'acme' });
  assert.deepEqual(options.audit, { enabled: false, retentionDays: 30, logger: false });
  assert.deepEqual(options.serviceTokens, { enabled: false, defaultTtlDays: 90 });
  assert.equal(options.tenantId, 'acme');
  assert.equal(options.consoleEntry?.ttlMs, 45000);
});

test('#29: registrazione pubblica e SSO restano opt-in', () => {
  const defaults = createAccessiOptionsFromEnv(baseEnv());
  assert.equal(defaults.publicRegistration, undefined);
  assert.equal(defaults.federatedAuthentication, undefined);

  const enabled = createAccessiOptionsFromEnv(baseEnv({
    ACCESSI_PUBLIC_REGISTRATION_ENABLED: 'true',
    ACCESSI_FEDERATED_AUTH_ENABLED: 'true',
    ACCESSI_FEDERATED_SELF_REGISTRATION: 'true',
  }));
  assert.deepEqual(enabled.publicRegistration, { enabled: true });
  assert.deepEqual(enabled.federatedAuthentication, {
    enabled: true,
    allowSelfRegistration: true,
  });
});

test('#29: valori numerici non validi bloccano l avvio', () => {
  assert.throws(
    () => createAccessiOptionsFromEnv(baseEnv({ ACCESSI_AUDIT_RETENTION_DAYS: '0' })),
    /ACCESSI_AUDIT_RETENTION_DAYS/,
  );
  assert.throws(
    () => createAccessiOptionsFromEnv(baseEnv({ ACCESSI_CONSOLE_ENTRY_TTL_MS: 'abc' })),
    /ACCESSI_CONSOLE_ENTRY_TTL_MS/,
  );
});
