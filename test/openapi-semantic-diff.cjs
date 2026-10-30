require('ts-node/register/transpile-only');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  applyAllowlist,
  buildSnapshot,
  diffSnapshots,
} = require('../scripts/openapi-semantic-diff.cjs');

function operation(overrides = {}) {
  return {
    method: 'POST',
    path: '/api/accessi/test',
    security: [],
    parameters: {},
    requestBody: null,
    responses: {},
    ...overrides,
  };
}

function snapshot(operations = {}, schemas = {}) {
  return { operations, schemas };
}

function ids(changes) {
  return changes.map((change) => change.id).sort();
}

test('uno snapshot identico non produce cambi', () => {
  const base = snapshot({ login: operation() });
  const result = diffSnapshots(base, base);
  assert.deepEqual(result.breaking, []);
  assert.deepEqual(result.nonBreaking, []);
});

test('aggiungere una proprieta opzionale non e breaking (request e response)', () => {
  const base = snapshot({
    login: operation({
      requestBody: { required: true, schema: { type: 'object', properties: { email: { type: 'string' } } } },
      responses: { '200': { type: 'object', properties: { token: { type: 'string' } } } },
    }),
  });
  const current = snapshot({
    login: operation({
      requestBody: {
        required: true,
        schema: { type: 'object', properties: { email: { type: 'string' }, remember: { type: 'boolean' } } },
      },
      responses: {
        '200': { type: 'object', properties: { token: { type: 'string' }, expiresIn: { type: 'number' } } },
      },
    }),
  });

  const result = diffSnapshots(base, current);
  assert.deepEqual(result.breaking, []);
  assert.deepEqual(ids(result.nonBreaking), [
    'operation:login:requestBody.remember:added',
    'operation:login:response:200.expiresIn:added',
  ]);
});

test('una nuova proprieta required in input e breaking', () => {
  const base = snapshot({
    login: operation({
      requestBody: { required: true, schema: { type: 'object', properties: { email: { type: 'string' } } } },
    }),
  });
  const current = snapshot({
    login: operation({
      requestBody: {
        required: true,
        schema: {
          type: 'object',
          properties: { email: { type: 'string' }, otp: { type: 'string' } },
          required: ['otp'],
        },
      },
    }),
  });

  const result = diffSnapshots(base, current);
  assert.deepEqual(ids(result.breaking), ['operation:login:requestBody.otp:added:required']);
});

test('required rimosso rompe le risposte ma non le richieste', () => {
  const base = snapshot({
    login: operation({
      requestBody: {
        required: true,
        schema: { type: 'object', properties: { email: { type: 'string' } }, required: ['email'] },
      },
      responses: { '200': { type: 'object', properties: { token: { type: 'string' } }, required: ['token'] } },
    }),
  });
  const current = snapshot({
    login: operation({
      requestBody: { required: true, schema: { type: 'object', properties: { email: { type: 'string' } }, required: [] } },
      responses: { '200': { type: 'object', properties: { token: { type: 'string' } }, required: [] } },
    }),
  });

  const result = diffSnapshots(base, current);
  assert.deepEqual(ids(result.breaking), ['operation:login:response:200.token:required:removed']);
  assert.deepEqual(ids(result.nonBreaking), ['operation:login:requestBody.email:required:removed']);
});

test('cambio di tipo, formato ed enum rimossi sono breaking', () => {
  const base = snapshot({
    login: operation({
      requestBody: {
        required: true,
        schema: {
          type: 'object',
          properties: {
            email: { type: 'string' },
            mode: { type: 'string', enum: ['"password"', '"passwordless"'] },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },
      },
    }),
  });
  const current = snapshot({
    login: operation({
      requestBody: {
        required: true,
        schema: {
          type: 'object',
          properties: {
            email: { type: 'number' },
            mode: { type: 'string', enum: ['"password"', '"federated"'] },
            createdAt: { type: 'string', format: 'date' },
          },
        },
      },
    }),
  });

  const result = diffSnapshots(base, current);
  assert.ok(ids(result.breaking).includes('operation:login:requestBody.email:type'));
  assert.ok(ids(result.breaking).includes('operation:login:requestBody.createdAt:format'));
  assert.ok(ids(result.breaking).includes('operation:login:requestBody.mode:enum:"passwordless"'));
  assert.ok(ids(result.nonBreaking).includes('operation:login:requestBody.mode:enum:new:"federated"'));
});

test('operation, parametri e security: rimozioni e nuovi required sono breaking', () => {
  const base = snapshot({
    login: operation({ parameters: { 'query:tenant': { required: false, schema: { type: 'string' } } } }),
    logout: operation({ method: 'DELETE', path: '/api/accessi/logout' }),
  });
  const current = snapshot({
    login: operation({
      security: ['bearer'],
      parameters: {
        'query:tenant': { required: false, schema: { type: 'string' } },
        'header:x-tenant': { required: true, schema: { type: 'string' } },
      },
    }),
  });

  const result = diffSnapshots(base, current);
  const breakingIds = ids(result.breaking);
  assert.ok(breakingIds.includes('operation:logout:removed'));
  assert.ok(breakingIds.includes('operation:login:security'));
  assert.ok(breakingIds.includes('operation:login:parameter:header:x-tenant:added:required'));
});

test('l\'allowlist richiede una reason e segnala le eccezioni obsolete', () => {
  const breaking = [
    { id: 'operation:login:removed', message: 'operation login: rimossa' },
    { id: 'operation:logout:removed', message: 'operation logout: rimossa' },
  ];

  const allowed = applyAllowlist(breaking, [
    { id: 'operation:login:removed', reason: 'Endpoint rimosso nella major 3.0', issue: '#100' },
    { id: 'operation:logout:removed', reason: '   ' },
    { id: 'operation:old:removed', reason: 'Eccezione rimasta indietro' },
  ]);

  assert.deepEqual(allowed.violations.map((change) => change.id), ['operation:logout:removed']);
  assert.deepEqual(allowed.applied.map((entry) => entry.change.id), ['operation:login:removed']);
  assert.deepEqual(allowed.stale.map((entry) => entry.id), ['operation:old:removed']);
});

test('buildSnapshot risolve parametri e risposte con $ref', () => {
  const document = {
    openapi: '3.0.0',
    paths: {
      '/api/accessi/test': {
        parameters: [{ $ref: '#/components/parameters/Tenant' }],
        post: {
          operationId: 'testOperation',
          security: [{ bearer: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/TestRequest' },
              },
            },
          },
          responses: {
            200: {
              description: 'ok',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/TestResult' } },
              },
            },
          },
        },
      },
    },
    components: {
      parameters: {
        Tenant: { name: 'x-tenant', in: 'header', required: true, schema: { type: 'string' } },
      },
      schemas: {
        TestRequest: {
          type: 'object',
          properties: { email: { type: 'string' } },
          required: ['email'],
        },
        TestResult: { type: 'object', properties: { token: { type: 'string' } } },
      },
    },
  };

  const built = buildSnapshot(document);
  const operationSnapshot = built.operations.testOperation;
  assert.equal(operationSnapshot.method, 'POST');
  assert.deepEqual(operationSnapshot.security, ['bearer']);
  assert.equal(operationSnapshot.parameters['header:x-tenant'].required, true);
  assert.deepEqual(operationSnapshot.requestBody, {
    required: true,
    schema: { ref: 'TestRequest' },
  });
  assert.deepEqual(operationSnapshot.responses['200'], { ref: 'TestResult' });
  assert.deepEqual(built.schemas.TestRequest.required, ['email']);
});

test('il contratto corrente non introduce breaking change rispetto alla baseline', (t) => {
  const specPath = path.join(__dirname, '..', 'src', 'accessi-module', 'openapi', 'accessi.openapi.json');
  const baselinePath = path.join(__dirname, '..', 'docs', 'accessi-openapi-baseline.json');
  if (!fs.existsSync(specPath)) {
    t.skip('OpenAPI generato non presente: eseguire npm run generate:accessi-openapi');
    return;
  }

  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  const current = buildSnapshot(JSON.parse(fs.readFileSync(specPath, 'utf8')));
  const { breaking } = diffSnapshots(baseline, current);
  assert.deepEqual(breaking, [], 'la baseline va aggiornata con accessi:update-openapi-baseline');
});
