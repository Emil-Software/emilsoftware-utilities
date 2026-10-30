require('ts-node/register/transpile-only');
require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');

const packageJson = require('../package.json');

const RECOMMENDED = [
  {
    subpath: './accessi/server',
    module: '../src/accessi/server',
    symbols: ['initializeAccessiModule', 'createAccessiService', 'createAccessiOptionsFromEnv'],
  },
  {
    subpath: './accessi/contracts',
    module: '../src/accessi/contracts',
    symbols: ['extractAccessiBearerToken', 'resolveCodiceUtenteFromTokenPayload'],
  },
  {
    subpath: './accessi/contracts/dtos',
    module: '../src/accessi/contracts/dtos',
    symbols: ['LoginRequest', 'RefreshTokenRequest'],
  },
  {
    subpath: './accessi/resource-server',
    module: '../src/accessi/resource-server',
    symbols: ['createAccessiAuthMiddleware', 'createAccessiTokenVerifier', 'createAccessiIntrospectionClient'],
  },
  {
    subpath: './accessi/client',
    module: '../src/accessi/client',
    symbols: ['configureAccessiClient', 'createAccessiClient'],
  },
  {
    subpath: './accessi/client/public',
    module: '../src/accessi/client/public',
    symbols: ['login', 'refreshAccessToken', 'createAccessiPublicClient'],
  },
  {
    subpath: './accessi/client/admin',
    module: '../src/accessi/client/admin',
    symbols: ['getUsers', 'createRole', 'createAccessiAdminClient'],
  },
  {
    subpath: './accessi/client/service',
    module: '../src/accessi/client/service',
    symbols: ['createServiceToken', 'introspectAccessiToken', 'createAccessiServiceClient'],
  },
  {
    subpath: './accessi/openapi',
    module: '../src/accessi/openapi',
    symbols: ['setupOpenApi', 'mergeOpenApiDocuments'],
  },
  {
    subpath: './accessi/console',
    module: '../src/accessi/console',
    symbols: ['buildAccessiConsoleUrl', 'ACCESSI_CONSOLE_PATH'],
  },
  {
    subpath: './accessi/ui',
    module: '../src/accessi/ui',
    symbols: ['ACCESSI_UI_ASSETS', 'getAccessiUiAssetPath'],
  },
];

test('#20: ogni entry point consigliato e dichiarato in package.json#exports', () => {
  for (const entry of RECOMMENDED) {
    assert.ok(packageJson.exports[entry.subpath], `exports mancante per ${entry.subpath}`);
    const exported = packageJson.exports[entry.subpath];
    assert.match(exported.types, /^\.\/dist\/.+\.d\.ts$/);
    assert.match(exported.require, /^\.\/dist\/.+\.js$/);
  }
});

test('#20: gli entry point consigliati espongono i simboli principali', () => {
  for (const entry of RECOMMENDED) {
    const loaded = require(entry.module);
    for (const symbol of entry.symbols) {
      assert.ok(loaded[symbol] !== undefined, `${symbol} mancante in ${entry.subpath}`);
    }
  }
});

test('#20: il root barrel e i deep import legacy continuano a funzionare', () => {
  const root = require('../src');
  assert.equal(typeof root.Logger, 'function');
  assert.ok(root.initializeAccessiModule !== undefined);
  const resourceServer = require('../src/accessi/resource-server');
  assert.ok(resourceServer.createAccessiTokenVerifier !== undefined);

  // Deep import storico: supportato fino alla prossima major.
  const legacy = require('../src/accessi-module/security/jwtTokenOptions');
  assert.equal(typeof legacy.verifyAccessiJwt, 'function');
});
