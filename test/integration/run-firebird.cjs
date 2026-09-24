// Wrapper cross-platform per gli integration test: imposta i default di
// connessione in base alla major version di Firebird e avvia `node --test`.
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const version = process.argv[2] || '5';

const DEFAULTS = {
  '2.5': {
    ACCESSI_TEST_DB_PORT: '3057',
    ACCESSI_TEST_DB_DATABASE: '/firebird/data/test_accessi.fdb',
    ACCESSI_TEST_DB_DIRECTORY: '/firebird/data',
    // Firebird 2.5 usa Legacy_Auth e non supporta la cifratura del wire.
    ACCESSI_TEST_DB_AUTH_PLUGIN: 'Legacy_Auth',
    ACCESSI_TEST_DB_WIRE_CRYPT: 'disabled',
  },
  '3': {
    ACCESSI_TEST_DB_PORT: '3056',
    ACCESSI_TEST_DB_DATABASE: '/var/lib/firebird/data/test_accessi.fdb',
    ACCESSI_TEST_DB_DIRECTORY: '/var/lib/firebird/data',
  },
  '5': {
    ACCESSI_TEST_DB_PORT: '3055',
    ACCESSI_TEST_DB_DATABASE: '/var/lib/firebird/data/test_accessi.fdb',
    ACCESSI_TEST_DB_DIRECTORY: '/var/lib/firebird/data',
  },
};

const selected = DEFAULTS[version] || DEFAULTS['5'];
const result = spawnSync(
  process.execPath,
  [
    '--test',
    // I file condividono lo stesso DB e la migrazione non e serializzata tra processi:
    // eseguirli in sequenza evita conflitti di creazione dello schema.
    '--test-concurrency=1',
    path.join(__dirname, 'accessi.integration.cjs'),
    path.join(__dirname, 'allegati.integration.cjs'),
    // Scenari di migrazione profondi (schema legacy, backfill, trigger, snapshot), comuni a 2.5/3/5.
    path.join(__dirname, '..', 'accessi-schema.cjs'),
  ],
  { stdio: 'inherit', env: { ...selected, ...process.env } },
);

process.exit(result.status ?? 1);
