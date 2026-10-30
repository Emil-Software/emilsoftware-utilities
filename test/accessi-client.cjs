require('ts-node/register/transpile-only');
require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  configureAccessiClient,
  createAccessiClient,
  getAccessiClientConfig,
  login,
  runWithAccessiClient,
} = require('../src/accessi/client');

function jsonResponse() {
  return new Response(JSON.stringify({ Result: {} }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Installa un fetch finto che registra URL e header di ogni richiesta. */
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

function auth(call) {
  return call.headers.get('Authorization');
}

test('due client isolati usano base URL e token propri anche in concorrenza', async () => {
  const fetchStub = installFetch(5);
  try {
    const milano = createAccessiClient({
      baseUrl: 'https://accessi-milano.example.test',
      token: 'token-milano',
    });
    const roma = createAccessiClient({
      baseUrl: 'https://accessi-roma.example.test',
      getToken: async () => 'token-roma',
    });

    await Promise.all([milano.getUsers(), roma.getUsers(), milano.getRoles(), roma.getRoles()]);

    assert.equal(fetchStub.calls.length, 4);
    assert.deepEqual(
      fetchStub.calls.map((call) => `${new URL(call.url).origin} ${auth(call)}`).sort(),
      [
        'https://accessi-milano.example.test Bearer token-milano',
        'https://accessi-milano.example.test Bearer token-milano',
        'https://accessi-roma.example.test Bearer token-roma',
        'https://accessi-roma.example.test Bearer token-roma',
      ],
    );
    assert.equal(getAccessiClientConfig(), null, 'la configurazione isolata non deve restare attiva');
  } finally {
    fetchStub.restore();
  }
});

test('il token provider di un client viene invocato a ogni richiesta', async () => {
  const fetchStub = installFetch();
  const tokens = ['primo', 'secondo'];
  try {
    const client = createAccessiClient({
      baseUrl: 'https://accessi.example.test',
      getToken: () => tokens.shift() ?? null,
    });

    await client.getUsers();
    await client.getUsers();

    assert.deepEqual(fetchStub.calls.map(auth), ['Bearer primo', 'Bearer secondo']);
  } finally {
    fetchStub.restore();
  }
});

test('configure aggiorna solo l\'istanza e getConfig ne restituisce una copia', async () => {
  const fetchStub = installFetch();
  try {
    const isolation = createAccessiClient({ baseUrl: 'https://primo.example.test', token: 'token-1' });
    const other = createAccessiClient({ baseUrl: 'https://secondo.example.test', token: 'token-2' });

    const snapshot = isolation.getConfig();
    snapshot.token = 'manomesso';
    assert.equal(isolation.getConfig().token, 'token-1');

    isolation.configure({ baseUrl: 'https://primo-aggiornato.example.test', token: 'token-3' });

    await Promise.all([isolation.getUsers(), other.getUsers()]);
    assert.deepEqual(
      fetchStub.calls.map((call) => `${new URL(call.url).origin} ${auth(call)}`),
      [
        'https://primo-aggiornato.example.test Bearer token-3',
        'https://secondo.example.test Bearer token-2',
      ],
    );
  } finally {
    fetchStub.restore();
  }
});

test('il client isolato senza token non eredita il token globale', async () => {
  const fetchStub = installFetch();
  try {
    configureAccessiClient({ baseUrl: 'https://globale.example.test', token: 'token-globale' });
    const anonymous = createAccessiClient({ baseUrl: 'https://pubblico.example.test' });

    await anonymous.getMenus();
    await login({ email: 'utente@example.test', password: 'password' });

    assert.equal(new URL(fetchStub.calls[0].url).origin, 'https://pubblico.example.test');
    assert.equal(auth(fetchStub.calls[0]), null, 'il client isolato non deve usare il token globale');
    assert.equal(fetchStub.calls[1].url, 'https://globale.example.test/api/accessi/auth/login');
    assert.equal(auth(fetchStub.calls[1]), 'Bearer token-globale');
  } finally {
    fetchStub.restore();
    configureAccessiClient({});
  }
});

test('la configurazione globale resta il default per le funzioni esportate', async () => {
  const fetchStub = installFetch();
  try {
    configureAccessiClient({ baseUrl: 'https://globale.example.test', token: 'token-globale' });
    const instance = createAccessiClient({ baseUrl: 'https://isolato.example.test', token: 'token-isolato' });

    await instance.getRoles();
    await login({ email: 'utente@example.test', password: 'password' });

    assert.equal(new URL(fetchStub.calls[0].url).origin, 'https://isolato.example.test');
    assert.equal(auth(fetchStub.calls[0]), 'Bearer token-isolato');
    assert.equal(fetchStub.calls[1].url, 'https://globale.example.test/api/accessi/auth/login');
    assert.equal(auth(fetchStub.calls[1]), 'Bearer token-globale');
  } finally {
    fetchStub.restore();
    configureAccessiClient({});
  }
});

test('runWithAccessiClient isola una singola chiamata e ripristina il contesto', async () => {
  const fetchStub = installFetch();
  const observed = [];
  try {
    runWithAccessiClient({ baseUrl: 'https://esterno.example.test' }, () => {
      observed.push(getAccessiClientConfig()?.baseUrl);
      runWithAccessiClient({ baseUrl: 'https://interno.example.test' }, () => {
        observed.push(getAccessiClientConfig()?.baseUrl);
      });
      observed.push(getAccessiClientConfig()?.baseUrl);
    });
    assert.deepEqual(observed, [
      'https://esterno.example.test',
      'https://interno.example.test',
      'https://esterno.example.test',
    ]);
    assert.equal(getAccessiClientConfig(), null);

    await runWithAccessiClient(
      { baseUrl: 'https://una-tantum.example.test', token: 'token-tantum' },
      () => login({ email: 'utente@example.test', password: 'password' }),
    );
    assert.equal(fetchStub.calls[0].url, 'https://una-tantum.example.test/api/accessi/auth/login');
    assert.equal(auth(fetchStub.calls[0]), 'Bearer token-tantum');
  } finally {
    fetchStub.restore();
  }
});

test('il contesto viene ripristinato anche se il callback lancia', () => {
  assert.throws(
    () => runWithAccessiClient({ baseUrl: 'https://errore.example.test' }, () => {
      throw new Error('boom');
    }),
    /boom/,
  );
  assert.equal(getAccessiClientConfig(), null);
});

test('createAccessiClient e esportato dagli entry point pubblici', () => {
  const client = require('../src/accessi/client');
  assert.equal(typeof client.createAccessiClient, 'function');
  assert.equal(typeof client.runWithAccessiClient, 'function');
  assert.equal(typeof client.getAccessiClientConfig, 'function');
});
