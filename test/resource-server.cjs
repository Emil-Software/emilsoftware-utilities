require('ts-node/register/transpile-only');
require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { createPublicKey, generateKeyPairSync } = require('node:crypto');
const {
  createAccessiTokenVerifier,
  createAccessiIntrospectionClient,
  createAccessiResourceServer,
  authenticateAccessiRequest,
  createAccessiAuthMiddleware,
  createAccessiAuthGuard,
  deriveAccessiAccessSecret,
  AccessiResourceServerError,
} = require('../src/accessi/resource-server');
const { mergeOpenApiDocuments } = require('../src/openapi/OpenApiMerge');
const { buildAccessiConsoleUrl } = require('../src/accessi/console');
const { AccessiIntrospectionController } = require('../src/accessi-module');
const { AuthService } = require('../src/accessi-module/Services/AuthService/AuthService');
const { configureAccessiClient, login } = require('../src/accessi/client');
const { createMemorySessionRevocationStore } = require('../src/accessi-module/security/sessionRevocation');

const RAW_SECRET = 'resource-server-test-secret';
const ACCESS_SECRET = deriveAccessiAccessSecret(RAW_SECRET);

function signAccessToken(secret, overrides = {}, options = {}) {
  return jwt.sign(
    {
      typ: 'access',
      amr: ['password'],
      utente: {
        codiceUtente: 123,
        email: 'mario@example.test',
        flagAdmin: false,
        flagSuper: false,
        statoRegistrazione: 20,
      },
      ...overrides,
    },
    secret,
    { expiresIn: '1h', ...options },
  );
}

function createFakeResponse() {
  return {
    statusCode: 0,
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

function createFakeRequest(token) {
  return {
    headers: token ? { authorization: `Bearer ${token}` } : {},
    path: '/protected',
  };
}

test('verifica HS256 usando il segreto grezzo Accessi e la KDF condivisa', async () => {
  const verifier = createAccessiTokenVerifier({ serverSecret: RAW_SECRET });
  const result = await verifier.verify(signAccessToken(ACCESS_SECRET));

  assert.equal(result.codiceUtente, 123);
  assert.equal(result.user.email, 'mario@example.test');
});

test('rifiuta token firmati con un segreto diverso', async () => {
  const verifier = createAccessiTokenVerifier({ serverSecret: RAW_SECRET });
  await assert.rejects(
    () => verifier.verify(signAccessToken('altro-segreto')),
    error => error instanceof AccessiResourceServerError && error.status === 401,
  );
});

test('verifica issuer, audience e algoritmo', async () => {
  const token = signAccessToken(ACCESS_SECRET, {}, { issuer: 'accessi', audience: 'backend-a' });
  const verifier = createAccessiTokenVerifier({
    serverSecret: RAW_SECRET,
    issuer: 'accessi',
    audience: 'backend-a',
  });
  const result = await verifier.verify(token);
  assert.equal(result.codiceUtente, 123);

  const wrongAudience = createAccessiTokenVerifier({
    serverSecret: RAW_SECRET,
    issuer: 'accessi',
    audience: 'backend-b',
  });
  await assert.rejects(() => wrongAudience.verify(token), error => error.status === 401);
});

test('verifica RS256 con chiave pubblica PEM', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const token = jwt.sign(
    { typ: 'access', utente: { codiceUtente: 7, email: 'rsa@example.test' } },
    privateKey,
    { algorithm: 'RS256', expiresIn: '1h', keyid: 'key-1' },
  );
  const verifier = createAccessiTokenVerifier({
    publicKey,
    algorithms: ['RS256'],
  });
  const result = await verifier.verify(token);
  assert.equal(result.codiceUtente, 7);
});

test('verifica RS256 tramite JWKS remoto con cache', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const jwk = createPublicKey(publicKey).export({ format: 'jwk' });
  let fetchCalls = 0;
  const verifier = createAccessiTokenVerifier({
    jwks: {
      url: 'https://accessi.example.test/.well-known/jwks.json',
      fetch: async () => {
        fetchCalls += 1;
        return new Response(JSON.stringify({ keys: [{ ...jwk, kid: 'key-1', alg: 'RS256', use: 'sig' }] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },
    algorithms: ['RS256'],
  });
  const token = jwt.sign(
    { typ: 'access', utente: { codiceUtente: 9 } },
    privateKey,
    { algorithm: 'RS256', expiresIn: '1h', keyid: 'key-1' },
  );

  assert.equal((await verifier.verify(token)).codiceUtente, 9);
  assert.equal((await verifier.verify(token)).codiceUtente, 9);
  assert.equal(fetchCalls, 1);
});

test('il server puo emettere token RS256 verificabili dal resource server', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const options = {
    databaseOptions: {},
    jwtOptions: {
      secret: 'fallback-hmac-secret',
      expiresIn: '1h',
      algorithm: 'RS256',
      privateKey,
      publicKey,
      issuer: 'accessi',
      audience: 'backend-a',
      keyId: 'key-1',
    },
  };
  const authService = new AuthService({}, {}, options, {});
  const token = authService.createAccessiToken(
    {
      codiceUtente: 42,
      email: 'rsa-server@example.test',
      flagAdmin: false,
      flagSuper: false,
      statoRegistrazione: 20,
    },
    ['password'],
  );

  const verifier = createAccessiTokenVerifier({
    publicKey,
    algorithms: ['RS256'],
    issuer: 'accessi',
    audience: 'backend-a',
  });
  const result = await verifier.verify(token.value);
  assert.equal(result.codiceUtente, 42);
  assert.equal(jwt.decode(token.value, { complete: true }).header.kid, 'key-1');
});

test('introspection client invia il service token, normalizza Result e usa la cache', async () => {
  let calls = 0;
  let capturedAuthorization;
  let capturedBody;
  const client = createAccessiIntrospectionClient({
    url: 'https://accessi.example.test/api/accessi/auth/introspect',
    serviceToken: 'service-token',
    fetch: async (_url, init) => {
      calls += 1;
      capturedAuthorization = init.headers.Authorization;
      capturedBody = JSON.parse(init.body);
      return new Response(JSON.stringify({
        Result: {
          active: true,
          user: { codiceUtente: 5, email: 'introspect@example.test' },
          grants: { grants: [{ codiceMenu: 'ORDINI', tipoAbilitazione: 20 }] },
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });

  const first = await client.introspect('user-token');
  const second = await client.introspect('user-token');

  assert.equal(first.active, true);
  assert.equal(first.codiceUtente, 5);
  assert.equal(second.user.email, 'introspect@example.test');
  assert.equal(calls, 1);
  assert.equal(capturedAuthorization, 'Bearer service-token');
  assert.deepEqual(capturedBody, { token: 'user-token' });
});

test('introspection client non cachea i token inattivi', async () => {
  let calls = 0;
  const client = createAccessiIntrospectionClient({
    url: 'https://accessi.example.test/api/accessi/auth/introspect',
    serviceToken: 'service-token',
    fetch: async () => {
      calls += 1;
      return new Response(JSON.stringify({ Result: { active: false } }), { status: 200 });
    },
  });

  assert.equal((await client.introspect('user-token')).active, false);
  assert.equal((await client.introspect('user-token')).active, false);
  assert.equal(calls, 2);
});

test('middleware Express popola req.user e req.accessi', async () => {
  const middleware = createAccessiAuthMiddleware({ jwt: { serverSecret: RAW_SECRET } });
  const req = createFakeRequest(signAccessToken(ACCESS_SECRET));
  const res = createFakeResponse();
  let nextCalls = 0;

  await middleware(req, res, () => { nextCalls += 1; });

  assert.equal(nextCalls, 1);
  assert.equal(req.user.utente.codiceUtente, 123);
  assert.equal(req.accessi.codiceUtente, 123);
});

test('middleware Express risponde 401 con contratto stabile', async () => {
  const middleware = createAccessiAuthMiddleware({ jwt: { serverSecret: RAW_SECRET } });
  const req = createFakeRequest('token-non-valido');
  const res = createFakeResponse();

  await middleware(req, res, () => {
    throw new Error('next non deve essere chiamato');
  });

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, 'AUTH_TOKEN_INVALID');
  assert.equal(res.body.error, 'AUTH_TOKEN_INVALID');
});

test('resource server rifiuta token revocati', async () => {
  const store = createMemorySessionRevocationStore();
  const runtime = createAccessiResourceServer({
    jwt: { serverSecret: RAW_SECRET },
    revocation: { store },
  });
  const token = signAccessToken(ACCESS_SECRET);
  await store.revokeUser(123, Date.now() + 5_000);

  await assert.rejects(
    () => authenticateAccessiRequest(createFakeRequest(token), runtime),
    error => error.status === 401 && error.code === 'AUTH_TOKEN_REVOKED',
  );
});

test('autorizzazione remota: grant sufficiente consente, grant insufficiente nega', async () => {
  const makeMiddleware = (level) => createAccessiAuthMiddleware({
    mode: 'local',
    jwt: { serverSecret: RAW_SECRET },
    introspection: {
      url: 'https://accessi.example.test/api/accessi/auth/introspect',
      serviceToken: 'service-token',
      fetch: async () => new Response(JSON.stringify({
        Result: {
          active: true,
          user: { codiceUtente: 123, email: 'mario@example.test' },
          grants: { grants: [{ codiceMenu: 'ORDINI', tipoAbilitazione: level }] },
        },
      }), { status: 200 }),
    },
    authorization: {
      requirements: [{ menuCode: 'ORDINI', minPermissionLevel: 20 }],
    },
  });

  const allowedReq = createFakeRequest(signAccessToken(ACCESS_SECRET));
  const allowedRes = createFakeResponse();
  let allowedNext = 0;
  await makeMiddleware(20)(allowedReq, allowedRes, () => { allowedNext += 1; });
  assert.equal(allowedNext, 1);
  assert.equal(allowedReq.userGrants.grants[0].codiceMenu, 'ORDINI');

  const deniedReq = createFakeRequest(signAccessToken(ACCESS_SECRET));
  const deniedRes = createFakeResponse();
  await makeMiddleware(10)(deniedReq, deniedRes, () => {
    throw new Error('next non deve essere chiamato');
  });
  assert.equal(deniedRes.statusCode, 403);
  assert.equal(deniedRes.body.code, 'AUTH_INSUFFICIENT_PERMISSIONS');
});

test('la policy richiede introspection e fallisce chiusa se non configurata', async () => {
  const runtime = createAccessiResourceServer({
    jwt: { serverSecret: RAW_SECRET },
    authorization: { requirements: [{ menuCode: 'ORDINI', minPermissionLevel: 10 }] },
  });
  const req = createFakeRequest(signAccessToken(ACCESS_SECRET));

  await assert.rejects(
    () => authenticateAccessiRequest(req, runtime),
    error => error.status === 500 && error.code === 'AUTH_GRANTS_SOURCE_MISSING',
  );
});

test('guard Nest creato dalla factory autentica e mappa gli errori', async () => {
  const Guard = createAccessiAuthGuard({ jwt: { serverSecret: RAW_SECRET } });
  const guard = new Guard();
  const request = createFakeRequest(signAccessToken(ACCESS_SECRET));
  const context = { switchToHttp: () => ({ getRequest: () => request }) };

  assert.equal(await guard.canActivate(context), true);
  assert.equal(request.user.utente.codiceUtente, 123);

  const invalidGuard = new (createAccessiAuthGuard({ jwt: { serverSecret: RAW_SECRET } }))();
  await assert.rejects(
    () => invalidGuard.canActivate({
      switchToHttp: () => ({ getRequest: () => createFakeRequest('token-non-valido') }),
    }),
    error => error.status === 401,
  );
});

test('endpoint introspection: active true restituisce user e grants, active false non legge i grant', async () => {
  let grantsCalls = 0;
  const activeController = new AccessiIntrospectionController(
    {
      introspectAccessToken: async () => ({
        active: true,
        codiceUtente: 1,
        payload: { utente: { codiceUtente: 1, email: 'admin@example.test' } },
      }),
    },
    {
      getUserRolesAndGrants: async () => {
        grantsCalls += 1;
        return { grants: [{ codiceMenu: 'ORDINI', tipoAbilitazione: 20 }] };
      },
    },
  );

  const activeRes = createFakeResponse();
  await activeController.introspect({ token: 'token' }, activeRes);
  assert.equal(activeRes.statusCode, 200);
  assert.equal(activeRes.body.Result.active, true);
  assert.equal(activeRes.body.Result.user.codiceUtente, 1);
  assert.equal(grantsCalls, 1);

  const inactiveController = new AccessiIntrospectionController(
    { introspectAccessToken: async () => ({ active: false }) },
    {
      getUserRolesAndGrants: async () => {
        throw new Error('non deve essere chiamato per un token inattivo');
      },
    },
  );
  const inactiveRes = createFakeResponse();
  await inactiveController.introspect({ token: 'token' }, inactiveRes);
  assert.equal(inactiveRes.statusCode, 200);
  assert.equal(inactiveRes.body.Result.active, false);
});

test('merge OpenAPI unisce path e schemi e rileva conflitti', () => {
  const target = {
    openapi: '3.0.0',
    info: { title: 'Host', version: '1' },
    paths: { '/host': { get: {} } },
    components: { schemas: { Host: { type: 'object' } } },
  };
  const source = {
    openapi: '3.0.0',
    info: { title: 'Accessi', version: '1' },
    paths: { '/api/accessi/login': { post: {} } },
    components: { schemas: { Login: { type: 'object' } } },
    tags: [{ name: 'Auth' }],
  };

  const merged = mergeOpenApiDocuments(target, source);
  assert.ok(merged.paths['/host']);
  assert.ok(merged.paths['/api/accessi/login']);
  assert.ok(merged.components.schemas.Host);
  assert.ok(merged.components.schemas.Login);

  assert.throws(
    () => mergeOpenApiDocuments(target, { ...source, paths: { '/host': { post: {} } } }),
    /Conflitto OpenAPI/,
  );
  const overwritten = mergeOpenApiDocuments(
    target,
    { ...source, paths: { '/host': { post: {} } } },
    { conflict: 'overwrite' },
  );
  assert.ok(overwritten.paths['/host'].post);
});

test('console URL helper non mette mai il JWT nell URL', () => {
  const url = buildAccessiConsoleUrl('https://accessi.example.test/', {
    entryTicket: 'abc123',
  });
  assert.equal(url, 'https://accessi.example.test/api/accessi/console#entry=abc123');
  assert.equal(url.includes('Bearer'), false);
});

test('il client generato usa base URL e token provider configurabili', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, headers: init.headers });
    return new Response(JSON.stringify({ Result: {} }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  try {
    configureAccessiClient({ baseUrl: 'https://accessi.example.test', token: 'client-token' });
    await login({ email: 'utente@example.test', password: 'password' });

    assert.equal(calls[0].url, 'https://accessi.example.test/api/accessi/auth/login');
    assert.equal(calls[0].headers.get('Authorization'), 'Bearer client-token');
    assert.equal(calls[0].headers.get('Content-Type'), 'application/json');
  } finally {
    globalThis.fetch = originalFetch;
    configureAccessiClient({});
  }
});

test('gli entry point pubblici esportano le API attese', () => {
  const contracts = require('../src/accessi/contracts');
  const resourceServer = require('../src/accessi/resource-server');
  const openapi = require('../src/accessi/openapi');
  const server = require('../src/accessi/server');
  const client = require('../src/accessi/client');
  const consoleEntry = require('../src/accessi/console');
  const ui = require('../src/accessi/ui');

  assert.equal(typeof contracts.accessiRequirement.permission, 'function');
  assert.equal(typeof resourceServer.createAccessiAuthMiddleware, 'function');
  assert.equal(typeof resourceServer.deriveAccessiAccessSecret, 'function');
  assert.equal(typeof openapi.mergeOpenApiDocuments, 'function');
  assert.equal(typeof server.initializeAccessiModule, 'function');
  assert.equal(typeof client.configureAccessiClient, 'function');
  assert.equal(typeof consoleEntry.buildAccessiConsoleUrl, 'function');
  assert.equal(typeof ui.getAccessiUiAssetPath, 'function');
});
