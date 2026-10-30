require('ts-node/register/transpile-only');
require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const full = require('../src/accessi-module/Console/generated/emilsoftware-utilities');
const publicEntry = require('../src/accessi/client/public');
const adminEntry = require('../src/accessi/client/admin');
const serviceEntry = require('../src/accessi/client/service');
const { createAccessiClient } = require('../src/accessi/client');

/** Nomi delle operazioni (funzioni generate) esportate da un entry point. */
function operationNames(entry) {
  return Object.keys(full).filter(
    (key) => typeof full[key] === 'function' && typeof entry[key] === 'function',
  );
}

function jsonResponse() {
  return new Response(JSON.stringify({ Result: {} }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function installFetch(delayMs = 0) {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), headers: new Headers(init?.headers) });
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    return jsonResponse();
  };
  return {
    calls,
    restore() {
      globalThis.fetch = originalFetch;
    },
  };
}

test('il client pubblico espone solo operazioni pubbliche', () => {
  assert.equal(typeof publicEntry.login, 'function');
  assert.equal(typeof publicEntry.refreshAccessToken, 'function');
  assert.equal(typeof publicEntry.sendPasswordResetEmail, 'function');
  assert.equal(typeof publicEntry.bootstrapAdmin, 'function');
  assert.equal(typeof publicEntry.createAccessiPublicClient, 'function');

  for (const adminOperation of [
    'getUsers',
    'createRole',
    'createMenu',
    'getSchema',
    'getFiltriUtente',
    'createServiceToken',
    'introspectAccessiToken',
  ]) {
    assert.equal(publicEntry[adminOperation], undefined, `${adminOperation} non deve essere nel client pubblico`);
  }
});

test('il client admin espone le operazioni amministrative senza login e service token', () => {
  assert.equal(typeof adminEntry.getUsers, 'function');
  assert.equal(typeof adminEntry.createRole, 'function');
  assert.equal(typeof adminEntry.getSchema, 'function');
  assert.equal(typeof adminEntry.getFederatedProviders, 'function');
  assert.equal(typeof adminEntry.createAccessiAdminClient, 'function');

  for (const otherScopeOperation of ['login', 'introspectAccessiToken', 'createServiceToken']) {
    assert.equal(adminEntry[otherScopeOperation], undefined, `${otherScopeOperation} non deve essere nel client admin`);
  }
});

test('il client service espone service token e introspezione', () => {
  assert.equal(typeof serviceEntry.createServiceToken, 'function');
  assert.equal(typeof serviceEntry.rotateServiceToken, 'function');
  assert.equal(typeof serviceEntry.introspectAccessiToken, 'function');
  assert.equal(typeof serviceEntry.createAccessiServiceClient, 'function');

  for (const otherScopeOperation of ['login', 'getUsers', 'createRole']) {
    assert.equal(serviceEntry[otherScopeOperation], undefined, `${otherScopeOperation} non deve essere nel client service`);
  }
});

test('gli scope partizionano il client completo senza sovrapposizioni', () => {
  const fullOperations = Object.keys(full).filter((key) => typeof full[key] === 'function');
  const publicOperations = operationNames(publicEntry);
  const adminOperations = operationNames(adminEntry);
  const serviceOperations = operationNames(serviceEntry);

  const union = new Set([...publicOperations, ...adminOperations, ...serviceOperations]);
  assert.equal(union.size, fullOperations.length, 'ogni operazione deve appartenere a uno scope');
  assert.deepEqual([...union].sort(), [...fullOperations].sort(), 'la somma degli scope deve coprire il client completo');

  const overlap = publicOperations.filter(
    (operation) => adminOperations.includes(operation) || serviceOperations.includes(operation),
  );
  assert.deepEqual(overlap, [], 'le operazioni non devono comparire in piu scope');
  assert.equal(
    adminOperations.filter((operation) => serviceOperations.includes(operation)).length,
    0,
    'admin e service non devono condividere operazioni',
  );
});

test('client di scope diversi usano base URL e token propri in concorrenza', async () => {
  const fetchStub = installFetch(5);
  try {
    const publicClient = publicEntry.createAccessiPublicClient({
      baseUrl: 'https://pubblico.example.test',
      token: 'token-pubblico',
    });
    const adminClient = adminEntry.createAccessiAdminClient({
      baseUrl: 'https://admin.example.test',
      getToken: async () => 'token-admin',
    });
    const serviceClient = serviceEntry.createAccessiServiceClient({
      baseUrl: 'https://service.example.test',
      token: 'token-service',
    });

    await Promise.all([
      publicClient.login({ email: 'utente@example.test', password: 'password' }),
      adminClient.getUsers(),
      serviceClient.getServiceTokens(),
      publicClient.refreshAccessToken({ refreshToken: 'refresh' }),
      adminClient.getRoles(),
      serviceClient.introspectAccessiToken({ token: 'access' }),
    ]);

    assert.deepEqual(
      fetchStub.calls.map((call) => `${new URL(call.url).origin} ${call.headers.get('Authorization')}`).sort(),
      [
        'https://admin.example.test Bearer token-admin',
        'https://admin.example.test Bearer token-admin',
        'https://pubblico.example.test Bearer token-pubblico',
        'https://pubblico.example.test Bearer token-pubblico',
        'https://service.example.test Bearer token-service',
        'https://service.example.test Bearer token-service',
      ],
    );
  } finally {
    fetchStub.restore();
  }
});

test('gli scope mantengono la configurazione isolata per istanza', () => {
  const first = publicEntry.createAccessiPublicClient({ baseUrl: 'https://primo.example.test', token: 'primo' });
  const second = publicEntry.createAccessiPublicClient({ baseUrl: 'https://secondo.example.test', token: 'secondo' });

  assert.deepEqual(first.getConfig(), { baseUrl: 'https://primo.example.test', token: 'primo' });
  first.configure({ baseUrl: 'https://aggiornato.example.test' });
  assert.equal(first.getConfig().baseUrl, 'https://aggiornato.example.test');
  assert.equal(second.getConfig().baseUrl, 'https://secondo.example.test');
  assert.equal(
    typeof createAccessiClient().getUsers,
    'function',
    'il client completo continua a esporre tutte le operazioni',
  );
});
