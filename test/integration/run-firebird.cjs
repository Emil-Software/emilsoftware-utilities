// Wrapper cross-platform per gli integration test: imposta i default di
// connessione in base alla major version di Firebird e avvia `node --test`.
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const version = process.argv[2] || '5';

const DEFAULTS = {
  '3': {
    ACCESSI_TEST_DB_PORT: '3056',
    ACCESSI_TEST_DB_DATABASE: '/var/lib/firebird/data/test_accessi.fdb',
  },
  '5': {
    ACCESSI_TEST_DB_PORT: '3055',
    ACCESSI_TEST_DB_DATABASE: '/var/lib/firebird/data/test_accessi.fdb',
  },
};

const selected = DEFAULTS[version] || DEFAULTS['5'];
const result = spawnSync(
  process.execPath,
  [
    '--test',
    path.join(__dirname, 'accessi.integration.cjs'),
    path.join(__dirname, 'allegati.integration.cjs'),
  ],
  { stdio: 'inherit', env: { ...selected, ...process.env } },
);

process.exit(result.status ?? 1);
