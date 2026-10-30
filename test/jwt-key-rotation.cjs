require('ts-node/register/transpile-only');
require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const jwt = require('jsonwebtoken');
const { createHash, createPublicKey, generateKeyPairSync } = require('node:crypto');
const { execFile, execFileSync } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  buildAccessiJwks,
  getAccessiAccessTokenVerificationConfig,
  getAccessiRefreshTokenVerificationConfig,
  resolveAccessiVerificationKeys,
  validateAccessiOptions,
  verifyAccessiJwt,
} = require('../src/accessi-module');
const {
  parseAccessiPreviousPublicKeys,
} = require('../src/accessi-module/database-updates/accessiOptionsFromEnv');
const {
  getAccessiJwtSecret,
} = require('../src/accessi-module/security/passwordResetToken');
const {
  createAccessiTokenVerifier,
} = require('../src/accessi/resource-server');

const ROTATE_SCRIPT = path.join(__dirname, '..', 'scripts', 'rotate-accessi-jwt-keys.cjs');
const execFileAsync = promisify(execFile);

function keyPair() {
  return generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
}

function keyIdOf(publicKey) {
  const der = createPublicKey(publicKey).export({ type: 'spki', format: 'der' });
  return createHash('sha256').update(der).digest('base64url').slice(0, 16);
}

function jwkOf(publicKey, kid, algorithm = 'RS256') {
  return {
    ...createPublicKey(publicKey).export({ format: 'jwk' }),
    kid,
    alg: algorithm,
    use: 'sig',
  };
}

function signAccess(privateKey, keyId, overrides = {}) {
  return jwt.sign(
    { typ: 'access', utente: { codiceUtente: 7 }, ...overrides },
    privateKey,
    { algorithm: 'RS256', expiresIn: '1h', ...(keyId ? { keyid: keyId } : {}) },
  );
}

function signRefresh(privateKey, keyId) {
  return jwt.sign(
    { typ: 'refresh', utente: { codiceUtente: 7 }, jti: 'token-1', fid: 'family-1' },
    privateKey,
    { algorithm: 'RS256', expiresIn: '1d', ...(keyId ? { keyid: keyId } : {}) },
  );
}

function baseOptions(overrides = {}) {
  return {
    databaseOptions: {},
    encryptionKey: '0123456789ABCDEF',
    confirmationEmailUrl: 'http://localhost',
    confirmationEmailReturnUrl: 'http://localhost',
    ...overrides,
  };
}

function jwksResponse(keys) {
  return new Response(JSON.stringify({ keys }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('#18: parsing di ACCESSI_JWT_PREVIOUS_PUBLIC_KEYS', () => {
  const { publicKey } = keyPair();
  const escaped = publicKey.replace(/\n/g, '\\n');

  assert.equal(parseAccessiPreviousPublicKeys(undefined), undefined);
  assert.equal(parseAccessiPreviousPublicKeys('  '), undefined);

  const parsed = parseAccessiPreviousPublicKeys(JSON.stringify([
    escaped,
    { publicKey: escaped, keyId: '2025-01', algorithm: 'rs256' },
  ]));
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].keyId, undefined);
  assert.match(parsed[0].publicKey, /^-----BEGIN PUBLIC KEY-----/);
  assert.ok(parsed[0].publicKey.includes('\n'));
  assert.deepEqual(parsed[1], { publicKey, keyId: '2025-01', algorithm: 'RS256' });

  assert.throws(
    () => parseAccessiPreviousPublicKeys('{not-json'),
    /ACCESSI_JWT_PREVIOUS_PUBLIC_KEYS: JSON non valido/,
  );
  assert.throws(
    () => parseAccessiPreviousPublicKeys('{"publicKey":"x"}'),
    /atteso un array JSON/,
  );
  assert.throws(
    () => parseAccessiPreviousPublicKeys('[{"keyId":"x"}]'),
    /publicKey deve essere una stringa PEM non vuota/,
  );
  assert.throws(
    () => parseAccessiPreviousPublicKeys('[{"publicKey":"x","keyId":""}]'),
    /keyId, se presente/,
  );
  assert.throws(
    () => parseAccessiPreviousPublicKeys('[{"publicKey":"x","algorithm":"none"}]'),
    /algoritmo NONE non supportato/,
  );
});

test('#18: la JWKS include la chiave corrente e le precedenti, senza duplicati', () => {
  const current = keyPair();
  const previous = keyPair();
  const options = baseOptions({
    jwtOptions: {
      secret: 'x'.repeat(40),
      expiresIn: '1h',
      algorithm: 'RS256',
      privateKey: current.privateKey,
      publicKey: current.publicKey,
      keyId: 'current',
      previousPublicKeys: [
        { publicKey: previous.publicKey, keyId: 'previous' },
        { publicKey: current.publicKey, keyId: 'current' },
      ],
    },
  });

  const document = buildAccessiJwks(options);
  assert.deepEqual(document.keys.map((key) => key.kid), ['current', 'previous']);
});

test('#18: verifica lato Accessi con chiave corrente, precedente e token legacy senza kid', () => {
  const current = keyPair();
  const previous = keyPair();
  const events = [];
  const options = baseOptions({
    jwtOptions: {
      secret: 'x'.repeat(40),
      expiresIn: '1h',
      refreshExpiresIn: '30d',
      algorithm: 'RS256',
      privateKey: current.privateKey,
      publicKey: current.publicKey,
      keyId: 'current',
      previousPublicKeys: [{ publicKey: previous.publicKey, keyId: 'previous' }],
      onUnknownKeyId: (event) => events.push(event),
    },
  });

  const config = getAccessiAccessTokenVerificationConfig(options);
  assert.equal(verifyAccessiJwt(signAccess(current.privateKey, 'current'), config).utente.codiceUtente, 7);
  assert.equal(verifyAccessiJwt(signAccess(previous.privateKey, 'previous'), config).utente.codiceUtente, 7);
  // Token emesso prima che il keyId fosse configurato: nessun kid nell'header.
  assert.equal(verifyAccessiJwt(signAccess(previous.privateKey), config).utente.codiceUtente, 7);

  const ghost = signAccess(previous.privateKey, 'ghost');
  assert.throws(() => verifyAccessiJwt(ghost, config), /Chiave JWT sconosciuta per kid "ghost"/);
  assert.deepEqual(events, [{ keyId: 'ghost', algorithm: 'RS256', purpose: 'access' }]);
  assert.deepEqual(resolveAccessiVerificationKeys(config, ghost), []);

  events.length = 0;
  const refreshConfig = getAccessiRefreshTokenVerificationConfig(options);
  assert.throws(() => verifyAccessiJwt(signRefresh(previous.privateKey, 'ghost'), refreshConfig));
  assert.deepEqual(events, [{ keyId: 'ghost', algorithm: 'RS256', purpose: 'refresh' }]);
});

test('#18: con HS256 il kid non invalida token firmati con lo stesso segreto', () => {
  const events = [];
  const options = baseOptions({
    jwtOptions: {
      secret: 'y'.repeat(40),
      expiresIn: '1h',
      keyId: 'nuovo-kid',
      onUnknownKeyId: (event) => events.push(event),
    },
  });
  const config = getAccessiAccessTokenVerificationConfig(options);
  const token = jwt.sign(
    { typ: 'access', utente: { codiceUtente: 7 } },
    getAccessiJwtSecret(options),
    { algorithm: 'HS256', expiresIn: '1h', keyid: 'kid-storico' },
  );
  assert.equal(verifyAccessiJwt(token, config).utente.codiceUtente, 7);
  assert.deepEqual(events, []);
});

test('#18: validateAccessiOptions segnala chiavi precedenti invalide e kid duplicati', () => {
  const current = keyPair();
  const options = baseOptions({
    jwtOptions: {
      secret: 'x'.repeat(40),
      expiresIn: '1h',
      algorithm: 'RS256',
      privateKey: current.privateKey,
      publicKey: current.publicKey,
      keyId: 'current',
      previousPublicKeys: [
        { publicKey: current.publicKey, keyId: 'current' },
        { publicKey: 'not-a-pem', keyId: 'broken' },
      ],
    },
  });

  const result = validateAccessiOptions(options);
  const codes = [...result.errors, ...result.warnings].map((issue) => issue.code);
  assert.ok(codes.includes('ACCESSI_JWT_PREVIOUS_KEY_INVALID'));
  assert.ok(codes.includes('ACCESSI_JWT_PREVIOUS_KEY_DUPLICATE_KID'));

  const hmac = validateAccessiOptions(baseOptions({
    jwtOptions: {
      secret: 'x'.repeat(40),
      expiresIn: '1h',
      previousPublicKeys: [{ publicKey: current.publicKey }],
    },
  }));
  assert.ok(hmac.warnings.some((issue) => issue.code === 'ACCESSI_JWT_PREVIOUS_KEYS_WITH_HMAC'));
});

test('#18: il resource server aggiorna la JWKS quando arriva un kid nuovo', async () => {
  const previous = keyPair();
  const current = keyPair();
  const oldJwk = jwkOf(previous.publicKey, 'previous');
  const newJwk = jwkOf(current.publicKey, 'current');
  let served = [oldJwk];
  let calls = 0;
  const events = [];

  const verifier = createAccessiTokenVerifier({
    jwks: {
      url: 'https://accessi.example.test/jwks.json',
      minRefreshIntervalMs: 0,
      fetch: async () => {
        calls += 1;
        return jwksResponse(served);
      },
    },
    algorithms: ['RS256'],
    onUnknownKeyId: (event) => events.push(event),
  });

  assert.equal((await verifier.verify(signAccess(previous.privateKey, 'previous'))).codiceUtente, 7);
  assert.equal(calls, 1);

  served = [oldJwk, newJwk];
  assert.equal((await verifier.verify(signAccess(current.privateKey, 'current'))).codiceUtente, 7);
  assert.equal(calls, 2);
  assert.deepEqual(events, []);
});

test('#18: il resource server limita i refresh e segnala il kid assente', async () => {
  const previous = keyPair();
  const unknown = keyPair();
  let calls = 0;
  const events = [];
  const verifier = createAccessiTokenVerifier({
    jwks: {
      url: 'https://accessi.example.test/jwks.json',
      minRefreshIntervalMs: 60_000,
      fetch: async () => {
        calls += 1;
        return jwksResponse([jwkOf(previous.publicKey, 'previous')]);
      },
    },
    algorithms: ['RS256'],
    onUnknownKeyId: (event) => events.push(event),
  });

  await verifier.verify(signAccess(previous.privateKey, 'previous'));
  assert.equal(calls, 1);

  await assert.rejects(
    () => verifier.verify(signAccess(unknown.privateKey, 'ghost')),
    (error) => error.status === 401 && /kid "ghost"/.test(error.message),
  );
  // Refresh bloccato dal throttle: nessuna seconda chiamata alla JWKS.
  assert.equal(calls, 1);
  assert.deepEqual(events, [{ kid: 'ghost', algorithm: 'RS256', source: 'jwks' }]);
});

test('#18: alert anche con chiave pubblica statica e kid non corrispondente', async () => {
  const current = keyPair();
  const other = keyPair();
  const events = [];
  const verifier = createAccessiTokenVerifier({
    publicKey: current.publicKey,
    algorithms: ['RS256'],
    onUnknownKeyId: (event) => events.push(event),
  });

  const expectedKid = keyIdOf(current.publicKey);
  assert.equal((await verifier.verify(signAccess(current.privateKey, expectedKid))).codiceUtente, 7);
  assert.deepEqual(events, []);

  await assert.rejects(() => verifier.verify(signAccess(other.privateKey, 'old-key')));
  assert.deepEqual(events, [{ kid: 'old-key', algorithm: 'RS256', source: 'publicKey' }]);
});

test('#18: lo script di rotazione produce JWKS e env coerenti e verifica il rollout', { timeout: 60000 }, async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'accessi-rotate-'));
  const oldDirectory = path.join(directory, 'old');
  fs.mkdirSync(oldDirectory);
  const old = keyPair();
  const oldPublicFile = path.join(oldDirectory, 'jwt-public.pem');
  fs.writeFileSync(oldPublicFile, `${old.publicKey}\n`);
  const out = path.join(directory, 'new');

  const run = (...extra) => execFileSync(process.execPath, [ROTATE_SCRIPT, ...extra], {
    encoding: 'utf8',
    env: { ...process.env, ACCESSI_JWT_PREVIOUS_PUBLIC_KEYS: '' },
  });

  try {
    run(
      '--out', out,
      '--algorithm', 'RS256',
      '--current-public-key-file', oldPublicFile,
      '--current-key-id', 'old',
      '--retain', '2',
    );

    const rotation = JSON.parse(fs.readFileSync(path.join(out, 'rotation.json'), 'utf8'));
    const document = JSON.parse(fs.readFileSync(path.join(out, 'jwks.json'), 'utf8'));
    assert.equal(rotation.algorithm, 'RS256');
    assert.notEqual(rotation.keyId, 'old');
    assert.deepEqual(rotation.previousKeyIds, ['old']);
    assert.equal(document.keys.length, 2);
    assert.deepEqual(document.keys.map((key) => key.kid), [rotation.keyId, 'old']);
    assert.equal(rotation.env.ACCESSI_JWT_KEY_ID, rotation.keyId);

    const previous = JSON.parse(rotation.env.ACCESSI_JWT_PREVIOUS_PUBLIC_KEYS);
    assert.equal(previous.length, 1);
    assert.equal(previous[0].keyId, 'old');

    // Un secondo giro usa il valore env del primo: la vecchia corrente entra nelle precedenti.
    const second = path.join(directory, 'second');
    run(
      '--out', second,
      '--current-public-key', rotation.publicKey,
      '--current-key-id', rotation.keyId,
      '--previous', rotation.env.ACCESSI_JWT_PREVIOUS_PUBLIC_KEYS,
      '--retain', '1',
    );
    const secondRotation = JSON.parse(fs.readFileSync(path.join(second, 'rotation.json'), 'utf8'));
    assert.deepEqual(secondRotation.previousKeyIds, [rotation.keyId]);

    // Verifica della JWKS remota: il documento generato deve essere pubblicato.
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(fs.readFileSync(path.join(second, 'jwks.json')));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    try {
      const { stdout: output } = await execFileAsync(
        process.execPath,
        [ROTATE_SCRIPT, '--out', second, '--only-check', '--check', `http://127.0.0.1:${port}/jwks.json`],
        { encoding: 'utf8', env: { ...process.env, ACCESSI_JWT_PREVIOUS_PUBLIC_KEYS: '' } },
      );
      assert.match(output, /JWKS OK: 2 kid presenti/);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
