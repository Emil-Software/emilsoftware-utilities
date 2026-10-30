require('ts-node/register/transpile-only');
require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

const {
  applyAccessiAuthCookies,
  clearAccessiAuthCookies,
  createAccessiAuthCookieMiddleware,
  getAccessiRefreshTokenFromCookie,
  parseAccessiCookieHeader,
  resolveAccessiAuthCookieOptions,
  setAccessiAuthCookies,
  validateAccessiOptions,
} = require('../src/accessi-module');
const { AuthController } = require('../src/accessi-module/Controllers/AuthController');

function fakeResponse() {
  return {
    statusCode: 200,
    body: undefined,
    headers: {},
    cookies: [],
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = String(value);
      return this;
    },
    append(name, value) {
      assert.equal(name, 'Set-Cookie');
      this.cookies.push(String(value));
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

function fakeRequest(overrides = {}) {
  return { headers: {}, method: 'GET', path: '/api/accessi/auth/login', ip: '127.0.0.1', ...overrides };
}

function accessToken(seconds = 3600) {
  return jwt.sign({ sub: '1' }, 'test-secret', { expiresIn: seconds, keyid: 'k1' });
}

function cookieValue(cookies, name) {
  const cookie = cookies.find((value) => value.startsWith(`${name}=`));
  assert.ok(cookie, `cookie ${name} atteso`);
  return cookie;
}

function baseOptions(extra = {}) {
  return {
    databaseOptions: {},
    encryptionKey: '0123456789ABCDEF',
    confirmationEmailUrl: 'http://localhost',
    confirmationEmailReturnUrl: 'http://localhost',
    jwtOptions: {
      secret: 'z'.repeat(40),
      expiresIn: '1h',
      refreshExpiresIn: '30d',
      algorithm: 'HS256',
    },
    ...extra,
  };
}

test('#15: configurazione cookie opt-in e validazione', () => {
  assert.equal(resolveAccessiAuthCookieOptions({}), undefined);
  assert.equal(resolveAccessiAuthCookieOptions({ authCookie: { enabled: false } }), undefined);

  const defaults = resolveAccessiAuthCookieOptions({ authCookie: {} });
  assert.equal(defaults.secure, true);
  assert.equal(defaults.sameSite, 'lax');
  assert.equal(defaults.accessTokenName, 'accessi_access');
  assert.equal(defaults.refreshTokenName, 'accessi_refresh');
  assert.equal(defaults.csrf, 'double-submit');

  const custom = resolveAccessiAuthCookieOptions({
    authCookie: {
      sameSite: 'none',
      csrfHeaderName: 'X-XSRF-Token',
      exposeTokens: true,
      secure: false,
    },
  });
  assert.equal(custom.csrfHeaderName, 'x-xsrf-token');
  assert.equal(custom.exposeTokens, true);

  const invalid = validateAccessiOptions(baseOptions({
    authCookie: { sameSite: 'none', secure: false },
  }));
  assert.ok(invalid.errors.some((issue) => issue.code === 'ACCESSI_AUTH_COOKIE_SAMESITE_NONE_INSECURE'));

  const duplicate = validateAccessiOptions(baseOptions({
    authCookie: { accessTokenName: 'same', refreshTokenName: 'same' },
  }));
  assert.ok(duplicate.errors.some((issue) => issue.code === 'ACCESSI_AUTH_COOKIE_NAME_DUPLICATE'));

  const invalidName = validateAccessiOptions(baseOptions({
    authCookie: { accessTokenName: 'bad name' },
  }));
  assert.ok(invalidName.errors.some((issue) => issue.code === 'ACCESSI_AUTH_COOKIE_NAME_INVALID'));

  const warnings = validateAccessiOptions(baseOptions({
    authCookie: { csrf: 'off', exposeTokens: true },
  }));
  const codes = warnings.warnings.map((issue) => issue.code);
  assert.ok(codes.includes('ACCESSI_AUTH_COOKIE_CSRF_DISABLED'));
  assert.ok(codes.includes('ACCESSI_AUTH_COOKIE_TOKENS_EXPOSED'));
});

test('#15: parsing cookie e attributi Set-Cookie', () => {
  assert.deepEqual(parseAccessiCookieHeader('a=1; b=two%20words; empty='), {
    a: '1',
    b: 'two words',
    empty: '',
  });
  assert.deepEqual(parseAccessiCookieHeader(undefined), {});

  const config = resolveAccessiAuthCookieOptions({
    authCookie: { secure: true, sameSite: 'lax', refreshPath: '/api/accessi/auth' },
  });
  const res = fakeResponse();
  const access = accessToken(60);
  const refresh = jwt.sign({ sub: '1', typ: 'refresh' }, 'test-secret', { expiresIn: 3600 });
  setAccessiAuthCookies(res, config, { access, refresh });

  const accessCookie = cookieValue(res.cookies, 'accessi_access');
  assert.match(accessCookie, /HttpOnly/);
  assert.match(accessCookie, /Secure/);
  assert.match(accessCookie, /Path=\/api\/accessi/);
  assert.match(accessCookie, /SameSite=Lax/);
  assert.match(accessCookie, /Max-Age=5[0-9]/);

  const refreshCookie = cookieValue(res.cookies, 'accessi_refresh');
  assert.match(refreshCookie, /Path=\/api\/accessi\/auth/);
  assert.match(refreshCookie, /Max-Age=3[0-9]{3}/);

  assert.equal(getAccessiRefreshTokenFromCookie(`accessi_refresh=${refresh}`, config), refresh);

  const cleared = fakeResponse();
  clearAccessiAuthCookies(cleared, config);
  assert.equal(cleared.cookies.length, 3);
  for (const cookie of cleared.cookies) assert.match(cookie, /Max-Age=0/);
});

test('#15: i token restano nel body solo con exposeTokens', () => {
  const hidden = fakeResponse();
  const config = resolveAccessiAuthCookieOptions({ authCookie: {} });
  const hiddenResult = applyAccessiAuthCookies(hidden, config, {
    token: { value: accessToken(), type: 'Bearer' },
    refreshToken: { value: 'refresh', type: 'Bearer' },
  });
  assert.deepEqual(hiddenResult, {});
  assert.equal(hidden.cookies.length, 2);

  const exposed = fakeResponse();
  const exposedConfig = resolveAccessiAuthCookieOptions({ authCookie: { exposeTokens: true } });
  const exposedResult = applyAccessiAuthCookies(exposed, exposedConfig, {
    token: { value: 'access', type: 'Bearer' },
  });
  assert.equal(exposedResult.token.value, 'access');
  assert.equal(exposedConfig.exposeTokens, true);
});

test('#15: middleware inietta il cookie e impone il CSRF double-submit', () => {
  const middleware = createAccessiAuthCookieMiddleware(
    { authCookie: { secure: false } },
    () => true,
  );
  assert.ok(middleware);
  assert.equal(createAccessiAuthCookieMiddleware({}, () => true), undefined);

  const token = accessToken();
  let next = 0;
  const getResponse = fakeResponse();
  middleware(fakeRequest({ headers: { cookie: `accessi_access=${token}` } }), getResponse, () => { next += 1; });
  assert.equal(next, 1);
  assert.equal(getResponse.cookies.length, 1);
  assert.match(getResponse.cookies[0], /accessi_csrf=/);
  assert.doesNotMatch(getResponse.cookies[0], /HttpOnly/);
  assert.match(getResponse.headers['x-csrf-token'], /^[A-Za-z0-9_-]+$/);

  const csrf = /accessi_csrf=([^;]+)/.exec(getResponse.cookies[0])[1];

  const postRequest = fakeRequest({
    method: 'POST',
    path: '/api/accessi/user/set-stato',
    headers: {
      cookie: `accessi_access=${token}; accessi_csrf=${csrf}`,
      'x-csrf-token': csrf,
    },
  });
  const postResponse = fakeResponse();
  next = 0;
  middleware(postRequest, postResponse, () => { next += 1; });
  assert.equal(next, 1);
  assert.equal(postRequest.headers.authorization, `Bearer ${token}`);

  const blocked = fakeResponse();
  next = 0;
  middleware(fakeRequest({
    method: 'POST',
    path: '/api/accessi/user/set-stato',
    headers: { cookie: `accessi_access=${token}; accessi_csrf=${csrf}` },
  }), blocked, () => { next += 1; });
  assert.equal(next, 0);
  assert.equal(blocked.statusCode, 403);
  assert.equal(blocked.body.code, 'AUTH_CSRF_INVALID');

  const exempt = fakeResponse();
  next = 0;
  middleware(fakeRequest({
    method: 'POST',
    path: '/api/accessi/auth/login',
    headers: { cookie: `accessi_access=${token}; accessi_csrf=${csrf}` },
  }), exempt, () => { next += 1; });
  assert.equal(next, 1);

  const bearer = fakeRequest({
    method: 'POST',
    path: '/api/accessi/user/set-stato',
    headers: { cookie: `accessi_access=${token}; accessi_csrf=${csrf}`, authorization: 'Bearer esplicito' },
  });
  next = 0;
  middleware(bearer, fakeResponse(), () => { next += 1; });
  assert.equal(next, 1);
  assert.equal(bearer.headers.authorization, 'Bearer esplicito');

  const csrfOff = createAccessiAuthCookieMiddleware(
    { authCookie: { secure: false, csrf: 'off' } },
    () => true,
  );
  next = 0;
  csrfOff(fakeRequest({
    method: 'POST',
    path: '/api/accessi/user/set-stato',
    headers: { cookie: `accessi_access=${token}` },
  }), fakeResponse(), () => { next += 1; });
  assert.equal(next, 1);
});

function fakeAuthService(tokens) {
  return {
    async login() {
      return { utente: { codiceUtente: 7, email: 'user@example.test' } };
    },
    createTokenPair() {
      return tokens;
    },
    async verifyTwoFactor() {
      return { utente: { codiceUtente: 7 }, ...tokens };
    },
    async refreshAccessToken() {
      return { token: tokens.access, refreshToken: tokens.refresh };
    },
    async getAuthenticatedTokenPayload(token) {
      assert.equal(token, 'valid-token');
      return { utente: { codiceUtente: 7, email: 'user@example.test' } };
    },
  };
}

test('#15: login e refresh impostano i cookie e non espongono i token', async () => {
  const tokens = {
    access: { value: accessToken(), type: 'Bearer', expiresIn: '3600' },
    refresh: { value: jwt.sign({ typ: 'refresh' }, 'test-secret', { expiresIn: 3600 }), type: 'Bearer', expiresIn: '3600' },
  };
  const controller = new AuthController(
    fakeAuthService(tokens),
    {},
    baseOptions({ authCookie: { secure: false } }),
  );

  const loginResponse = fakeResponse();
  await controller.login(fakeRequest(), { email: 'user@example.test', password: 'secret' }, loginResponse);
  assert.equal(loginResponse.statusCode, 200);
  assert.equal(loginResponse.body.Result.token, undefined);
  assert.equal(loginResponse.body.Result.refreshToken, undefined);
  assert.equal(loginResponse.cookies.length, 2);

  const refreshResponse = fakeResponse();
  await controller.refresh(
    fakeRequest({ path: '/api/accessi/auth/refresh', headers: { cookie: `accessi_refresh=${tokens.refresh.value}` } }),
    {},
    refreshResponse,
  );
  assert.equal(refreshResponse.statusCode, 200);
  assert.equal(refreshResponse.body.Result.token, undefined);
  assert.equal(refreshResponse.body.Result.refreshToken, undefined);
  assert.equal(refreshResponse.cookies.length, 2);
});

test('#15: senza authCookie il login resta Bearer e invariato', async () => {
  const tokens = { access: { value: 'access-value', type: 'Bearer', expiresIn: '3600' } };
  const controller = new AuthController(fakeAuthService(tokens), {}, baseOptions());
  const res = fakeResponse();
  await controller.login(fakeRequest(), { email: 'user@example.test', password: 'secret' }, res);
  assert.equal(res.body.Result.token.value, 'access-value');
  assert.equal(res.cookies.length, 0);
});

test('#15: getUserByToken accetta il token dal cookie o dall header', async () => {
  const controller = new AuthController(fakeAuthService({}), {}, baseOptions({ authCookie: {} }));
  const res = fakeResponse();
  await controller.getUserByToken(
    fakeRequest({ headers: { authorization: 'Bearer valid-token' } }),
    {},
    res,
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.Result.userData.codiceUtente, 7);
});
