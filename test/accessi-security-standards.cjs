require('ts-node/register/transpile-only');
require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync } = require('node:crypto');
const {
  buildAccessiJwks,
  createAccessiJwksHandler,
  getAccessiJwksPath,
  setupAccessiJwks,
} = require('../src/accessi-module/security/jwks');
const {
  createMemoryConsoleEntryStore,
  createRedisConsoleEntryStore,
} = require('../src/accessi-module/security/consoleEntry');
const { ConsoleEntryController } = require('../src/accessi-module/Controllers/ConsoleEntryController');
const {
  createMemoryRateLimitStore,
  createRedisRateLimitStore,
} = require('../src/accessi-module/security/rateLimitStore');
const { checkPublicAuthRateLimit } = require('../src/accessi-module/security/publicAuthRateLimit');
const { assertServiceTokenRateLimit } = require('../src/accessi-module/security/serviceTokenRateLimit');
const { createAccessiEdgeRateLimitMiddleware } = require('../src/accessi-module/security/edgeRateLimit');

function rsaKeys() {
  return generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

function accessiOptions(jwtOptions) {
  return {
    databaseOptions: {},
    jwtOptions,
  };
}

function fakeResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
      return this;
    },
    send(body) {
      this.body = body;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test('JWKS espone la chiave corrente e le chiavi precedenti', () => {
  const current = rsaKeys();
  const previous = rsaKeys();
  const options = accessiOptions({
    secret: 'unused-for-rs256',
    expiresIn: '1h',
    algorithm: 'RS256',
    privateKey: current.privateKey,
    publicKey: current.publicKey,
    keyId: 'accessi-2026-02',
    previousPublicKeys: [
      { publicKey: previous.publicKey, keyId: 'accessi-2026-01', algorithm: 'RS256' },
    ],
  });

  const jwks = buildAccessiJwks(options);
  assert.ok(jwks);
  assert.equal(jwks.keys.length, 2);
  assert.deepEqual(jwks.keys.map((key) => key.kid), ['accessi-2026-02', 'accessi-2026-01']);
  assert.ok(jwks.keys.every((key) => key.use === 'sig' && key.alg === 'RS256'));
  assert.ok(jwks.keys[0].n);
  assert.ok(jwks.keys[0].e);
});

test('JWKS non e disponibile con HS256', () => {
  const options = accessiOptions({
    secret: 'hmac-secret',
    expiresIn: '1h',
  });
  assert.equal(buildAccessiJwks(options), null);
  assert.equal(getAccessiJwksPath(options), undefined);
});

test('setupAccessiJwks monta la route e risponde con cache header', () => {
  const keys = rsaKeys();
  const options = accessiOptions({
    secret: 'unused-for-rs256',
    expiresIn: '1h',
    algorithm: 'RS256',
    privateKey: keys.privateKey,
    publicKey: keys.publicKey,
    keyId: 'key-1',
  });
  const routes = [];
  const app = {
    get(path, handler) {
      routes.push({ path, handler });
    },
  };

  const path = setupAccessiJwks(app, options);
  assert.equal(path, '/accessi/.well-known/jwks.json');
  assert.equal(routes.length, 1);
  assert.equal(routes[0].path, path);

  const res = fakeResponse();
  routes[0].handler({}, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Cache-Control'], 'public, max-age=300');
  assert.equal(res.body.keys[0].kid, 'key-1');
});

test('JWKS handler risponde 404 quando la configurazione e HS256', () => {
  const handler = createAccessiJwksHandler(accessiOptions({
    secret: 'hmac-secret',
    expiresIn: '1h',
  }));
  const res = fakeResponse();
  handler({}, res);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.code, 'ACCESSI_JWKS_NOT_AVAILABLE');
});

test('memory console store: ticket monouso e scadenza', t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 0, 1, 12, 0, 0) });
  const store = createMemoryConsoleEntryStore(10);
  const issued = store.issueSync({ token: 'jwt-token', codiceUtente: 7 }, 1000);

  assert.equal(issued.expiresInSeconds, 1);
  assert.deepEqual(store.consumeSync(issued.ticket), { token: 'jwt-token', codiceUtente: 7 });
  assert.equal(store.consumeSync(issued.ticket), null);

  const second = store.issueSync({ token: 'jwt-token', codiceUtente: 7 }, 1000);
  t.mock.timers.tick(1001);
  assert.equal(store.consumeSync(second.ticket), null);
});

function createFakeRedis() {
  const data = new Map();
  return {
    data,
    async eval(script, _numKeys, ...args) {
      if (script.includes("redis.call('SET'")) {
        const [key, value, ttl] = args;
        if (data.has(key)) return null;
        data.set(key, { value, expiresAt: Date.now() + Number(ttl) });
        return 'OK';
      }
      if (script.includes("redis.call('GET'")) {
        const [key] = args;
        const entry = data.get(key);
        if (!entry) return null;
        data.delete(key);
        if (entry.expiresAt <= Date.now()) return null;
        return entry.value;
      }
      throw new Error(`Script Redis non gestito: ${script}`);
    },
  };
}

test('redis console store: cifra il JWT, consuma atomicamente e non riusa il ticket', async () => {
  const redis = createFakeRedis();
  const store = createRedisConsoleEntryStore({
    client: redis,
    encryptionKey: 'console-entry-secret',
  });

  const issued = await store.issue({ token: 'jwt-in-chiaro', codiceUtente: 42 }, 60_000);
  const stored = [...redis.data.values()][0];
  assert.equal(stored.value.includes('jwt-in-chiaro'), false);
  assert.ok(stored.value.includes('.'));

  assert.deepEqual(await store.consume(issued.ticket), {
    token: 'jwt-in-chiaro',
    codiceUtente: 42,
  });
  assert.equal(await store.consume(issued.ticket), null);
});

test('redis console store: ticket scaduto non viene restituito', async () => {
  const redis = createFakeRedis();
  const store = createRedisConsoleEntryStore({
    client: redis,
    encryptionKey: 'console-entry-secret',
  });
  const issued = await store.issue({ token: 'jwt', codiceUtente: 1 }, 1_000);
  const entry = [...redis.data.values()][0];
  entry.expiresAt = Date.now() - 1;

  assert.equal(await store.consume(issued.ticket), null);
});

test('memory rate limit store: blocca oltre il massimo e resetta', async () => {
  const store = createMemoryRateLimitStore(100);
  assert.equal((await store.consume('login|ip|1', 60_000, 2)).allowed, true);
  assert.equal((await store.consume('login|ip|1', 60_000, 2)).allowed, true);
  const blocked = await store.consume('login|ip|1', 60_000, 2);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds > 0);
  assert.equal((await store.consume('login|ip|2', 60_000, 2)).allowed, true);
  store.reset();
  assert.equal((await store.consume('login|ip|1', 60_000, 2)).allowed, true);
});

function createFakeRateRedis() {
  const data = new Map();
  return {
    data,
    async eval(script, _numKeys, ...args) {
      if (!script.includes("redis.call('INCR'")) {
        throw new Error(`Script Redis rate limit non gestito: ${script}`);
      }
      const [key, windowMs, maxAttempts] = args;
      const now = Date.now();
      let entry = data.get(key);
      if (!entry || entry.expiresAt <= now) {
        entry = { count: 0, expiresAt: now + Number(windowMs) };
        data.set(key, entry);
      }
      entry.count += 1;
      const ttl = Math.max(1, entry.expiresAt - now);
      return [entry.count <= Number(maxAttempts) ? 1 : 0, ttl];
    },
  };
}

test('redis rate limit store: usa INCR atomico e restituisce retry', async () => {
  const redis = createFakeRateRedis();
  const store = createRedisRateLimitStore({ client: redis, keyPrefix: 'test:rate:' });

  assert.equal((await store.consume('login|ip|1', 60_000, 2)).allowed, true);
  assert.equal((await store.consume('login|ip|1', 60_000, 2)).allowed, true);
  const blocked = await store.consume('login|ip|1', 60_000, 2);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds > 0);
  assert.ok(redis.data.has('test:rate:login|ip|1'));
});

test('public auth rate limit usa lo store configurato per IP e soggetto', async () => {
  const keys = [];
  const store = {
    async consume(key) {
      keys.push(key);
      return { allowed: true, retryAfterSeconds: 0 };
    },
  };
  const decision = await checkPublicAuthRateLimit(
    { publicAuthRateLimit: { store, login: { windowMs: 1000, maxAttempts: 2 } } },
    'login',
    { ip: '198.51.100.5', socket: {} },
    ['utente@example.com'],
  );
  assert.equal(decision.allowed, true);
  assert.deepEqual(keys, [
    'login|ip|198.51.100.5',
    'login|ip-subject|198.51.100.5|utente@example.com',
  ]);
});

test('rate limit fail closed se lo store condiviso non e disponibile', async () => {
  const failingStore = {
    async consume() {
      throw new Error('Redis non raggiungibile');
    },
  };

  await assert.rejects(
    () => checkPublicAuthRateLimit(
      { publicAuthRateLimit: { store: failingStore } },
      'login',
      { ip: '203.0.113.9', socket: {} },
    ),
    error => error.getStatus() === 503 && error.getResponse().code === 'ACCESSI_RATE_LIMIT_UNAVAILABLE',
  );

  await assert.rejects(
    () => assertServiceTokenRateLimit('203.0.113.9', failingStore),
    error => error.getStatus() === 503 && error.getResponse().code === 'ACCESSI_RATE_LIMIT_UNAVAILABLE',
  );
});

test('edge rate limit applica la soglia per IP solo alle rotte Accessi', async () => {
  const store = createMemoryRateLimitStore(10);
  const middleware = createAccessiEdgeRateLimitMiddleware({
    store,
    windowMs: 60_000,
    maxAttempts: 1,
    match: path => path.startsWith('/api/accessi'),
  });
  const request = { path: '/api/accessi/auth/login', ip: '203.0.113.20', socket: {} };

  const first = fakeResponse();
  let firstNext = 0;
  await middleware(request, first, () => { firstNext += 1; });
  assert.equal(firstNext, 1);

  const blocked = fakeResponse();
  await middleware(request, blocked, () => {
    throw new Error('next non deve essere chiamato');
  });
  assert.equal(blocked.statusCode, 429);
  assert.equal(blocked.body.code, 'ACCESSI_EDGE_RATE_LIMITED');
  assert.ok(Number(blocked.headers['Retry-After']) > 0);

  const otherPath = fakeResponse();
  let otherNext = 0;
  await middleware(
    { path: '/altro', ip: '203.0.113.20', socket: {} },
    otherPath,
    () => { otherNext += 1; },
  );
  assert.equal(otherNext, 1);
});

test('edge rate limit fallisce chiuso se lo store non risponde', async () => {
  const middleware = createAccessiEdgeRateLimitMiddleware({
    store: {
      async consume() {
        throw new Error('Redis non raggiungibile');
      },
    },
    match: () => true,
  });
  const res = fakeResponse();
  await middleware(
    { path: '/api/accessi/auth/login', ip: '203.0.113.21', socket: {} },
    res,
    () => { throw new Error('next non deve essere chiamato'); },
  );
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, 'ACCESSI_RATE_LIMIT_UNAVAILABLE');
});

test('ConsoleEntryController usa lo store configurato', async () => {
  const issued = [];
  const consumed = [];
  const store = {
    async issue(record, ttlMs) {
      issued.push({ record, ttlMs });
      return { ticket: 'a'.repeat(64), expiresInSeconds: 1 };
    },
    async consume(ticket) {
      consumed.push(ticket);
      return { token: 'jwt', codiceUtente: 1 };
    },
  };
  const controller = new ConsoleEntryController({
    consoleEntry: { store, ttlMs: 1000 },
  });

  const createRes = fakeResponse();
  await controller.createEntryTicket({
    headers: { authorization: 'Bearer jwt' },
    user: { codiceUtente: 1, flagAdmin: true, flagSuper: false },
  }, createRes);
  assert.equal(createRes.statusCode, 200);
  assert.equal(issued.length, 1);
  assert.equal(issued[0].ttlMs, 1000);
  assert.equal(issued[0].record.token, 'jwt');

  const exchangeRes = fakeResponse();
  await controller.exchangeEntryTicket(
    { ip: '127.0.0.1' },
    { ticket: 'a'.repeat(64) },
    exchangeRes,
  );
  assert.equal(exchangeRes.statusCode, 200);
  assert.deepEqual(consumed, ['a'.repeat(64)]);
});
