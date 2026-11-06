require('ts-node/register/transpile-only');
require('reflect-metadata');
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { NestFactory } = require('@nestjs/core');
const { SwaggerModule } = require('@nestjs/swagger');
const { ExpressAdapter } = require('@nestjs/platform-express');
const {
  DEFAULT_ACCESSI_OPENAPI,
  resolveAccessiOpenApiOptions,
  resolveOpenApiSetupOptions,
  resolveOpenApiDocumentationBaseUrl,
  formatOpenApiDocumentationUrl,
  buildOpenApiExcludePaths,
  isOpenApiRequestPath,
  setupOpenApi,
} = require('../src/openapi/OpenApiConfig');
const { Logger } = require('../src/Logger');
const { AccessiModule } = require('../src/accessi-service/AccessiModule');
const { initializeAccessiModule } = require('../src/accessi-service');
const { AccessiDatabaseUpdater } = require('../src/accessi-service/database-updates/AccessiDatabaseUpdater');
const { initEmilsoftwareModule } = require('../src/initEmilsoftwareModule');

const ACCESSI_DATABASE_OK = {
  status: 'ok',
  reason: 'none',
  currentVersion: '1.12.0',
  expectedVersion: '1.12.0',
  issues: [],
  warnings: [],
};
let originalDatabaseEnsure;
beforeEach(() => {
  originalDatabaseEnsure = AccessiDatabaseUpdater.ensure;
  AccessiDatabaseUpdater.ensure = async () => ACCESSI_DATABASE_OK;
});
afterEach(() => {
  AccessiDatabaseUpdater.ensure = originalDatabaseEnsure;
});

const HISTORICAL_DEFAULTS = {
  enabled: true,
  openApiPath: 'accessi/openapi',
  openApiJsonPath: 'accessi/openapi.json',
  title: 'Accessi API Documentation',
  description: 'API del modulo accessi',
};

function createFakeApp() {
  const mounted = [];
  return {
    mounted,
    use(path) {
      mounted.push(path);
      return this;
    },
    getHttpServer() {
      return { address: () => ({ port: 4321 }) };
    },
  };
}

function createFakeNestApp() {
  const calls = { prefixes: [], cors: 0, pipes: 0, filters: 0, init: 0 };
  const openApiMounted = [];
  return {
    calls,
    openApiMounted,
    enableCors() {
      calls.cors += 1;
    },
    useGlobalPipes() {
      calls.pipes += 1;
    },
    useGlobalFilters() {
      calls.filters += 1;
    },
    setGlobalPrefix(prefix, options) {
      calls.prefixes.push({ prefix, options });
    },
    async init() {
      calls.init += 1;
    },
    get() {
      return {};
    },
    use(path) {
      openApiMounted.push(path);
      return this;
    },
    getHttpServer() {
      return { address: () => ({ port: 4321 }) };
    },
  };
}

function buildAccessiOptions(overrides = {}) {
  return {
    databaseOptions: {},
    confirmationEmailUrl: 'http://localhost',
    confirmationEmailReturnUrl: 'http://localhost',
    encryptionKey: '0123456789ABCDEF',
    mockDemoUser: false,
    autoUpdateDatabase: false,
    legacyPasswordMigrationOnStartup: false,
    jwtOptions: { secret: 'openapi-test-secret', expiresIn: '1h' },
    emailOptions: { host: 'localhost', from: 'openapi@example.test' },
    ...overrides,
  };
}

test('DEFAULT_ACCESSI_OPENAPI mantiene invariati i default storici', () => {
  assert.deepEqual(DEFAULT_ACCESSI_OPENAPI, HISTORICAL_DEFAULTS);
  assert.deepEqual(resolveAccessiOpenApiOptions(), HISTORICAL_DEFAULTS);
});

test('i path OpenAPI sono sovrascrivibili e normalizzati', () => {
  const resolved = resolveAccessiOpenApiOptions({
    openApiPath: '/auth/docs/',
    openApiJsonPath: '/auth/docs.json',
  });

  assert.equal(resolved.openApiPath, 'auth/docs');
  assert.equal(resolved.openApiJsonPath, 'auth/docs.json');
  assert.deepEqual(buildOpenApiExcludePaths(resolved), [
    '/auth/docs',
    '/auth/docs/{*path}',
  ]);
  assert.equal(isOpenApiRequestPath('/auth/docs', resolved), true);
  assert.equal(isOpenApiRequestPath('/auth/docs/static/app.css', resolved), true);
  assert.equal(isOpenApiRequestPath('/auth/docs.json', resolved), true);
  assert.equal(isOpenApiRequestPath('/auth/docs-json', resolved), true);
  assert.equal(isOpenApiRequestPath('/accessi/openapi', resolved), false);
});

test('enabled: false disabilita UI/JSON ma non il documento', () => {
  const resolved = resolveAccessiOpenApiOptions({ enabled: false });

  assert.equal(resolved.enabled, false);
  assert.deepEqual(buildOpenApiExcludePaths(resolved), []);
  assert.equal(isOpenApiRequestPath('/accessi/openapi', resolved), false);
  assert.equal(isOpenApiRequestPath('/accessi/openapi.json', resolved), false);
});

test('precedenza unificata: EmilsoftwareOptions.openapi > AccessiOptions.openapi > default', () => {
  const accessiOnly = resolveAccessiOpenApiOptions({
    openApiPath: 'accessi/custom',
    title: 'Accessi custom',
  });
  assert.equal(accessiOnly.openApiPath, 'accessi/custom');
  assert.equal(accessiOnly.openApiJsonPath, 'accessi/custom.json');
  assert.equal(accessiOnly.title, 'Accessi custom');

  const hostWins = resolveAccessiOpenApiOptions(
    { openApiPath: 'accessi/custom', title: 'Accessi custom', description: 'Accessi description' },
    { openApiPath: 'host/docs', description: 'Host description' },
  );
  assert.equal(hostWins.openApiPath, 'host/docs');
  assert.equal(hostWins.openApiJsonPath, 'host/docs.json');
  assert.equal(hostWins.title, 'Accessi custom');
  assert.equal(hostWins.description, 'Host description');
});

test('cambiare solo openApiPath deriva il JSON come nel comportamento storico', t => {
  const document = { openapi: '3.0.0', paths: {} };
  t.mock.method(SwaggerModule, 'createDocument', () => document);
  const setup = t.mock.method(SwaggerModule, 'setup', () => undefined);
  const app = createFakeApp();

  setupOpenApi(app, { openApiPath: 'auth/docs' });

  assert.equal(setup.mock.calls[0].arguments[0], 'auth/docs');
  assert.deepEqual(app.mounted, ['/auth/docs.json', '/auth/docs-json']);
});

test('override espliciti undefined non cancellano i default', () => {
  const resolved = resolveOpenApiSetupOptions(DEFAULT_ACCESSI_OPENAPI, {
    openApiPath: undefined,
    title: undefined,
  });

  assert.equal(resolved.openApiPath, 'accessi/openapi');
  assert.equal(resolved.title, 'Accessi API Documentation');
});

test('publicBaseUrl viene normalizzata e propagata senza alterare i default', () => {
  assert.equal(resolveAccessiOpenApiOptions().publicBaseUrl, undefined);
  assert.equal(
    resolveAccessiOpenApiOptions({ publicBaseUrl: ' https://accessi.example.test/ ' }).publicBaseUrl,
    'https://accessi.example.test',
  );

  // Un override senza publicBaseUrl non cancella quella del livello precedente.
  const inherited = resolveAccessiOpenApiOptions(
    { publicBaseUrl: 'https://accessi.example.test/' },
    { title: 'Host title' },
  );
  assert.equal(inherited.publicBaseUrl, 'https://accessi.example.test');
  assert.equal(inherited.title, 'Host title');

  // Il livello successivo vince quando la publicBaseUrl e esplicita.
  assert.equal(
    resolveAccessiOpenApiOptions(
      { publicBaseUrl: 'https://accessi.example.test' },
      { publicBaseUrl: 'https://host.example.test/' },
    ).publicBaseUrl,
    'https://host.example.test',
  );
});

test('resolveOpenApiDocumentationBaseUrl non usa mai 3000 come fallback', () => {
  const listeningApp = { getHttpServer: () => ({ address: () => ({ port: 4321 }) }) };
  const notListeningApp = { getHttpServer: () => ({ address: () => null }) };
  const pipeApp = { getHttpServer: () => ({ address: () => '\\\\.\\pipe\\accessi' }) };

  assert.equal(
    resolveOpenApiDocumentationBaseUrl(listeningApp),
    'http://localhost:4321',
  );
  assert.equal(
    resolveOpenApiDocumentationBaseUrl(notListeningApp),
    undefined,
  );
  assert.equal(resolveOpenApiDocumentationBaseUrl(pipeApp), undefined);
  assert.equal(
    resolveOpenApiDocumentationBaseUrl(notListeningApp, { publicBaseUrl: 'https://accessi.example.test/' }),
    'https://accessi.example.test',
  );
  assert.equal(
    formatOpenApiDocumentationUrl(undefined, '/accessi/openapi/'),
    '/accessi/openapi',
  );
});

test('setupOpenApi logga path relativi quando la porta non e determinabile', t => {
  const document = { openapi: '3.0.0', paths: {} };
  t.mock.method(SwaggerModule, 'createDocument', () => document);
  t.mock.method(SwaggerModule, 'setup', () => undefined);
  const log = t.mock.method(Logger.prototype, 'info', () => undefined);
  const app = createFakeApp();
  app.getHttpServer = () => ({ address: () => null });

  setupOpenApi(app, {
    openApiPath: 'accessi/openapi',
    openApiJsonPath: 'accessi/openapi.json',
  });

  const messages = log.mock.calls.map(call => String(call.arguments[0]));
  assert.ok(messages.includes('OpenAPI documentation available at: /accessi/openapi'));
  assert.ok(messages.includes('OpenAPI JSON available at: /accessi/openapi.json'));
  assert.equal(messages.some(message => message.includes('localhost:3000')), false);
});

test('setupOpenApi usa publicBaseUrl nei log quando configurata', t => {
  const document = { openapi: '3.0.0', paths: {} };
  t.mock.method(SwaggerModule, 'createDocument', () => document);
  t.mock.method(SwaggerModule, 'setup', () => undefined);
  const log = t.mock.method(Logger.prototype, 'info', () => undefined);

  setupOpenApi(createFakeApp(), {
    openApiPath: 'accessi/openapi',
    openApiJsonPath: 'accessi/openapi.json',
    publicBaseUrl: 'https://accessi.example.test/',
  });

  const messages = log.mock.calls.map(call => String(call.arguments[0]));
  assert.ok(messages.includes(
    'OpenAPI documentation available at: https://accessi.example.test/accessi/openapi',
  ));
  assert.ok(messages.includes(
    'OpenAPI JSON available at: https://accessi.example.test/accessi/openapi.json',
  ));
});

test('setupOpenApi usa la porta effettiva quando il server e in ascolto', t => {
  const document = { openapi: '3.0.0', paths: {} };
  t.mock.method(SwaggerModule, 'createDocument', () => document);
  t.mock.method(SwaggerModule, 'setup', () => undefined);
  const log = t.mock.method(Logger.prototype, 'info', () => undefined);

  setupOpenApi(createFakeApp(), {
    openApiPath: 'accessi/openapi',
    openApiJsonPath: 'accessi/openapi.json',
  });

  const messages = log.mock.calls.map(call => String(call.arguments[0]));
  assert.ok(messages.includes(
    'OpenAPI documentation available at: http://localhost:4321/accessi/openapi',
  ));
  assert.ok(messages.includes(
    'OpenAPI JSON available at: http://localhost:4321/accessi/openapi.json',
  ));
});

test('initializeAccessiModule propaga AccessiOptions.publicBaseUrl ai log OpenAPI', async t => {
  const document = { openapi: '3.0.0', paths: {} };
  const nestApp = createFakeNestApp();
  t.mock.method(NestFactory, 'create', async () => nestApp);
  t.mock.method(SwaggerModule, 'createDocument', () => document);
  t.mock.method(SwaggerModule, 'setup', () => undefined);
  const log = t.mock.method(Logger.prototype, 'info', () => undefined);

  await initializeAccessiModule(express(), buildAccessiOptions({
    publicBaseUrl: 'https://accessi.example.test/',
  }));

  const messages = log.mock.calls.map(call => String(call.arguments[0]));
  assert.ok(messages.includes(
    'OpenAPI documentation available at: https://accessi.example.test/accessi/openapi',
  ));
  assert.ok(messages.includes(
    'OpenAPI JSON available at: https://accessi.example.test/accessi/openapi.json',
  ));
});

test('setupOpenApi mantiene i default generici e monta il documento', t => {
  const document = { openapi: '3.0.0', paths: { '/api/accessi/login': {} } };
  const createDocument = t.mock.method(SwaggerModule, 'createDocument', () => document);
  const setup = t.mock.method(SwaggerModule, 'setup', () => undefined);
  const app = createFakeApp();

  const result = setupOpenApi(app);

  assert.equal(result, document);
  assert.equal(createDocument.mock.callCount(), 1);
  assert.equal(setup.mock.calls[0].arguments[0], 'openapi');
  assert.deepEqual(app.mounted, ['/openapi.json', '/openapi-json']);
});

test('setupOpenApi usa i path custom, il callback e non monta con enabled false', t => {
  const document = { openapi: '3.0.0', paths: { '/api/accessi/login': {} } };
  let exportedDocument;
  t.mock.method(SwaggerModule, 'createDocument', () => document);
  const setup = t.mock.method(SwaggerModule, 'setup', () => undefined);

  const enabledApp = createFakeApp();
  const enabledResult = setupOpenApi(enabledApp, {
    openApiPath: 'auth/docs',
    openApiJsonPath: 'auth/docs.json',
    title: 'Auth API',
    description: 'Auth description',
    onDocument: current => {
      exportedDocument = current;
    },
  });

  assert.equal(enabledResult, document);
  assert.equal(exportedDocument, document);
  assert.equal(setup.mock.calls[0].arguments[0], 'auth/docs');
  assert.deepEqual(enabledApp.mounted, ['/auth/docs.json', '/auth/docs-json']);

  const disabledApp = createFakeApp();
  const disabledResult = setupOpenApi(disabledApp, {
    enabled: false,
    openApiPath: 'auth/docs',
    openApiJsonPath: 'auth/docs.json',
  });

  assert.equal(disabledResult, document);
  assert.equal(setup.mock.calls.length, 1);
  assert.deepEqual(disabledApp.mounted, []);
});

test('initializeAccessiModule restituisce il documento e usa i path di default', async t => {
  const document = { openapi: '3.0.0', paths: { '/api/accessi/login': {} } };
  const nestApp = createFakeNestApp();
  t.mock.method(NestFactory, 'create', async () => nestApp);
  const createDocument = t.mock.method(SwaggerModule, 'createDocument', () => document);
  const setup = t.mock.method(SwaggerModule, 'setup', () => undefined);

  const result = await initializeAccessiModule(express(), buildAccessiOptions());

  assert.equal(result.nestApp, nestApp);
  assert.equal(result.document, document);
  assert.equal(createDocument.mock.callCount(), 1);
  assert.equal(setup.mock.calls[0].arguments[0], 'accessi/openapi');
  assert.equal(nestApp.calls.prefixes[0].prefix, 'api');
  assert.deepEqual(nestApp.calls.prefixes[0].options.exclude, [
    '/accessi/openapi',
    '/accessi/openapi/{*path}',
  ]);
  assert.deepEqual(nestApp.openApiMounted, [
    '/accessi/openapi.json',
    '/accessi/openapi-json',
  ]);
});

test('initializeAccessiModule accetta path custom', async t => {
  const document = { openapi: '3.0.0', paths: {} };
  const nestApp = createFakeNestApp();
  t.mock.method(NestFactory, 'create', async () => nestApp);
  t.mock.method(SwaggerModule, 'createDocument', () => document);
  const setup = t.mock.method(SwaggerModule, 'setup', () => undefined);

  await initializeAccessiModule(express(), buildAccessiOptions({
    openapi: { openApiPath: 'auth/docs', openApiJsonPath: 'auth/docs.json' },
  }));

  assert.equal(setup.mock.calls[0].arguments[0], 'auth/docs');
  assert.deepEqual(nestApp.calls.prefixes[0].options.exclude, [
    '/auth/docs',
    '/auth/docs/{*path}',
  ]);
});

test('initializeAccessiModule con OpenAPI disabilitato non monta UI/JSON', async t => {
  const document = { openapi: '3.0.0', paths: { '/api/accessi/login': {} } };
  const nestApp = createFakeNestApp();
  t.mock.method(NestFactory, 'create', async () => nestApp);
  t.mock.method(SwaggerModule, 'createDocument', () => document);
  const setup = t.mock.method(SwaggerModule, 'setup', () => undefined);

  const result = await initializeAccessiModule(express(), buildAccessiOptions({
    openapi: { enabled: false },
  }));

  assert.equal(result.document, document);
  assert.equal(setup.mock.callCount(), 0);
  assert.deepEqual(nestApp.openApiMounted, []);
  assert.deepEqual(nestApp.calls.prefixes[0].options.exclude, []);
});

test('il documento reale contiene le rotte /api/accessi ed e mergiabile', async t => {
  const app = await NestFactory.create(
    AccessiModule.forRoot(buildAccessiOptions()),
    new ExpressAdapter(express()),
    { logger: false },
  );
  t.after(() => app.close());
  app.setGlobalPrefix('api');

  const document = setupOpenApi(app, {
    enabled: false,
    openApiPath: 'accessi/openapi',
    openApiJsonPath: 'accessi/openapi.json',
  });

  const paths = Object.keys(document.paths);
  assert.ok(paths.some(path => path.startsWith('/api/accessi')));
  assert.ok(document.components?.schemas);
  // Le chiavi di paths e schemas sono uniche per costruzione: il documento puo
  // essere mergiato nell'OpenAPI host senza generare duplicati.
  assert.equal(new Set(paths).size, paths.length);
});

function buildUnifiedOptions(openapi) {
  return {
    accessiOptions: buildAccessiOptions({
      openapi: { openApiPath: 'accessi/custom', title: 'Accessi title' },
    }),
    allegatiOptions: { databaseOptions: {}, requireAuthorization: false },
    ...(openapi ? { openapi } : {}),
  };
}

test('initEmilsoftwareModule: AccessiOptions.openapi funziona da solo', async t => {
  const document = { openapi: '3.0.0', paths: {} };
  const nestApp = createFakeNestApp();
  t.mock.method(NestFactory, 'create', async () => nestApp);
  t.mock.method(SwaggerModule, 'createDocument', () => document);
  const setup = t.mock.method(SwaggerModule, 'setup', () => undefined);

  const result = await initEmilsoftwareModule(express(), buildUnifiedOptions());

  assert.equal(result.nestApp, nestApp);
  assert.equal(result.document, document);
  assert.equal(setup.mock.calls[0].arguments[0], 'accessi/custom');
  assert.deepEqual(nestApp.calls.prefixes[0].options.exclude, [
    '/accessi/custom',
    '/accessi/custom/{*path}',
  ]);
  assert.deepEqual(nestApp.openApiMounted, [
    '/accessi/custom.json',
    '/accessi/custom-json',
  ]);
});

test('initEmilsoftwareModule: EmilsoftwareOptions.openapi vince su AccessiOptions.openapi', async t => {
  const document = { openapi: '3.0.0', paths: {} };
  const nestApp = createFakeNestApp();
  t.mock.method(NestFactory, 'create', async () => nestApp);
  t.mock.method(SwaggerModule, 'createDocument', () => document);
  const setup = t.mock.method(SwaggerModule, 'setup', () => undefined);

  const result = await initEmilsoftwareModule(express(), buildUnifiedOptions({
    openApiPath: 'host/docs',
    openApiJsonPath: 'host/docs.json',
  }));

  assert.equal(result.document, document);
  assert.equal(setup.mock.calls[0].arguments[0], 'host/docs');
  assert.deepEqual(nestApp.calls.prefixes[0].options.exclude, [
    '/host/docs',
    '/host/docs/{*path}',
  ]);
  assert.deepEqual(nestApp.openApiMounted, ['/host/docs.json', '/host/docs-json']);
});
