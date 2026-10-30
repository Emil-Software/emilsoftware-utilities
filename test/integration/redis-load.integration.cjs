// Test di concorrenza e carico contro Redis reale.
//
// Modalita d'uso:
//   ACCESSI_TEST_REDIS_URL=redis://127.0.0.1:6379 npm run test:load:redis
//
// Senza `ACCESSI_TEST_REDIS_URL` i test vengono saltati; con
// `ACCESSI_TEST_REQUIRE_REDIS=1` falliscono invece di essere saltati (CI).
// Ogni test usa due client distinti per simulare due istanze Accessi che
// condividono lo stesso Redis. Il report di latenza viene stampato e, se
// `ACCESSI_TEST_REPORT_FILE` e impostata, scritto in quel file Markdown.
require('ts-node/register/transpile-only');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { RedisTestClient } = require('./helpers/redisTestClient.cjs');
const { createRedisRateLimitStore } = require('../../src/accessi-module/security/rateLimitStore');
const { createRedisConsoleEntryStore } = require('../../src/accessi-module/security/consoleEntry');
const {
  createRedisRefreshTokenRotationStore,
} = require('../../src/accessi-module/security/refreshTokenRotation');
const {
  checkPublicAuthRateLimit,
} = require('../../src/accessi-module/security/publicAuthRateLimit');

const REDIS_URL = (process.env.ACCESSI_TEST_REDIS_URL ?? '').trim();
const REQUIRE_REDIS = process.env.ACCESSI_TEST_REQUIRE_REDIS === '1';
const REPORT_FILE = (process.env.ACCESSI_TEST_REPORT_FILE ?? '').trim();
const RUN_PREFIX = `accessi-load:${process.pid}:${randomBytes(4).toString('hex')}:`;
const ITERATIONS = Math.max(20, Number(process.env.ACCESSI_TEST_LOAD_ITERATIONS ?? '200') || 200);
const CONCURRENCY = Math.max(1, Number(process.env.ACCESSI_TEST_LOAD_CONCURRENCY ?? '50') || 50);

let clientA = null;
let clientB = null;
let skipReason = 'ACCESSI_TEST_REDIS_URL non impostata: load test Redis saltati.';
const reports = [];

before(async () => {
  if (!REDIS_URL) {
    if (REQUIRE_REDIS) {
      throw new Error('ACCESSI_TEST_REQUIRE_REDIS=1 ma ACCESSI_TEST_REDIS_URL non e impostata.');
    }
    return;
  }

  try {
    clientA = await new RedisTestClient(REDIS_URL).connect();
    clientB = await new RedisTestClient(REDIS_URL).connect();
    assert.equal(String(await clientA.command('PING')).toUpperCase(), 'PONG');
    assert.equal(String(await clientB.command('PING')).toUpperCase(), 'PONG');
  } catch (error) {
    clientA = null;
    clientB = null;
    if (REQUIRE_REDIS) {
      throw new Error(`Redis non raggiungibile su ${REDIS_URL}: ${error.message}`);
    }
    skipReason = `Redis non raggiungibile (${REDIS_URL}): load test Redis saltati.`;
  }
});

after(async () => {
  if (!clientA) return;
  const clients = [clientA, clientB].filter(Boolean);
  clientA = null;
  clientB = null;
  try {
    await deleteByPrefix(clients[0], `${RUN_PREFIX}*`);
  } finally {
    for (const client of clients) await client.quit().catch(() => {});
  }

  if (reports.length === 0) return;
  const markdown = renderReport();
  if (REPORT_FILE) {
    fs.mkdirSync(path.dirname(REPORT_FILE), { recursive: true });
    fs.writeFileSync(REPORT_FILE, markdown);
    console.log(`Report latenze scritto in ${REPORT_FILE}`);
  }
  console.log(markdown);
});

function loadTest(name, fn) {
  test(name, async (t) => {
    if (!clientA || !clientB) {
      t.skip(skipReason);
      return;
    }
    await fn(t, { instanceA: clientA, instanceB: clientB });
  });
}

async function deleteByPrefix(activeClient, pattern) {
  let cursor = '0';
  do {
    const reply = await activeClient.command('SCAN', cursor, 'MATCH', pattern, 'COUNT', '500');
    cursor = String(reply[0]);
    const keys = reply[1];
    if (Array.isArray(keys) && keys.length > 0) {
      await activeClient.command('DEL', ...keys);
    }
  } while (cursor !== '0');
}

function prefix(name) {
  return `${RUN_PREFIX}${name}:`;
}

function percentile(sorted, value) {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor((value / 100) * sorted.length));
  return sorted[index];
}

/**
 * Esegue `count` operazioni con concorrenza limitata e misura latenza/throughput.
 * Gli errori vengono contati ma non interrompono la misura: il test decide se
 * un errore e ammesso (per esempio un consumo perso) oppure no.
 */
async function measure(label, count, concurrency, operation) {
  const durations = new Array(count);
  const errors = [];
  let next = 0;
  const startedAt = process.hrtime.bigint();

  const workers = Array.from({ length: Math.min(concurrency, count) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= count) return;
      const operationStartedAt = process.hrtime.bigint();
      try {
        await operation(index);
      } catch (error) {
        errors.push(error);
      } finally {
        durations[index] = Number(process.hrtime.bigint() - operationStartedAt) / 1e6;
      }
    }
  });
  await Promise.all(workers);

  const totalMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
  const sorted = [...durations].sort((left, right) => left - right);
  const report = {
    label,
    count,
    concurrency,
    errors: errors.length,
    totalMs,
    throughput: totalMs > 0 ? count / (totalMs / 1000) : 0,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    max: sorted[sorted.length - 1] ?? 0,
  };
  reports.push(report);
  return { report, errors, durations };
}

function renderReport() {
  const lines = [
    '',
    '## Report carico Redis Accessi',
    '',
    `- Iterazioni per scenario: ${ITERATIONS}`,
    `- Concorrenza: ${CONCURRENCY}`,
    '- Due client Redis distinti per simulare due istanze Accessi.',
    '',
    '| Scenario | Operazioni | Errori | Throughput (ops/s) | p50 (ms) | p95 (ms) | max (ms) |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...reports.map((report) =>
      `| ${report.label} | ${report.count} | ${report.errors} | ${report.throughput.toFixed(1)} | ${report.p50.toFixed(2)} | ${report.p95.toFixed(2)} | ${report.max.toFixed(2)} |`,
    ),
    '',
  ];
  return lines.join('\n');
}

test('#17: burst su login, reset e 2FA non superano i limiti globali', async (t) => {
  if (!clientA || !clientB) {
    t.skip(skipReason);
    return;
  }

  const keyPrefix = prefix('rate');
  const storeA = createRedisRateLimitStore({ client: clientA, keyPrefix });
  const storeB = createRedisRateLimitStore({ client: clientB, keyPrefix });
  // Due oggetti distinti: ogni chiamata sceglie un'istanza, ma il bucket e Redis.
  const options = [
    { publicAuthRateLimit: { store: storeA } },
    { publicAuthRateLimit: { store: storeB } },
  ];
  const scenarios = [
    { scope: 'login', ip: '198.51.100.10', max: 10 },
    { scope: 'passwordResetEmail', ip: '198.51.100.11', max: 5 },
    { scope: 'twoFactorVerify', ip: '198.51.100.12', max: 20 },
  ];

  for (const scenario of scenarios) {
    const attempts = scenario.max * 6;
    const allowed = [];
    const { report, errors } = await measure(
      `rate limit ${scenario.scope}`,
      attempts,
      CONCURRENCY,
      async (index) => {
        const decision = await checkPublicAuthRateLimit(
          options[index % options.length],
          scenario.scope,
          { headers: {}, ip: scenario.ip, socket: {} },
          [`utente-${index}@example.test`],
        );
        if (decision.allowed) allowed.push(index);
      },
    );

    assert.equal(errors.length, 0, `errori durante il burst ${scenario.scope}: ${errors[0]?.message}`);
    assert.equal(
      allowed.length,
      scenario.max,
      `${scenario.scope}: ${allowed.length} richieste ammesse su un limite di ${scenario.max}`,
    );
    assert.ok(report.p95 < 2000, `${scenario.scope}: p95 ${report.p95.toFixed(1)} ms troppo alto`);
  }
});

test('#17: due istanze consumano un ticket console una sola volta', async (t) => {
  if (!clientA || !clientB) {
    t.skip(skipReason);
    return;
  }

  const keyPrefix = prefix('console');
  const shared = { keyPrefix, encryptionKey: 'segreto-di-load-test-console' };
  const storeA = createRedisConsoleEntryStore({ client: clientA, ...shared });
  const storeB = createRedisConsoleEntryStore({ client: clientB, ...shared });
  const record = { token: 'jwt-ticket-monouso', codiceUtente: 77 };
  const { ticket } = await storeA.issue(record, 60_000);

  const consumed = [];
  const { report, errors } = await measure(
    'console ticket (2 istanze)',
    100,
    CONCURRENCY,
    async (index) => {
      const result = await (index % 2 === 0 ? storeA : storeB).consume(ticket);
      if (result) consumed.push(result);
    },
  );

  assert.equal(errors.length, 0);
  assert.equal(consumed.length, 1, 'il ticket deve essere consumato da una sola istanza');
  assert.deepEqual(consumed[0], record);
  assert.equal(await storeB.consume(ticket), null);
  assert.ok(report.p95 < 1000, `p95 ${report.p95.toFixed(1)} ms troppo alto`);
});

test('#17: refresh concorrenti sullo stesso jti e revoca famiglia tra istanze', async (t) => {
  if (!clientA || !clientB) {
    t.skip(skipReason);
    return;
  }

  const keyPrefix = prefix('refresh');
  const familyKeyPrefix = prefix('refresh-family');
  const storeA = createRedisRefreshTokenRotationStore({ client: clientA, keyPrefix, familyKeyPrefix });
  const storeB = createRedisRefreshTokenRotationStore({ client: clientB, keyPrefix, familyKeyPrefix });
  const expiresAt = Date.now() + 60_000;
  const jti = 'jti-load-concorrenza';

  const outcomes = [];
  const { report, errors } = await measure(
    'refresh rotation (2 istanze)',
    ITERATIONS,
    CONCURRENCY,
    async (index) => {
      outcomes.push(await (index % 2 === 0 ? storeA : storeB).consumeWithMetadata(jti, expiresAt));
    },
  );

  assert.equal(errors.length, 0);
  assert.equal(outcomes.filter((outcome) => outcome.consumed).length, 1);
  const losers = outcomes.filter((outcome) => !outcome.consumed);
  assert.equal(losers.length, ITERATIONS - 1);
  for (const loser of losers) assert.ok(Number.isFinite(loser.consumedAtMs));
  assert.ok(report.p95 < 1000, `p95 ${report.p95.toFixed(1)} ms troppo alto`);

  await storeA.revokeFamily('famiglia-load', expiresAt);
  assert.equal(await storeB.isFamilyRevoked('famiglia-load'), true);
  assert.equal(await storeA.isFamilyRevoked('famiglia-load'), true);
});
