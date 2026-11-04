require('ts-node/register/transpile-only');

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  AccessiDatabaseMigrationDeclinedError,
  AccessiDatabaseMigrationFailedError,
  AccessiDatabaseSchemaNewerError,
  AccessiDatabaseSchemaOutdatedError,
  compareAccessiSchemaVersions,
  ensureAccessiDatabase,
  evaluateAccessiDatabasePreflight,
  formatAccessiDatabaseMigrationPrompt,
  resolveAccessiDatabaseMigrationPolicy,
} = require('../src/accessi-service/database-updates/accessiDatabaseStartup');
const { AccessiDatabaseUpdater } = require('../src/accessi-service/database-updates/AccessiDatabaseUpdater');
const { ACCESSI_SCHEMA_VERSION } = require('../src/accessi-service/database-updates/accessiSchema');

const EXPECTED = ACCESSI_SCHEMA_VERSION;
const compatible = (issues = []) => ({ compatible: issues.length === 0, issues, warnings: [] });

function options(overrides = {}) {
  return { databaseOptions: {}, autoUpdateDatabase: true, ...overrides };
}

function startupDependencies(overrides = {}) {
  const state = { migrations: 0, prompts: 0 };
  const dependencies = {
    getVersion: async () => EXPECTED,
    inspect: async () => compatible(),
    migrate: async () => { state.migrations += 1; },
    isInteractive: () => true,
    prompt: async () => { state.prompts += 1; return true; },
    ...overrides,
  };
  return { dependencies, state };
}

test('#35: confronta le versioni semver Accessi', () => {
  assert.equal(compareAccessiSchemaVersions('1.12.0', '1.12.0'), 0);
  assert.equal(compareAccessiSchemaVersions('1.11.9', '1.12.0'), -1);
  assert.equal(compareAccessiSchemaVersions('2.0.0', '1.12.0'), 1);
  assert.equal(compareAccessiSchemaVersions('1.12', '1.12.0'), undefined);
  assert.equal(compareAccessiSchemaVersions('non-valida', '1.12.0'), undefined);
});

test('#35: il preflight distingue schema sano, mancante, vecchio, diforme e futuro', () => {
  assert.equal(evaluateAccessiDatabasePreflight('1.12.0', EXPECTED, compatible()).status, 'ok');
  assert.equal(evaluateAccessiDatabasePreflight(null, EXPECTED, compatible()).reason, 'missing');
  assert.equal(evaluateAccessiDatabasePreflight('1.11.0', EXPECTED, compatible()).reason, 'older');
  assert.equal(
    evaluateAccessiDatabasePreflight(EXPECTED, EXPECTED, compatible(['colonna mancante'])).reason,
    'drift',
  );
  assert.equal(evaluateAccessiDatabasePreflight('9.9.9', EXPECTED, compatible()).status, 'newer');
  assert.equal(evaluateAccessiDatabasePreflight('non-valida', EXPECTED, compatible()).reason, 'invalid');
});

test('#35: autoUpdateDatabase false forza la policy fail', () => {
  assert.equal(resolveAccessiDatabaseMigrationPolicy(options({ autoUpdateDatabase: false })), 'fail');
  assert.equal(resolveAccessiDatabaseMigrationPolicy(options()), 'ask');
  assert.equal(resolveAccessiDatabaseMigrationPolicy(options({ databaseMigration: 'migrate' })), 'migrate');
  assert.equal(resolveAccessiDatabaseMigrationPolicy(options({ databaseMigration: 'fail' })), 'fail');
});

test('#35: il messaggio di conferma contiene versione corrente, attesa e SI/NO', () => {
  const report = evaluateAccessiDatabasePreflight('1.11.0', EXPECTED, compatible());
  const message = formatAccessiDatabaseMigrationPrompt(report);
  assert.match(message, /Non siamo alla versione corretta di Accessi\./);
  assert.match(message, new RegExp(`Corrente: 1\\.11\\.0 - Attesa: ${EXPECTED.replace(/\./g, '\\.')}`));
  assert.match(message, /Vuoi avviare la migrazione\? SI - NO/);
});

test('#35: schema sano non chiede conferma e non migra', async () => {
  const { dependencies, state } = startupDependencies();
  const report = await ensureAccessiDatabase(options(), dependencies);
  assert.equal(report.status, 'ok');
  assert.equal(state.prompts, 0);
  assert.equal(state.migrations, 0);
});

test('#35: policy fail blocca senza prompt e senza migrazione', async () => {
  const { dependencies, state } = startupDependencies({
    getVersion: async () => '1.11.0',
    inspect: async () => compatible(),
  });
  await assert.rejects(
    ensureAccessiDatabase(options({ autoUpdateDatabase: false }), dependencies),
    (error) => {
      assert.ok(error instanceof AccessiDatabaseSchemaOutdatedError);
      assert.equal(error.code, 'ACCESSI_DATABASE_SCHEMA_OUTDATED');
      assert.match(error.message, /Corrente: 1\.11\.0/);
      assert.match(error.message, new RegExp(`Attesa: ${EXPECTED.replace(/\./g, '\\.')}`));
      return true;
    },
  );
  assert.equal(state.prompts, 0);
  assert.equal(state.migrations, 0);
});

test('#35: sessione non interattiva con policy ask blocca e spiega come migrare', async () => {
  const { dependencies, state } = startupDependencies({
    getVersion: async () => '1.11.0',
    inspect: async () => compatible(),
    isInteractive: () => false,
  });
  await assert.rejects(
    ensureAccessiDatabase(options(), dependencies),
    (error) => {
      assert.ok(error instanceof AccessiDatabaseMigrationDeclinedError);
      assert.match(error.message, /sessione non interattiva/);
      assert.match(error.message, /ACCESSI_DB_MIGRATION_POLICY=migrate/);
      return true;
    },
  );
  assert.equal(state.prompts, 0);
  assert.equal(state.migrations, 0);
});

test('#35: risposta NO blocca avvio e migrazione', async () => {
  const { dependencies, state } = startupDependencies({
    getVersion: async () => '1.11.0',
    inspect: async () => compatible(),
    prompt: async () => { state.prompts += 1; return false; },
  });
  await assert.rejects(
    ensureAccessiDatabase(options(), dependencies),
    (error) => {
      assert.ok(error instanceof AccessiDatabaseMigrationDeclinedError);
      assert.match(error.message, /annullata dall'utente/);
      return true;
    },
  );
  assert.equal(state.prompts, 1);
  assert.equal(state.migrations, 0);
});

test('#35: risposta SI migra una volta e richiede il secondo check sano', async () => {
  let versionCalls = 0;
  let inspectionCalls = 0;
  const { dependencies, state } = startupDependencies({
    getVersion: async () => (versionCalls++ === 0 ? '1.11.0' : EXPECTED),
    inspect: async () => (inspectionCalls++ === 0 ? compatible(['vecchio']) : compatible()),
  });
  const report = await ensureAccessiDatabase(options(), dependencies);
  assert.equal(report.status, 'ok');
  assert.equal(state.prompts, 1);
  assert.equal(state.migrations, 1);
});

test('#35: migrazione che non converge blocca con errore esplicito', async () => {
  const { dependencies, state } = startupDependencies({
    getVersion: async () => '1.11.0',
    inspect: async () => compatible(),
  });
  await assert.rejects(
    ensureAccessiDatabase(options({ databaseMigration: 'migrate' }), dependencies),
    (error) => {
      assert.ok(error instanceof AccessiDatabaseMigrationFailedError);
      assert.equal(error.code, 'ACCESSI_DATABASE_MIGRATION_FAILED');
      assert.match(error.message, /non e sano/);
      return true;
    },
  );
  assert.equal(state.migrations, 1);
});

test('#35: schema piu recente non chiede conferma e vieta il downgrade', async () => {
  const { dependencies, state } = startupDependencies({
    getVersion: async () => '9.9.9',
    inspect: async () => compatible(),
  });
  await assert.rejects(
    ensureAccessiDatabase(options({ databaseMigration: 'migrate' }), dependencies),
    (error) => {
      assert.ok(error instanceof AccessiDatabaseSchemaNewerError);
      assert.match(error.message, /downgrade automatico non consentito/);
      return true;
    },
  );
  assert.equal(state.prompts, 0);
  assert.equal(state.migrations, 0);
});

test('#35: chiamate concorrenti condividono lo stesso preflight', async t => {
  let inspections = 0;
  const o = options();
  t.mock.method(AccessiDatabaseUpdater, 'getCurrentVersion', async () => EXPECTED);
  t.mock.method(AccessiDatabaseUpdater, 'inspectSchema', async () => {
    inspections += 1;
    return compatible();
  });
  await Promise.all([
    AccessiDatabaseUpdater.ensure(o),
    AccessiDatabaseUpdater.ensure(o),
  ]);
  assert.equal(inspections, 1);
});
