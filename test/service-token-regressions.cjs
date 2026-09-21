require('ts-node/register/transpile-only');
require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Orm } = require('../src/Orm');
const {
  generateServiceToken,
  parseServiceToken,
  hashServiceTokenSecret,
  normalizeServiceTokenScopes,
  serviceTokenHasScope,
  ServiceTokenService,
} = require('../src/accessi-module/Services/ServiceTokenService/ServiceTokenService');

const buildService = (overrides = {}) => new ServiceTokenService({ databaseOptions: {}, ...overrides });

test('generateServiceToken produce un formato stabile e parseServiceToken lo riconosce', () => {
  const { token, tokenId, secret } = generateServiceToken();
  assert.match(tokenId, /^st_[a-f0-9]{32}$/);
  assert.equal(token, `${tokenId}.${secret}`);
  assert.deepEqual(parseServiceToken(token), { tokenId, secret });
});

test('parseServiceToken rifiuta formati non validi', () => {
  assert.equal(parseServiceToken(''), null);
  assert.equal(parseServiceToken('niente-punto'), null);
  assert.equal(parseServiceToken('st_zzz.segreto'), null);
  assert.equal(parseServiceToken(`st_${'a'.repeat(32)}.`), null);
  assert.equal(parseServiceToken(undefined), null);
});

test('hashServiceTokenSecret e deterministico', () => {
  assert.equal(hashServiceTokenSecret('abc'), hashServiceTokenSecret('abc'));
  assert.notEqual(hashServiceTokenSecret('abc'), hashServiceTokenSecret('abd'));
});

test('normalizeServiceTokenScopes valida, normalizza e deduplica', () => {
  assert.deepEqual(normalizeServiceTokenScopes(undefined), []);
  assert.deepEqual(normalizeServiceTokenScopes([' IA ', 'chat', 'ia']), ['ia', 'chat']);
  assert.throws(() => normalizeServiceTokenScopes(['bad scope']));
  assert.throws(() => normalizeServiceTokenScopes([123]));
});

test('serviceTokenHasScope distingue scope assente, presente e mancante', () => {
  assert.equal(serviceTokenHasScope(['ia', 'chat'], undefined), true);
  assert.equal(serviceTokenHasScope(['ia', 'chat'], 'ia'), true);
  assert.equal(serviceTokenHasScope(['ia'], 'chat'), false);
});

test('issue + verify + revoke usano hash e controlli di stato', async (t) => {
  let inserted;
  const rows = new Map();

  t.mock.method(Orm, 'execute', async (_options, sql, params) => {
    if (sql.includes('INSERT INTO ACCESSI_SERVICE_TOKEN')) {
      inserted = params;
      rows.set(params[0], {
        TOKEN_ID: params[0],
        TOKEN_HASH: params[1],
        LABEL: params[2],
        SCOPES: params[3],
        CREATED_AT: new Date('2026-01-01T00:00:00Z'),
        REVOKED_AT: null,
      });
    }
    if (sql.includes('SET REVOKED_AT = CURRENT_TIMESTAMP')) {
      const row = rows.get(params[0]);
      if (row) row.REVOKED_AT = new Date();
    }
    return [];
  });
  t.mock.method(Orm, 'query', async (_options, sql, params) => {
    if (sql.includes('FROM ACCESSI_SERVICE_TOKEN WHERE TOKEN_ID')) {
      const row = rows.get(params[0]);
      return row ? [row] : [];
    }
    return [];
  });

  const service = buildService();
  const issued = await service.issue({ label: 'Integrazione IA', scopes: ['IA', 'chat'] });
  assert.ok(issued.token.startsWith('st_'));
  assert.deepEqual(issued.scopes, ['ia', 'chat']);
  assert.equal(inserted[1], hashServiceTokenSecret(parseServiceToken(issued.token).secret));

  const verified = await service.verify(issued.token);
  assert.deepEqual(verified, { tokenId: issued.tokenId, label: 'Integrazione IA', scopes: ['ia', 'chat'] });

  // Segreto errato (stesso id, altro segreto) rifiutato.
  assert.equal(await service.verify(`${issued.tokenId}.${'x'.repeat(43)}`), undefined);

  await service.revoke(issued.tokenId);
  assert.equal(await service.verify(issued.token), undefined);
});

test('issue rifiuta scadenze passate e label vuote', async () => {
  const service = buildService();
  await assert.rejects(() => service.issue({ label: '' }));
  await assert.rejects(() => service.issue({ label: 'x', expiresAt: '2000-01-01T00:00:00Z' }));
});

test('ServiceTokenGuard verifica, allega il token e applica gli scope', async () => {
  const { ServiceTokenGuard } = require('../src/accessi-module/security/serviceTokenGuard');
  const verified = { tokenId: `st_${'a'.repeat(32)}`, label: 'ia', scopes: ['ia'] };
  const request = { headers: { authorization: `Bearer ${verified.tokenId}.segreto-lungo-abbastanza` } };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => (() => {}),
    getClass: () => class {},
  };

  const guard = new ServiceTokenGuard({ verify: async () => verified }, { getAllAndOverride: () => [] });
  assert.equal(await guard.canActivate(context), true);
  assert.deepEqual(request.accessiServiceToken, verified);

  // Scope richiesto non presente: 403.
  const scopeGuard = new ServiceTokenGuard({ verify: async () => verified }, { getAllAndOverride: () => ['chat'] });
  await assert.rejects(() => scopeGuard.canActivate(context));

  // Token mancante o non valido: 401.
  const missingGuard = new ServiceTokenGuard({ verify: async () => undefined }, { getAllAndOverride: () => [] });
  const missingContext = { switchToHttp: () => ({ getRequest: () => ({ headers: {} }) }), getHandler: () => (() => {}), getClass: () => class {} };
  await assert.rejects(() => missingGuard.canActivate(missingContext));
});

test('verify rifiuta token scaduti', async (t) => {
  const secret = 's'.repeat(43);
  const tokenId = `st_${'a'.repeat(32)}`;
  t.mock.method(Orm, 'query', async () => [{
    TOKEN_ID: tokenId,
    TOKEN_HASH: hashServiceTokenSecret(secret),
    LABEL: 'scaduto',
    SCOPES: 'ia',
    EXPIRES_AT: new Date('2000-01-01T00:00:00Z'),
    REVOKED_AT: null,
  }]);
  t.mock.method(Orm, 'execute', async () => []);

  const service = buildService();
  assert.equal(await service.verify(`${tokenId}.${secret}`), undefined);
});
