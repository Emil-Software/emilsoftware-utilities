// Infrastruttura condivisa per gli integration test su Firebird reale.
// La suite si auto-salta se il database non e raggiungibile, cosi `npm test` resta DB-free.
require('ts-node/register/transpile-only');
require('reflect-metadata');

const Firebird = require('node-firebird');
const { DatabaseUtilities } = require('../../../src/Utilities');
const { AccessiDatabaseUpdater } = require('../../../src/accessi-module/database-updates/AccessiDatabaseUpdater');

const TEST_CONFIG = {
  host: process.env.ACCESSI_TEST_DB_HOST || '127.0.0.1',
  port: Number(process.env.ACCESSI_TEST_DB_PORT || '3050'),
  database: process.env.ACCESSI_TEST_DB_DATABASE || '/var/lib/firebird/data/test_accessi.fdb',
  user: process.env.ACCESSI_TEST_DB_USER || 'SYSDBA',
  password: process.env.ACCESSI_TEST_DB_PASSWORD || 'masterkey',
  wireCrypt: process.env.ACCESSI_TEST_DB_WIRE_CRYPT || undefined,
  pluginName: process.env.ACCESSI_TEST_DB_AUTH_PLUGIN || undefined,
};

function buildDatabaseOptions() {
  const options = DatabaseUtilities.createOption(
    TEST_CONFIG.host,
    TEST_CONFIG.port,
    TEST_CONFIG.database,
    TEST_CONFIG.user,
    TEST_CONFIG.password,
  );

  if (TEST_CONFIG.wireCrypt) {
    options.wireCrypt = TEST_CONFIG.wireCrypt;
  }
  if (TEST_CONFIG.pluginName) {
    options.pluginName = TEST_CONFIG.pluginName;
  }

  return options;
}

function buildAccessiOptions() {
  return {
    databaseOptions: buildDatabaseOptions(),
    confirmationEmailUrl: 'http://localhost',
    confirmationEmailReturnUrl: 'http://localhost',
    encryptionKey: '0123456789ABCDEF',
    mockDemoUser: false,
    autoUpdateDatabase: true,
    legacyPasswordMigrationOnStartup: false,
    jwtOptions: { secret: 'integration-secret', expiresIn: '1h' },
    emailOptions: {
      host: 'localhost',
      port: 25,
      secure: false,
      requireTLS: false,
      tls: { rejectUnauthorized: false },
      from: 'integration@example.test',
      auth: { user: '', pass: '' },
    },
    publicAuthRateLimit: { enabled: false },
    extensionFieldsOptions: [],
  };
}

function attachOrCreate(options) {
  return new Promise((resolve, reject) => {
    Firebird.attachOrCreate(options, (err, db) => {
      if (err) {
        reject(err);
        return;
      }
      db.detach(() => resolve());
    });
  });
}

let contextPromise;

function getContext() {
  if (!contextPromise) {
    contextPromise = createContext();
  }
  return contextPromise;
}

async function createContext() {
  const options = buildAccessiOptions();

  try {
    await attachOrCreate(options.databaseOptions);
  } catch (error) {
    return { available: false, reason: error instanceof Error ? error.message : String(error), options };
  }

  // Riusa il migrator della libreria: gli integration test validano anche schema e idempotenza.
  await AccessiDatabaseUpdater.initialize(options);

  return { available: true, options };
}

module.exports = { getContext, buildAccessiOptions, TEST_CONFIG };
