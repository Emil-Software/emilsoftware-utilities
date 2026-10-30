require('ts-node/register/transpile-only');
require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  applyAccessiContentSecurityPolicy,
  buildAccessiContentSecurityPolicy,
  createAccessiSecurityHeadersMiddleware,
  resolveAccessiSecurityHeaders,
} = require('../src/accessi-module');
const { AccessiConsoleController } = require('../src/accessi-module/Controllers/AccessiConsoleController');

function resolved(setting) {
  const value = resolveAccessiSecurityHeaders(setting);
  assert.ok(value, 'configurazione attesa come abilitata');
  return value;
}

function policyOf(setting, surface, options) {
  return buildAccessiContentSecurityPolicy(resolved(setting), surface, options);
}

function fakeResponse() {
  return {
    headers: {},
    body: undefined,
    statusCode: 200,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = String(value);
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(body) {
      this.body = body;
      return this;
    },
  };
}

test('#14: i default mantengono header storici e aggiungono la CSP', () => {
  const config = resolved(undefined);
  assert.equal(config.frameOptions, 'SAMEORIGIN');
  assert.equal(config.referrerPolicy, 'no-referrer');
  assert.match(config.permissionsPolicy, /camera=\(\)/);
  assert.equal(config.cacheControl, 'no-store, max-age=0');
  assert.ok(config.contentSecurityPolicy);

  assert.equal(resolveAccessiSecurityHeaders(false), undefined);
  assert.equal(resolveAccessiSecurityHeaders({ enabled: false }), undefined);
  assert.equal(resolveAccessiSecurityHeaders({ contentSecurityPolicy: false }).contentSecurityPolicy, false);

  const off = resolved({
    frameOptions: false,
    referrerPolicy: false,
    permissionsPolicy: false,
    cacheControl: false,
  });
  assert.equal(off.frameOptions, '');
  assert.equal(off.referrerPolicy, '');
  assert.equal(off.permissionsPolicy, '');
  assert.equal(off.cacheControl, '');
});

test('#14: la CSP della console usa il nonce e mai unsafe-inline', () => {
  const policy = policyOf({}, 'console', { nonce: 'abc123' });
  assert.match(policy, /script-src 'self' 'nonce-abc123'/);
  assert.doesNotMatch(policy, /unsafe-inline/);
  assert.match(policy, /default-src 'self'/);
  assert.match(policy, /object-src 'none'/);
  assert.match(policy, /frame-ancestors 'self'/);

  const withoutNonce = policyOf({}, 'console');
  assert.doesNotMatch(withoutNonce, /nonce-/);
});

test('#14: la CSP OpenAPI isola unsafe-inline solo dove serve', () => {
  const openapi = policyOf({}, 'openapi');
  assert.match(openapi, /script-src 'self' 'unsafe-inline'/);
  assert.match(openapi, /style-src 'self' 'unsafe-inline'/);

  const hardened = policyOf({ contentSecurityPolicy: { swaggerUnsafeInline: false } }, 'openapi');
  assert.doesNotMatch(hardened, /unsafe-inline/);

  const api = policyOf({}, 'api');
  assert.doesNotMatch(api, /unsafe-inline/);
});

test('#14: direttive, connect-src, report-uri e frame personalizzabili', () => {
  const policy = policyOf({
    frameOptions: 'DENY',
    contentSecurityPolicy: {
      connectSrc: ['https://api.example.test'],
      reportUri: 'https://csp.example.test/report',
      directives: {
        'img-src': ["'self'", 'data:', 'https:'],
        'font-src': false,
      },
    },
  }, 'console', { nonce: 'n1', connectSrc: ['https://cdn.example.test'] });

  assert.match(policy, /frame-ancestors 'none'/);
  assert.match(policy, /img-src 'self' data: https:/);
  assert.doesNotMatch(policy, /font-src/);
  assert.match(policy, /connect-src 'self' https:\/\/api\.example\.test https:\/\/cdn\.example\.test/);
  assert.match(policy, /report-uri https:\/\/csp\.example\.test\/report/);

  const noFrame = policyOf({ frameOptions: false }, 'api');
  assert.doesNotMatch(noFrame, /frame-ancestors/);
});

test('#14: header Report-Only configurabile', () => {
  const config = resolved({ contentSecurityPolicy: { reportOnly: true } });
  const res = fakeResponse();
  applyAccessiContentSecurityPolicy(res, config, 'console', { nonce: 'r1' });
  assert.equal(res.headers['content-security-policy'], undefined);
  assert.match(res.headers['content-security-policy-report-only'], /nonce-r1/);
});

test('#14: il middleware applica gli header solo alle rotte Accessi', () => {
  const middleware = createAccessiSecurityHeadersMiddleware(
    {},
    (path) => path.startsWith('/api/accessi') || path === '/accessi/openapi',
    { isOpenApiUi: (path) => path === '/accessi/openapi' },
  );
  assert.ok(middleware);

  const outside = fakeResponse();
  let nextCalls = 0;
  middleware({ path: '/api/altro' }, outside, () => { nextCalls += 1; });
  assert.equal(nextCalls, 1);
  assert.deepEqual(outside.headers, {});

  const api = fakeResponse();
  middleware({ path: '/api/accessi/auth/login' }, api, () => { nextCalls += 1; });
  assert.equal(api.headers['x-content-type-options'], 'nosniff');
  assert.equal(api.headers['x-frame-options'], 'SAMEORIGIN');
  assert.equal(api.headers['referrer-policy'], 'no-referrer');
  assert.doesNotMatch(api.headers['content-security-policy'], /unsafe-inline/);

  const consoleRes = fakeResponse();
  middleware({ path: '/api/accessi/console' }, consoleRes, () => {});
  assert.match(consoleRes.headers['content-security-policy'], /frame-ancestors 'self'/);

  const openapi = fakeResponse();
  middleware({ path: '/accessi/openapi' }, openapi, () => {});
  assert.match(openapi.headers['content-security-policy'], /unsafe-inline/);

  assert.equal(createAccessiSecurityHeadersMiddleware(false, () => true), undefined);
});

test('#14: la shell console riceve un nonce per richiesta coerente con la CSP', () => {
  const controller = new AccessiConsoleController({
    databaseOptions: {},
    consoleApiBaseUrl: 'https://api.example.test/',
    http: { securityHeaders: {} },
  });

  const res = fakeResponse();
  controller.index(res);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.headers['content-security-policy'], /connect-src 'self' https:\/\/api\.example\.test/);

  const nonce = /nonce-([^']+)'/.exec(res.headers['content-security-policy'])[1];
  assert.ok(res.body.includes(`nonce="${nonce}"`));
  assert.equal(res.body.split(`nonce="${nonce}"`).length - 1, 2);
  assert.doesNotMatch(res.body, /__ACCESSI_CSP_NONCE__/);
  assert.ok(res.body.includes('window.__ACCESSI_API_BASE_URL__="https://api.example.test";'));
  // Nessuno script inline oltre ai due firmati dal nonce.
  assert.equal((res.body.match(/<script/g) || []).length, 3);
  assert.equal((res.body.match(/<script type="module"/g) || []).length, 1);

  const second = fakeResponse();
  controller.index(second);
  assert.notEqual(second.headers['content-security-policy'], res.headers['content-security-policy']);
});

test('#14: console con securityHeaders false mantiene solo i default storici', () => {
  const controller = new AccessiConsoleController({
    databaseOptions: {},
    http: { securityHeaders: false },
  });
  const res = fakeResponse();
  controller.index(res);
  assert.equal(res.headers['content-security-policy'], undefined);
  assert.equal(res.headers['cache-control'], 'no-store, max-age=0');
  assert.equal(res.headers['referrer-policy'], 'no-referrer');
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.doesNotMatch(res.body, /__ACCESSI_CSP_NONCE__/);
});

test('#14: cacheControl e Report-Only arrivano alla shell console', () => {
  const controller = new AccessiConsoleController({
    databaseOptions: {},
    http: {
      securityHeaders: {
        cacheControl: 'private, max-age=0',
        contentSecurityPolicy: { reportOnly: true },
      },
    },
  });
  const res = fakeResponse();
  controller.index(res);
  assert.equal(res.headers['cache-control'], 'private, max-age=0');
  assert.equal(res.headers['content-security-policy'], undefined);
  assert.match(res.headers['content-security-policy-report-only'], /nonce-/);
});
