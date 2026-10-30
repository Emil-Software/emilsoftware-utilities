require('ts-node/register/transpile-only');
require('reflect-metadata');
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { generateKeyPairSync } = require('node:crypto');

const {
  countAccessiMetric,
  createAccessiJwksHandler,
  createAccessiMetricsRegistry,
  getAccessiMetricsRegistry,
  getAccessiAccessTokenVerificationConfig,
  instrumentAccessiRedisClient,
  observeAccessiMetric,
  resetAccessiMetrics,
  resolveAccessiVerificationKeys,
  revokeAccessiUserSessions,
} = require('../src/accessi-module');
const { createMemorySessionRevocationStore } = require('../src/accessi-module/security/sessionRevocation');
const { checkPublicAuthRateLimit } = require('../src/accessi-module/security/publicAuthRateLimit');
const { createMemoryRateLimitStore } = require('../src/accessi-module/security/rateLimitStore');
const { AuthController } = require('../src/accessi-module/Controllers/AuthController');
const { AccessiIntrospectionController } = require('../src/accessi-module/Controllers/AccessiIntrospectionController');
const { ConsoleEntryController } = require('../src/accessi-module/Controllers/ConsoleEntryController');

function fakeResponse() {
  return {
    statusCode: 200,
    body: undefined,
    headers: {},
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
    append() {
      return this;
    },
  };
}

function fakeRequest(overrides = {}) {
  return { headers: {}, method: 'POST', path: '/api/accessi/auth/login', ip: '127.0.0.10', ...overrides };
}

function counterValue(name, labels = {}) {
  const entry = getAccessiMetricsRegistry()
    .snapshot()
    .counters.find((counter) =>
      counter.name === name
      && Object.entries(labels).every(([key, value]) => counter.labels[key] === String(value)),
    );
  return entry?.value ?? 0;
}

function baseOptions(extra = {}) {
  return {
    databaseOptions: {},
    encryptionKey: '0123456789ABCDEF',
    confirmationEmailUrl: 'http://localhost',
    confirmationEmailReturnUrl: 'http://localhost',
    jwtOptions: { secret: 'm'.repeat(40), expiresIn: '1h', algorithm: 'HS256' },
    ...extra,
  };
}

beforeEach(() => {
  resetAccessiMetrics();
});

test('#12: il registry espone contatori, gauge, istogrammi e label escapati', () => {
  const registry = createAccessiMetricsRegistry();
  registry.increment('accessi_test_total', 2, { result: 'ok', quote: 'a"b' });
  registry.increment('accessi_test_total', 3, { result: 'ok', quote: 'a"b' });
  registry.gauge('accessi_in_flight', 4);
  registry.observe('accessi_duration_ms', 12);
  registry.observe('accessi_duration_ms', 120);

  const snapshot = registry.snapshot();
  assert.equal(snapshot.counters[0].value, 5);
  assert.equal(snapshot.gauges[0].value, 4);
  assert.equal(snapshot.histograms[0].count, 2);
  assert.equal(snapshot.histograms[0].sum, 132);

  const output = registry.renderPrometheus();
  assert.match(output, /# TYPE accessi_test_total counter/);
  assert.match(output, /accessi_test_total\{quote="a\\"b",result="ok"\} 5/);
  assert.match(output, /accessi_duration_ms_bucket\{le="25"\} 1/);
  assert.match(output, /accessi_duration_ms_bucket\{le="250"\} 2/);
  assert.match(output, /accessi_duration_ms_bucket\{le="\+Inf"\} 2/);
  assert.match(output, /accessi_duration_ms_sum 132/);

  registry.reset();
  assert.equal(registry.snapshot().counters.length, 0);
});

test('#12: sink custom, prefisso e disattivazione', () => {
  const events = [];
  const sink = {
    increment: (name, value, labels) => events.push({ name, value, labels }),
    observe: (name, value, labels) => events.push({ name, value, labels }),
  };
  const options = baseOptions({ metrics: { sink } });
  countAccessiMetric(options, 'auth_login_total', { result: 'success' });
  observeAccessiMetric(options, 'auth_login_duration_ms', 8);

  assert.deepEqual(events[0], { name: 'accessi_auth_login_total', value: 1, labels: { result: 'success' } });
  assert.deepEqual(events[1], { name: 'accessi_auth_login_duration_ms', value: 8, labels: undefined });

  const custom = baseOptions({ metrics: { sink, prefix: 'acme' } });
  countAccessiMetric(custom, 'auth_login_total', { result: 'failure' });
  assert.equal(events[2].name, 'acme_auth_login_total');

  const disabled = baseOptions({ metrics: { enabled: false, sink } });
  const before = events.length;
  countAccessiMetric(disabled, 'auth_login_total');
  observeAccessiMetric(disabled, 'auth_login_duration_ms', 1);
  assert.equal(events.length, before);
});

test('#12: login, 2FA e refresh contano esito e durata', async () => {
  const tokens = { access: { value: 'access', type: 'Bearer', expiresIn: '3600' } };
  const controller = new AuthController({
    async login() { return { utente: { codiceUtente: 1 } }; },
    createTokenPair() { return tokens; },
    async verifyTwoFactor() { return { utente: { codiceUtente: 1 }, ...tokens }; },
    async resendTwoFactor() { return { challenge: { challengeId: 'x' } }; },
    async refreshAccessToken() { return { token: tokens.access }; },
  }, {}, baseOptions());

  await controller.login(fakeRequest(), { email: 'utente@example.test', password: 'x' }, fakeResponse());
  assert.equal(counterValue('accessi_auth_login_total', { result: 'success' }), 1);
  assert.equal(
    getAccessiMetricsRegistry().snapshot().histograms.filter((entry) => entry.name === 'accessi_auth_login_duration_ms').length,
    1,
  );

  const failing = new AuthController({ async login() { return null; } }, {}, baseOptions());
  await failing.login(fakeRequest({ ip: '127.0.0.11' }), { email: 'no@example.test', password: 'x' }, fakeResponse());
  assert.equal(counterValue('accessi_auth_login_total', { result: 'failure' }), 1);

  await controller.verifyTwoFactor(
    fakeRequest({ path: '/api/accessi/auth/two-factor/verify' }),
    { challengeId: 'challenge', code: '123456' },
    fakeResponse(),
  );
  assert.equal(counterValue('accessi_auth_two_factor_total', { action: 'verify', result: 'success' }), 1);

  await controller.refresh(fakeRequest({ path: '/api/accessi/auth/refresh' }), { refreshToken: 'r' }, fakeResponse());
  assert.equal(counterValue('accessi_auth_refresh_total', { result: 'success' }), 1);
});

test('#12: introspection conta active, inactive, bad request ed error', async () => {
  const controller = new AccessiIntrospectionController(
    {
      async introspectAccessToken(token) {
        if (token === 'active') return { active: true, codiceUtente: 1, payload: { utente: { codiceUtente: 1 } } };
        if (token === 'boom') throw new Error('store down');
        return { active: false };
      },
    },
    { async getUserRolesAndGrants() { return { grants: [] }; } },
  );

  const active = fakeResponse();
  await controller.introspect({ token: 'active' }, active);
  await controller.introspect({ token: 'inactive' }, fakeResponse());
  await controller.introspect({}, fakeResponse());
  await controller.introspect({ token: 'boom' }, fakeResponse());

  assert.equal(counterValue('accessi_introspection_total', { result: 'active' }), 1);
  assert.equal(counterValue('accessi_introspection_total', { result: 'inactive' }), 1);
  assert.equal(counterValue('accessi_introspection_total', { result: 'bad_request' }), 1);
  assert.equal(counterValue('accessi_introspection_total', { result: 'error' }), 1);
});

test('#12: rate limit bloccato e revoca sessioni producono contatori', async () => {
  const store = createMemoryRateLimitStore();
  const options = baseOptions({
    publicAuthRateLimit: { store, login: { windowMs: 60_000, maxAttempts: 1 } },
  });
  assert.equal((await checkPublicAuthRateLimit(options, 'login', fakeRequest(), [])).allowed, true);
  assert.equal((await checkPublicAuthRateLimit(options, 'login', fakeRequest(), [])).allowed, false);
  assert.equal(counterValue('accessi_rate_limit_blocked_total', { scope: 'login', layer: 'public' }), 1);

  const memory = createMemorySessionRevocationStore();
  const sessionOptions = baseOptions({ sessionRevocation: { store: memory } });
  await revokeAccessiUserSessions(sessionOptions, 1, Date.now(), 'password_change');
  assert.equal(counterValue('accessi_sessions_revoked_total', { reason: 'password_change' }), 1);
});

test('#12: JWKS, kid sconosciuto e console ticket contano gli esiti', async () => {
  const handler = createAccessiJwksHandler(baseOptions());
  const unavailable = fakeResponse();
  handler({}, unavailable);
  assert.equal(unavailable.statusCode, 404);
  assert.equal(counterValue('accessi_jwks_requests_total', { result: 'unavailable' }), 1);

  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const options = baseOptions({
    jwtOptions: {
      secret: 'm'.repeat(40),
      expiresIn: '1h',
      algorithm: 'RS256',
      privateKey,
      publicKey,
      keyId: 'current',
    },
  });
  const ok = fakeResponse();
  createAccessiJwksHandler(options)({}, ok);
  assert.equal(counterValue('accessi_jwks_requests_total', { result: 'ok' }), 1);

  const token = jwt.sign({ typ: 'access' }, privateKey, { algorithm: 'RS256', keyid: 'ghost' });
  assert.deepEqual(resolveAccessiVerificationKeys(getAccessiAccessTokenVerificationConfig(options), token), []);
  assert.equal(
    counterValue('accessi_jwt_unknown_key_id_total', { purpose: 'access', algorithm: 'RS256' }),
    1,
  );

  const store = {
    async issue() { return { ticket: 'ticket-1', expiresInSeconds: 30 }; },
    async consume(ticket) { return ticket === 'good' ? { token: 'jwt', codiceUtente: 1 } : null; },
  };
  const controller = new ConsoleEntryController({
    ...baseOptions(),
    consoleEntry: { store },
    publicAuthRateLimit: { enabled: false },
  });
  const request = { headers: { authorization: 'Bearer jwt' }, user: { codiceUtente: 1, flagAdmin: true } };
  await controller.createEntryTicket(request, fakeResponse());
  await controller.exchangeEntryTicket(fakeRequest(), { ticket: 'good' }, fakeResponse());
  await controller.exchangeEntryTicket(fakeRequest(), { ticket: 'bad' }, fakeResponse());

  assert.equal(counterValue('accessi_console_ticket_total', { action: 'create', result: 'issued' }), 1);
  assert.equal(counterValue('accessi_console_ticket_total', { action: 'exchange', result: 'consumed' }), 1);
  assert.equal(counterValue('accessi_console_ticket_total', { action: 'exchange', result: 'invalid' }), 1);
});

test('#12: gli errori degli store Redis sono contati e la latenza misurata', async () => {
  const broken = instrumentAccessiRedisClient('rate_limit', {
    async eval() {
      throw new Error('redis down');
    },
  });
  await assert.rejects(() => broken.eval('', 0), /redis down/);
  assert.equal(counterValue('accessi_store_errors_total', { store: 'rate_limit' }), 1);

  const healthy = instrumentAccessiRedisClient('console_entry', {
    async eval() {
      return 'PONG';
    },
  });
  assert.equal(await healthy.eval('', 0), 'PONG');
  const histogram = getAccessiMetricsRegistry()
    .snapshot()
    .histograms.find((entry) => entry.name === 'accessi_store_operation_duration_ms' && entry.labels.store === 'console_entry');
  assert.equal(histogram.labels.store, 'console_entry');
  assert.equal(histogram.count, 1);

  // Altri metodi del client restano disponibili e legati all'istanza.
  const client = instrumentAccessiRedisClient('refresh_token_rotation', {
    connected: true,
    async eval() { return 1; },
    describe() { return this.connected; },
  });
  assert.equal(client.connected, true);
  assert.equal(client.describe(), true);
});
