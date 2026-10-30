require('ts-node/register/transpile-only');
require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const {
  createAccessiEdgeRateLimitMiddleware,
} = require('../src/accessi-module/security/edgeRateLimit');
const {
  checkPublicAuthRateLimit,
} = require('../src/accessi-module/security/publicAuthRateLimit');
const {
  createMemoryRateLimitStore,
} = require('../src/accessi-module/security/rateLimitStore');

function recordingStore() {
  const inner = createMemoryRateLimitStore();
  const keys = [];
  return {
    keys,
    async consume(key, windowMs, maxAttempts) {
      keys.push(key);
      return inner.consume(key, windowMs, maxAttempts);
    },
    async healthCheck() {
      return true;
    },
    reset() {
      inner.reset();
    },
  };
}

const edgeMiddleware = (store, maxAttempts = 100) =>
  createAccessiEdgeRateLimitMiddleware({
    store,
    windowMs: 60_000,
    maxAttempts,
    audit: false,
    match: () => true,
  });

async function startServer({ trustProxy, buildApp }) {
  const app = express();
  if (trustProxy !== undefined) app.set('trust proxy', trustProxy);
  buildApp(app);
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    port,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function request(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path, headers, method: 'GET' },
      (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          resolve({ status: res.statusCode, body: body ? JSON.parse(body) : null });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

test('senza trust proxy X-Forwarded-For non cambia req.ip ne il bucket', async () => {
  const store = recordingStore();
  const server = await startServer({
    buildApp(app) {
      app.use(edgeMiddleware(store, 2));
      app.get('/api/accessi/ping', (req, res) => res.json({ ip: req.ip }));
    },
  });

  try {
    const first = await request(server.port, '/api/accessi/ping', { 'X-Forwarded-For': '6.6.6.6' });
    const second = await request(server.port, '/api/accessi/ping', { 'X-Forwarded-For': '7.7.7.7' });
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.ok(!first.body.ip.includes('6.6.6.6'), 'X-Forwarded-For non deve essere usato senza trust proxy');
    assert.equal(store.keys[0], `edge|ip|${first.body.ip}`);
    assert.equal(store.keys[1], `edge|ip|${second.body.ip}`, 'header diversi dallo stesso socket condividono il bucket');

    // Terza richiesta dallo stesso socket: limite 2 raggiunto, nessun bypass con header.
    const third = await request(server.port, '/api/accessi/ping', { 'X-Forwarded-For': '8.8.8.8' });
    assert.equal(third.status, 429);
    assert.equal(third.body.code, 'ACCESSI_EDGE_RATE_LIMITED');
  } finally {
    await server.close();
  }
});

test('con trust proxy 1 req.ip e il client reale e i bucket sono separati', async () => {
  const store = recordingStore();
  const server = await startServer({
    trustProxy: 1,
    buildApp(app) {
      app.use(edgeMiddleware(store));
      app.get('/api/accessi/ping', (req, res) => res.json({ ip: req.ip }));
    },
  });

  try {
    const milano = await request(server.port, '/api/accessi/ping', { 'X-Forwarded-For': '203.0.113.10' });
    const roma = await request(server.port, '/api/accessi/ping', { 'X-Forwarded-For': '203.0.113.20' });

    assert.equal(milano.body.ip, '203.0.113.10');
    assert.equal(roma.body.ip, '203.0.113.20');
    assert.deepEqual(store.keys, ['edge|ip|203.0.113.10', 'edge|ip|203.0.113.20']);
  } finally {
    await server.close();
  }
});

test('con trust proxy 1 un header preposto dal client non sposta il bucket', async () => {
  const store = recordingStore();
  const server = await startServer({
    trustProxy: 1,
    buildApp(app) {
      app.use(edgeMiddleware(store));
      app.get('/api/accessi/ping', (req, res) => res.json({ ip: req.ip }));
    },
  });

  try {
    // Il proxy accoda l'IP reale: l'attaccante puo solo anteporre valori falsi.
    const result = await request(server.port, '/api/accessi/ping', {
      'X-Forwarded-For': '6.6.6.6, 203.0.113.10',
    });

    assert.equal(result.body.ip, '203.0.113.10');
    assert.deepEqual(store.keys, ['edge|ip|203.0.113.10']);
  } finally {
    await server.close();
  }
});

test('trust proxy loopback accetta X-Forwarded-For solo dal proxy locale', async () => {
  const store = recordingStore();
  const server = await startServer({
    trustProxy: 'loopback',
    buildApp(app) {
      app.use(edgeMiddleware(store));
      app.get('/api/accessi/ping', (req, res) => res.json({ ip: req.ip }));
    },
  });

  try {
    const result = await request(server.port, '/api/accessi/ping', {
      'X-Forwarded-For': '198.51.100.7',
    });
    assert.equal(result.body.ip, '198.51.100.7');
    assert.deepEqual(store.keys, ['edge|ip|198.51.100.7']);
  } finally {
    await server.close();
  }
});

test('trust proxy true e rischioso: usa il valore piu a sinistra dell\'header', async () => {
  const server = await startServer({
    trustProxy: true,
    buildApp(app) {
      app.get('/api/accessi/ping', (req, res) => res.json({ ip: req.ip }));
    },
  });

  try {
    const result = await request(server.port, '/api/accessi/ping', {
      'X-Forwarded-For': '6.6.6.6, 203.0.113.10',
    });
    // Documenta il motivo per cui docs/proxy-ip.md sconsiglia `true` su servizi
    // raggiungibili direttamente: il client puo scegliere l'IP del bucket.
    assert.equal(result.body.ip, '6.6.6.6');
  } finally {
    await server.close();
  }
});

test('checkPublicAuthRateLimit usa req.ip per i bucket IP e IP+soggetto', async () => {
  const store = recordingStore();
  const options = {
    publicAuthRateLimit: {
      store,
      login: { windowMs: 60_000, maxAttempts: 10 },
    },
  };
  const server = await startServer({
    trustProxy: 1,
    buildApp(app) {
      app.get('/api/accessi/login', async (req, res) => {
        const decision = await checkPublicAuthRateLimit(options, 'login', req, ['Utente@Example.Test']);
        res.json({ decision });
      });
    },
  });

  try {
    const result = await request(server.port, '/api/accessi/login', {
      'X-Forwarded-For': '203.0.113.30',
    });
    assert.equal(result.body.decision.allowed, true);
    assert.deepEqual(store.keys, [
      'login|ip|203.0.113.30',
      'login|ip-subject|203.0.113.30|utente@example.test',
    ]);
  } finally {
    await server.close();
  }
});
