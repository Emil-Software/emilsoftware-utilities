// Verifiche eseguite dentro un progetto temporaneo che ha installato il tarball
// `npm pack` di emilsoftware-utilities. Non usa path relativi al repository: gira
// solo contro il package installato, come farebbe un consumer reale.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const packageJsonPath = require.resolve('emilsoftware-utilities/package.json');
const packageRoot = path.dirname(packageJsonPath);
const pkg = require(packageJsonPath);

/** Subpath -> export -> typeof atteso. */
const EXPECTED = {
  'emilsoftware-utilities': {
    Orm: 'function',
    Logger: 'function',
    DateUtilities: 'function',
    autobind: 'function',
  },
  'emilsoftware-utilities/accessi/server': {
    initializeAccessiModule: 'function',
    AccessiModule: 'function',
    loadAccessiTenantEnvironmentFile: 'function',
    loadAccessiTenants: 'function',
  },
  'emilsoftware-utilities/accessi/resource-server': {
    createAccessiAuthMiddleware: 'function',
    createAccessiAuthGuard: 'function',
    deriveAccessiAccessSecret: 'function',
  },
  'emilsoftware-utilities/accessi/resource-server/core': {
    deriveAccessiAccessSecret: 'function',
  },
  'emilsoftware-utilities/accessi/resource-server/express': {
    createAccessiAuthMiddleware: 'function',
  },
  'emilsoftware-utilities/accessi/resource-server/nest': {
    createAccessiAuthGuard: 'function',
  },
  'emilsoftware-utilities/accessi/client': {
    configureAccessiClient: 'function',
    createAccessiClient: 'function',
    login: 'function',
  },
  'emilsoftware-utilities/accessi/client/public': {
    createAccessiPublicClient: 'function',
    login: 'function',
  },
  'emilsoftware-utilities/accessi/client/admin': {
    createAccessiAdminClient: 'function',
    getUsers: 'function',
  },
  'emilsoftware-utilities/accessi/client/service': {
    createAccessiServiceClient: 'function',
    introspectAccessiToken: 'function',
  },
  'emilsoftware-utilities/accessi/contracts': {
    accessiRequirement: 'object',
    evaluateRequirement: 'function',
    StatoRegistrazione: 'object',
  },
  'emilsoftware-utilities/accessi/contracts/dtos': {
    LoginRequest: 'function',
  },
  'emilsoftware-utilities/accessi/openapi': {
    setupOpenApi: 'function',
    mergeOpenApiDocuments: 'function',
  },
  'emilsoftware-utilities/accessi/console': {
    buildAccessiConsoleUrl: 'function',
  },
  'emilsoftware-utilities/accessi/ui': {
    getAccessiUiAssetPath: 'function',
  },
};

const FORBIDDEN_DEPENDENCIES = [
  '@nestjs/',
  'node-firebird',
  'nodemailer',
  'express',
  'winston',
  'multer',
  'jsonwebtoken',
];
const FORBIDDEN_BUILTINS = ['fs', 'net', 'tls', 'http', 'https', 'dns', 'child_process', 'worker_threads'];

function requireSubpath(subpath) {
  return require(subpath);
}

for (const [subpath, expectedExports] of Object.entries(EXPECTED)) {
  const loaded = requireSubpath(subpath);
  for (const [name, type] of Object.entries(expectedExports)) {
    assert.equal(typeof loaded[name], type, `${subpath} deve esportare ${name} (${type})`);
  }
}

// Export map: ogni target deve esistere davvero nel tarball.
for (const [subpath, target] of Object.entries(pkg.exports ?? {})) {
  if (subpath.includes('*')) continue;
  const resolved = typeof target === 'string' ? target : target.require ?? target.default;
  assert.ok(resolved, `${subpath}: target export mancante`);
  const file = path.join(packageRoot, resolved.replace(/^\.\//, ''));
  assert.ok(fs.existsSync(file), `${subpath}: file non trovato (${resolved})`);
}

assert.ok(Array.isArray(pkg.sideEffects), 'package.json deve dichiarare sideEffects');
assert.ok(pkg.typesVersions?.['*']?.['accessi/*'], 'package.json deve dichiarare typesVersions per accessi/*');

// Asset della console presenti nel tarball.
for (const asset of [
  'accessi/console/index.html',
  'accessi/console/console.js',
  'accessi/console/console.css',
]) {
  const resolved = typeof pkg.exports?.[`./${asset}`] === 'string'
    ? pkg.exports[`./${asset}`]
    : pkg.exports?.[`./${asset}`]?.default;
  assert.ok(resolved, `export ${asset} mancante`);
  assert.ok(fs.existsSync(path.join(packageRoot, resolved.replace(/^\.\//, ''))), `asset ${asset} non trovato`);
}

// I client per scope non devono esporre operazioni fuori scope.
const publicClient = require('emilsoftware-utilities/accessi/client/public');
const adminClient = require('emilsoftware-utilities/accessi/client/admin');
const serviceClient = require('emilsoftware-utilities/accessi/client/service');
assert.equal(publicClient.getUsers, undefined, 'il client pubblico non deve esporre getUsers');
assert.equal(publicClient.createServiceToken, undefined, 'il client pubblico non deve esporre createServiceToken');
assert.equal(adminClient.login, undefined, 'il client admin non deve esporre login');
assert.equal(serviceClient.getUsers, undefined, 'il client service non deve esporre getUsers');

// Contracts e DTO devono restare browser-safe: nessuna dipendenza server-side
// caricata e nessun require di builtin Node nei moduli coinvolti.
const loadedBefore = new Set(Object.keys(require.cache));
require('emilsoftware-utilities/accessi/contracts');
require('emilsoftware-utilities/accessi/contracts/dtos');
const loadedAfter = Object.keys(require.cache).filter((file) => !loadedBefore.has(file));
const distFiles = loadedAfter.filter((file) => file.startsWith(path.join(packageRoot, 'dist')));

for (const file of loadedAfter) {
  const normalized = file.split(path.sep).join('/');
  for (const dependency of FORBIDDEN_DEPENDENCIES) {
    assert.ok(
      !normalized.includes(`/node_modules/${dependency}`),
      `contracts non deve caricare ${dependency} (${normalized})`,
    );
  }
}

for (const file of distFiles) {
  const source = fs.readFileSync(file, 'utf8');
  for (const builtin of FORBIDDEN_BUILTINS) {
    const pattern = new RegExp(`require\\(["'](node:)?${builtin}["']\\)`);
    assert.ok(!pattern.test(source), `contracts non deve usare il builtin ${builtin} (${path.basename(file)})`);
  }
}

// Interop ESM: il package e CommonJS, ma l'import nominale deve funzionare.
(async () => {
  const contracts = await import('emilsoftware-utilities/accessi/contracts');
  assert.equal(typeof contracts.accessiRequirement?.permission, 'function', 'import ESM di contracts');
  const client = await import('emilsoftware-utilities/accessi/client/public');
  assert.equal(typeof client.createAccessiPublicClient, 'function', 'import ESM del client pubblico');

  // Tenant loader: il tarball deve poter eseguire un *.environment.ts e avere jiti.
  const {
    loadAccessiTenantEnvironmentFile,
    loadAccessiTenants,
  } = require('emilsoftware-utilities/accessi/server');
  assert.equal(typeof pkg.dependencies?.jiti, 'string', 'jiti deve essere una dipendenza runtime del pacchetto');
  assert.ok(require.resolve('jiti'), 'jiti deve essere installato con il pacchetto');

  const tenantsDir = path.join(__dirname, 'tenants');
  fs.mkdirSync(tenantsDir, { recursive: true });
  const environmentFile = path.join(tenantsDir, 'tenant-a.environment.ts');
  fs.writeFileSync(environmentFile, `export default {
  tenant: { id: 'tenant-a', hosts: ['tenant-a.example.test'], port: 3301 },
  database: { host: 'db.example.test', database: '/data/tenant-a.fdb' },
  jwt: { secret: 'pack-smoke-secret-0123456789-0123456789', expiresIn: '1h', issuer: 'https://tenant-a.example.test', audience: 'accessi-api' },
  email: { host: 'localhost', port: 25, secure: false, requireTLS: false, tls: { rejectUnauthorized: false }, from: 'noreply@example.test', auth: { user: 'u', pass: 'p' } },
  encryptionKey: '0123456789ABCDEF',
  confirmationEmailUrl: 'https://tenant-a.example.test',
  confirmationEmailReturnUrl: 'https://tenant-a.example.test',
};
`);

  const single = loadAccessiTenantEnvironmentFile(environmentFile);
  assert.equal(single.tenant.id, 'tenant-a');
  assert.equal(single.tenant.options.tenantId, 'tenant-a');
  assert.equal(single.tenant.options.jwtOptions.issuer, 'https://tenant-a.example.test');
  assert.equal(single.tenant.options.databaseOptions.port, 3050);

  const registry = loadAccessiTenants({ directory: tenantsDir });
  assert.equal(registry.tenants.length, 1);
  assert.equal(registry.resolve({ host: 'tenant-a.example.test' }).tenant.id, 'tenant-a');
  assert.doesNotMatch(JSON.stringify(registry.summary()), /pack-smoke-secret/);

  console.log('Pack smoke test OK: subpath, scope client, contracts browser-safe, ESM e tenant loader verificati.');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
