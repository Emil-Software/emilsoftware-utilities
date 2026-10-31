require('ts-node/register/transpile-only');
require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  createAccessiTenantRouter,
  getAccessiTenantId,
  getAccessiTenantContext,
  loadAccessiTenants,
  recordAccessiMetric,
  resetAccessiAudit,
  resetAccessiMetrics,
  auditAccessi,
  configureAccessiTenantAudit,
  createMemoryAccessiAuditSink,
} = require('../src/accessi/server');
const { getAccessiMetricsRegistry } = require('../src/accessi-module');

function environmentSource(id, hosts) {
  return `export default {
  tenant: { id: '${id}', hosts: ${JSON.stringify(hosts)} },
  database: { host: 'db-${id}', database: '/data/${id}.fdb' },
  jwt: { secret: '${id}-secret-0123456789-0123456789', expiresIn: '1h', issuer: 'https://${id}.example.test', audience: 'accessi-api' },
  email: { host: 'localhost', port: 25, secure: false, requireTLS: false, tls: { rejectUnauthorized: false }, from: 'noreply@example.test', auth: { user: 'u', pass: 'p' } },
  encryptionKey: '0123456789ABCDEF',
  confirmationEmailUrl: 'https://${id}.example.test',
  confirmationEmailReturnUrl: 'https://${id}.example.test',
};
`;
}

function makeRegistry() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'accessi-router-'));
  fs.writeFileSync(path.join(directory, 'a.environment.ts'), environmentSource('a', ['a.example.test']));
  fs.writeFileSync(
    path.join(directory, 'b.environment.ts'),
    environmentSource('b', []).replace("tenant: { id: 'b', hosts: [] }", "tenant: { id: 'b', path: '/tenant-b' }"),
  );
  fs.writeFileSync(
    path.join(directory, 'disabled.environment.ts'),
    environmentSource('disabled', ['disabled.example.test']).replace("id: 'disabled'", "id: 'disabled', enabled: false"),
  );
  return { directory, registry: loadAccessiTenants({ directory }) };
}

function fakeRequest({ host, path: requestPath = '/', headers = {} } = {}) {
  return {
    path: requestPath,
    url: requestPath,
    headers: { ...(host ? { host } : {}), ...headers },
  };
}

function fakeResponse() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
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
  };
}

function run(router, request) {
  const response = fakeResponse();
  let nextCalled = 0;
  router(request, response, () => { nextCalled += 1; });
  return { response, nextCalled };
}

test('#23: instrada per host, path e header fidato senza fallback', () => {
  const { directory, registry } = makeRegistry();
  try {
    const seen = [];
    const handlers = {
      a: (req, res) => {
        seen.push({ id: getAccessiTenantId(), tenant: req.accessiTenant.id });
        res.status(200).send('a');
      },
      b: (req, res) => {
        seen.push({ id: getAccessiTenantId(), tenant: req.accessiTenant.id });
        res.status(200).send('b');
      },
    };
    const router = createAccessiTenantRouter({ registry, handlers });

    let result = run(router, fakeRequest({ host: 'a.example.test' }));
    assert.equal(result.response.statusCode, 200);
    assert.equal(result.response.body, 'a');
    assert.deepEqual(seen.at(-1), { id: 'a', tenant: 'a' });

    result = run(router, fakeRequest({ host: 'unknown.example.test', path: '/tenant-b/api/accessi' }));
    assert.equal(result.response.statusCode, 200);
    assert.equal(result.response.body, 'b');
    assert.deepEqual(seen.at(-1), { id: 'b', tenant: 'b' });

    result = run(router, fakeRequest({ headers: { 'x-accessi-tenant': 'b' } }));
    assert.equal(result.response.statusCode, 404);
    assert.equal(result.response.body.code, 'ACCESSI_TENANT_NOT_FOUND');

    const headerRouter = createAccessiTenantRouter({ registry, handlers, allowHeader: true });
    result = run(headerRouter, fakeRequest({ headers: { 'x-accessi-tenant': 'b' } }));
    assert.equal(result.response.statusCode, 200);
    assert.equal(result.response.body, 'b');

    // Host ha precedenza sull'header.
    result = run(headerRouter, fakeRequest({ host: 'a.example.test', headers: { 'x-accessi-tenant': 'b' } }));
    assert.equal(result.response.body, 'a');

    // Tenant disabilitato e host sconosciuto non fanno fallback.
    result = run(router, fakeRequest({ host: 'disabled.example.test' }));
    assert.equal(result.response.statusCode, 404);
    result = run(router, fakeRequest({ host: 'nessuno.example.test' }));
    assert.equal(result.response.statusCode, 404);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('#23: handler mancante risponde 501 e non delega ad altri tenant', () => {
  const { directory, registry } = makeRegistry();
  try {
    const router = createAccessiTenantRouter({ registry, handlers: { a: (_req, res) => res.send('a') } });
    const result = run(router, fakeRequest({ path: '/tenant-b/api/accessi' }));
    assert.equal(result.response.statusCode, 501);
    assert.equal(result.response.body.code, 'ACCESSI_TENANT_HANDLER_MISSING');
    assert.equal(result.nextCalled, 0);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('#23: il contesto AsyncLocalStorage resta isolato tra richieste concorrenti', async () => {
  const { directory, registry } = makeRegistry();
  try {
    const contexts = [];
    const router = createAccessiTenantRouter({
      registry,
      handlers: {
        a: async (_req, res) => {
          await new Promise((resolve) => setTimeout(resolve, 20));
          contexts.push({ id: getAccessiTenantId(), context: getAccessiTenantContext() });
          res.send('a');
        },
        b: async (_req, res) => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          contexts.push({ id: getAccessiTenantId(), context: getAccessiTenantContext() });
          res.send('b');
        },
      },
    });

    const requestA = fakeRequest({ host: 'a.example.test' });
    const requestB = fakeRequest({ path: '/tenant-b/x' });
    const responseA = fakeResponse();
    const responseB = fakeResponse();
    await Promise.all([
      Promise.resolve(router(requestA, responseA, () => {})),
      Promise.resolve(router(requestB, responseB, () => {})),
    ]);

    assert.deepEqual(contexts.map((entry) => entry.id).sort(), ['a', 'b']);
    assert.deepEqual(
      contexts.find((entry) => entry.id === 'a').context,
      { tenantId: 'a' },
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('#23: audit e metriche emessi nel handler ricevono il tenant corretto', () => {
  const { directory, registry } = makeRegistry();
  const sinkA = createMemoryAccessiAuditSink();
  const sinkB = createMemoryAccessiAuditSink();
  try {
    configureAccessiTenantAudit('a', { store: sinkA, logger: false });
    configureAccessiTenantAudit('b', { store: sinkB, logger: false });
    resetAccessiMetrics();

    const router = createAccessiTenantRouter({
      registry,
      handlers: {
        a: (_req, res) => {
          auditAccessi('tenant_event', { codiceUtente: 1 });
          recordAccessiMetric('router_test_total');
          res.send('a');
        },
        b: (_req, res) => {
          auditAccessi('tenant_event', { codiceUtente: 2 });
          recordAccessiMetric('router_test_total');
          res.send('b');
        },
      },
    });

    run(router, fakeRequest({ host: 'a.example.test' }));
    run(router, fakeRequest({ path: '/tenant-b/x' }));

    const recordsA = sinkA.all();
    const recordsB = sinkB.all();
    assert.equal(recordsA.length, 1);
    assert.equal(recordsB.length, 1);
    assert.equal(recordsA[0].tenant, 'a');
    assert.equal(recordsB[0].tenant, 'b');
    assert.equal(recordsA[0].codiceUtente, 1);
    assert.equal(recordsB[0].codiceUtente, 2);

    const counters = getAccessiMetricsRegistry().snapshot().counters
      .filter((entry) => entry.name === 'router_test_total');
    assert.deepEqual(
      counters.map((entry) => ({ tenant: entry.labels.tenant, value: entry.value })).sort((left, right) => left.tenant.localeCompare(right.tenant)),
      [{ tenant: 'a', value: 1 }, { tenant: 'b', value: 1 }],
    );
  } finally {
    resetAccessiAudit();
    resetAccessiMetrics();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
