require('ts-node/register/transpile-only');
require('reflect-metadata');
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { generateKeyPairSync } = require('node:crypto');

const {
  auditAccessi,
  configureAccessiAudit,
  createCallbackAccessiAuditSink,
  createHttpAccessiAuditSink,
  createMemoryAccessiAuditSink,
  createRedisAccessiAuditSink,
  getAccessiAuditStore,
  getAccessiMetricsRegistry,
  getAccessiAccessTokenVerificationConfig,
  redactAccessiAuditValue,
  resetAccessiAudit,
  resetAccessiMetrics,
  resolveAccessiVerificationKeys,
} = require('../src/accessi-module');
const { AccessiAuditController } = require('../src/accessi-module/Controllers/AccessiAuditController');
const { AuthController } = require('../src/accessi-module/Controllers/AuthController');

function fakeResponse() {
  return {
    statusCode: 200,
    body: undefined,
    headers: {},
    chunks: [],
    ended: false,
    headersSent: false,
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = String(value);
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
    send(body) {
      this.body = body;
      return this;
    },
    write(chunk) {
      this.chunks.push(String(chunk));
      this.headersSent = true;
      return true;
    },
    end() {
      this.ended = true;
      return this;
    },
    append() {},
  };
}

function fakeRequest(overrides = {}) {
  return {
    headers: {},
    ip: '127.0.0.20',
    user: { codiceUtente: 1, flagAdmin: true },
    ...overrides,
  };
}

function baseOptions(extra = {}) {
  return {
    databaseOptions: {},
    encryptionKey: '0123456789ABCDEF',
    confirmationEmailUrl: 'http://localhost',
    confirmationEmailReturnUrl: 'http://localhost',
    jwtOptions: { secret: 'a'.repeat(40), expiresIn: '1h', algorithm: 'HS256' },
    ...extra,
  };
}

function record(event, timestamp, extra = {}) {
  return { event, timestamp, ...extra };
}

beforeEach(() => {
  resetAccessiAudit();
  resetAccessiMetrics();
});

test('#11: la redazione copre token, segreti e payload profondi', () => {
  const long = 'x'.repeat(600);
  const redacted = redactAccessiAuditValue({
    token: 'jwt-segreto',
    accessToken: 'access',
    refresh_token: 'refresh',
    Authorization: 'Bearer abc',
    nested: {
      password: 'p',
      passwordHash: 'hash',
      privateKey: 'pem',
      ok: 1,
    },
    long,
    list: Array.from({ length: 80 }, (_, index) => index),
    deep: { a: { b: { c: { d: { e: 'troppo' } } } } },
    bigint: 10n,
    error: new Error('boom'),
  });

  assert.equal(redacted.token, '[REDACTED]');
  assert.equal(redacted.accessToken, '[REDACTED]');
  assert.equal(redacted.refresh_token, '[REDACTED]');
  assert.equal(redacted.Authorization, '[REDACTED]');
  assert.equal(redacted.nested.password, '[REDACTED]');
  assert.equal(redacted.nested.passwordHash, '[REDACTED]');
  assert.equal(redacted.nested.privateKey, '[REDACTED]');
  assert.equal(redacted.nested.ok, 1);
  assert.equal(redacted.long.length, 512);
  assert.equal(redacted.list.length, 50);
  assert.equal(redacted.deep.a.b.c.d, '[TRUNCATED]');
  assert.equal(redacted.bigint, '10');
  assert.deepEqual(redacted.error, { name: 'Error', message: 'boom' });
});

test('#11: sink in memoria con filtri, paginazione e retention', async () => {
  const sink = createMemoryAccessiAuditSink({ maxRecords: 5 });
  for (let index = 0; index < 4; index += 1) {
    sink.write(record(index % 2 === 0 ? 'login_succeeded' : 'login_failed', new Date(1_700_000_000_000 + index * 1000).toISOString(), { codiceUtente: index }));
  }

  const all = await sink.query({ order: 'asc' });
  assert.equal(all.total, 4);
  assert.deepEqual(all.records.map((entry) => entry.codiceUtente), [0, 1, 2, 3]);

  const filtered = await sink.query({ event: 'login_succeeded', order: 'desc', limit: 1 });
  assert.equal(filtered.total, 2);
  assert.equal(filtered.records.length, 1);
  assert.equal(filtered.records[0].codiceUtente, 2);

  const byUser = await sink.query({ codiceUtente: 1 });
  assert.equal(byUser.total, 1);

  const byRange = await sink.query({
    from: new Date(1_700_000_001_000).toISOString(),
    to: new Date(1_700_000_002_000).toISOString(),
  });
  assert.equal(byRange.total, 2);

  assert.equal(await sink.purge(new Date(1_700_000_002_000)), 2);
  assert.equal((await sink.query()).total, 2);

  sink.write(record('one', new Date().toISOString()));
  sink.write(record('two', new Date().toISOString()));
  sink.write(record('three', new Date().toISOString()));
  assert.equal(sink.all().length, 5);
  assert.equal(sink.all()[0].event, 'login_succeeded');
});

test('#11: auditAccessi scrive su tutti i sink con redazione', async () => {
  const first = createMemoryAccessiAuditSink();
  const second = createMemoryAccessiAuditSink();
  const received = [];
  configureAccessiAudit({
    sinks: [first, second, createCallbackAccessiAuditSink((entry) => received.push(entry), 'callback')],
    logger: false,
  });

  auditAccessi('login_succeeded', { codiceUtente: 3, token: 'segreto', nested: { password: 'p' } });
  await new Promise((resolve) => setImmediate(resolve));

  const stored = await first.query();
  assert.equal(stored.total, 1);
  assert.equal(stored.records[0].token, '[REDACTED]');
  assert.equal(stored.records[0].nested.password, '[REDACTED]');
  assert.equal((await second.query()).total, 1);
  assert.equal(received.length, 1);
  assert.equal(getAccessiAuditStore(), first);

  configureAccessiAudit({ enabled: false, sinks: [first] });
  auditAccessi('disabled_event', {});
  assert.equal((await first.query()).total, 1);
});

test('#11: sink HTTP e errori del sink contano senza rompere il flusso', async () => {
  const requests = [];
  const okSink = createHttpAccessiAuditSink({
    url: 'https://collector.example.test/audit',
    headers: { 'X-Tenant': 'acme' },
    fetch: async (url, init) => {
      requests.push({ url, init });
      return new Response('', { status: 202 });
    },
  });
  await okSink.write(record('login_succeeded', new Date().toISOString()));
  assert.equal(requests[0].url, 'https://collector.example.test/audit');
  assert.equal(requests[0].init.headers['X-Tenant'], 'acme');
  assert.equal(JSON.parse(requests[0].init.body).event, 'login_succeeded');

  const failing = createHttpAccessiAuditSink({
    url: 'https://collector.example.test/audit',
    fetch: async () => new Response('nope', { status: 500 }),
  });
  configureAccessiAudit({ sinks: [failing], logger: false });
  auditAccessi('login_failed', {});
  await new Promise((resolve) => setImmediate(resolve));
  const errors = getAccessiMetricsRegistry()
    .snapshot()
    .counters.find((counter) => counter.name === 'accessi_audit_sink_errors_total');
  assert.equal(errors.value, 1);
  assert.equal(errors.labels.sink, 'http');
});

function fakeRedisAuditClient() {
  const list = [];
  return {
    list,
    async eval(script, _numKeys, ...args) {
      if (script.includes("redis.call('LRANGE'")) return [...list];
      if (script.includes("redis.call('DEL'")) {
        const records = args.slice(2).map(String);
        list.splice(0, list.length, ...records);
        return records.length;
      }
      if (script.includes("redis.call('RPUSH'")) {
        list.push(String(args[1]));
        const max = Number(args[2]);
        if (list.length > max) list.splice(0, list.length - max);
        return 1;
      }
      throw new Error('script inatteso');
    },
  };
}

test('#11: sink Redis scrive, interroga ed elimina per retention', async () => {
  const client = fakeRedisAuditClient();
  const sink = createRedisAccessiAuditSink({ client, maxRecords: 3, retentionMs: 86_400_000 });
  for (let index = 0; index < 5; index += 1) {
    await sink.write(record('evento', new Date(1_700_000_000_000 + index * 1000).toISOString(), { index }));
  }
  assert.equal(client.list.length, 3);

  const page = await sink.query({ order: 'asc' });
  assert.equal(page.total, 3);
  assert.deepEqual(page.records.map((entry) => entry.index), [2, 3, 4]);

  const filtered = await sink.query({ event: 'altro' });
  assert.equal(filtered.total, 0);

  assert.equal(await sink.purge(new Date(1_700_000_003_500)), 2);
  assert.equal(client.list.length, 1);
  assert.equal((await sink.query()).records[0].index, 4);
});

test('#11: endpoint admin di query ed export NDJSON', async () => {
  const sink = createMemoryAccessiAuditSink();
  sink.write(record('login_succeeded', '2026-01-01T00:00:00.000Z', { codiceUtente: 1 }));
  sink.write(record('login_failed', '2026-01-02T00:00:00.000Z', { codiceUtente: 2 }));
  configureAccessiAudit({ store: sink, logger: false });

  const controller = new AccessiAuditController();
  const list = fakeResponse();
  await controller.query(fakeRequest(), { event: 'login_succeeded' }, list);
  assert.equal(list.statusCode, 200);
  assert.equal(list.body.Result.total, 1);
  assert.equal(list.body.Result.records[0].event, 'login_succeeded');

  const exported = fakeResponse();
  await controller.export(fakeRequest(), {}, exported);
  assert.match(exported.headers['content-type'], /application\/x-ndjson/);
  assert.match(exported.headers['content-disposition'], /accessi-audit-\d{4}-\d{2}-\d{2}\.ndjson/);
  assert.equal(exported.ended, true);
  const lines = exported.chunks.join('').trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(lines.length, 2);
  assert.equal(lines[0].event, 'login_failed');

  configureAccessiAudit({ logger: false });
  const disabled = fakeResponse();
  await controller.query(fakeRequest(), {}, disabled);
  assert.equal(disabled.statusCode, 501);
  assert.equal(disabled.body.code, 'ACCESSI_AUDIT_STORE_DISABLED');

  const forbidden = fakeResponse();
  await controller.query(fakeRequest({ user: { codiceUtente: 1 } }), {}, forbidden);
  assert.equal(forbidden.statusCode, 403);
});

test('#11: login, 2FA e kid sconosciuto producono eventi di audit', async () => {
  const sink = createMemoryAccessiAuditSink();
  configureAccessiAudit({ store: sink, logger: false });

  const tokens = { access: { value: 'access', type: 'Bearer', expiresIn: '3600' } };
  const controller = new AuthController({
    async login() { return { utente: { codiceUtente: 9 } }; },
    createTokenPair() { return tokens; },
    async verifyTwoFactor() { return { utente: { codiceUtente: 9 }, ...tokens }; },
  }, {}, baseOptions());

  await controller.login(fakeRequest(), { email: 'utente@example.test', password: 'x' }, fakeResponse());
  await controller.verifyTwoFactor(fakeRequest(), { challengeId: 'c', code: '123456' }, fakeResponse());

  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const options = baseOptions({
    jwtOptions: { secret: 'a'.repeat(40), expiresIn: '1h', algorithm: 'RS256', privateKey, publicKey, keyId: 'current' },
  });
  const token = jwt.sign({ typ: 'access' }, privateKey, { algorithm: 'RS256', keyid: 'ghost' });
  resolveAccessiVerificationKeys(getAccessiAccessTokenVerificationConfig(options), token);

  const events = (await sink.query({ order: 'asc' })).records.map((entry) => entry.event);
  assert.ok(events.includes('login_succeeded'));
  assert.ok(events.includes('two_factor_succeeded'));
  assert.ok(events.includes('jwt_unknown_key_id'));
});
