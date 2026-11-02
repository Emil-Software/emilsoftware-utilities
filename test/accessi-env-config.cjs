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
