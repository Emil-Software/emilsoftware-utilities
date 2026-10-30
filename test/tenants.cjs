require('ts-node/register/transpile-only');
require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
  getAccessiTenantRedisPrefix,
  loadAccessiTenants,
  parseAccessiTenantEnvFile,
} = require('../src/accessi/server');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'accessi-tenants.cjs');

function tenantEnv(overrides = {}) {
  const values = {
    ACCESSI_DB_HOST: 'db.example.test',
    ACCESSI_DB_PORT: '3050',
    ACCESSI_DB_DATABASE: '/data/accessi.fdb',
    ACCESSI_DB_USER: 'SYSDBA',
    ACCESSI_DB_PASSWORD: 'db-password',
    ACCESSI_ENCRYPTION_KEY: '0123456789ABCDEF',
    ACCESSI_JWT_SECRET: 'jwt-secret-0123456789-0123456789',
    ACCESSI_JWT_ISSUER: 'https://accessi.example.test',
    ACCESSI_JWT_AUDIENCE: 'accessi-api',
    ...overrides,
  };
  return Object.entries(values)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
}

function makeDirectory(files) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'accessi-tenants-'));
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(directory, name), content);
  }
  return directory;
}

function cleanup(directory) {
  fs.rmSync(directory, { recursive: true, force: true });
}

test('#10: parsing .env con commenti, export, apici e sequenze', () => {
  const parsed = parseAccessiTenantEnvFile([
    '# commento',
    'export ACCESSI_TENANT_ID=tenant-a',
    'ACCESSI_DB_HOST=db-a',
    'ACCESSI_JWT_PRIVATE_KEY="line1\\nline2"',
    "ACCESSI_TENANT_HOSTS='a.example.com, b.example.com'",
    'ACCESSI_TENANT_ENABLED=true # inline',
  ].join('\n'));

  assert.equal(parsed.ACCESSI_TENANT_ID, 'tenant-a');
  assert.equal(parsed.ACCESSI_DB_HOST, 'db-a');
  assert.equal(parsed.ACCESSI_JWT_PRIVATE_KEY, 'line1\nline2');
  assert.equal(parsed.ACCESSI_TENANT_HOSTS, 'a.example.com, b.example.com');
  assert.equal(parsed.ACCESSI_TENANT_ENABLED, 'true');
  assert.throws(() => parseAccessiTenantEnvFile('ACCESSI_X="non chiuso'), /virgolette non chiuse/);
});

test('#10: caricamento di due tenant e summary senza segreti', () => {
  const directory = makeDirectory({
    'tenant-a.env': tenantEnv({
      ACCESSI_TENANT_HOSTS: 'app-a.example.com, *.a.example.com',
      ACCESSI_JWT_SECRET: 'secret-tenant-a-0123456789-0123456789',
      ACCESSI_JWT_ISSUER: 'https://a.example.test',
    }),
    'tenant-b.env': tenantEnv({
      ACCESSI_TENANT_PATH: '/tenant-b',
      ACCESSI_JWT_SECRET: 'secret-tenant-b-0123456789-0123456789',
      ACCESSI_JWT_ISSUER: 'https://b.example.test',
      ACCESSI_DB_DATABASE: '/data/b.fdb',
      ACCESSI_TENANT_PORT: '3301',
    }),
  });

  try {
    const registry = loadAccessiTenants({ directory });
    assert.equal(registry.tenants.length, 2);
    assert.deepEqual(registry.tenants.map((tenant) => tenant.id), ['tenant-a', 'tenant-b']);
    assert.equal(registry.byId.get('tenant-a').options.tenantId, 'tenant-a');
    assert.equal(registry.byId.get('tenant-a').options.jwtOptions.issuer, 'https://a.example.test');

    const summary = JSON.stringify(registry.summary());
    assert.doesNotMatch(summary, /secret-tenant-a/);
    assert.doesNotMatch(summary, /db-password/);
    assert.doesNotMatch(summary, /0123456789ABCDEF/);
    assert.match(summary, /app-a\.example\.com/);
    assert.match(summary, /\/data\/b\.fdb/);
    assert.equal(registry.byId.get('tenant-b').port, 3301);
  } finally {
    cleanup(directory);
  }
});

test('#10: risoluzione host, wildcard, path e header fidato', () => {
  const directory = makeDirectory({
    'tenant-a.env': tenantEnv({
      ACCESSI_TENANT_HOSTS: 'app-a.example.com, *.wild.example.com',
      ACCESSI_JWT_SECRET: 'secret-a-0123456789-0123456789',
      ACCESSI_JWT_ISSUER: 'https://a.example.test',
    }),
    'tenant-b.env': tenantEnv({
      ACCESSI_TENANT_PATH: '/tenant-b',
      ACCESSI_JWT_SECRET: 'secret-b-0123456789-0123456789',
      ACCESSI_JWT_ISSUER: 'https://b.example.test',
    }),
  });

  try {
    const noHeader = loadAccessiTenants({ directory });
    assert.equal(noHeader.resolve({ host: 'app-a.example.com' }).tenant.id, 'tenant-a');
    assert.equal(noHeader.resolve({ host: 'x.wild.example.com' }).tenant.id, 'tenant-a');
    assert.equal(noHeader.resolve({ path: '/tenant-b/api/accessi' }).tenant.id, 'tenant-b');
    assert.equal(noHeader.resolve({ header: 'tenant-b' }), undefined);
    assert.equal(noHeader.resolve({ host: 'unknown.example.com', path: '/tenant-c' }), undefined);

    const withHeader = loadAccessiTenants({ directory, allowHeader: true });
    const resolution = withHeader.resolve({ header: 'tenant-b' });
    assert.deepEqual(
      { id: resolution.tenant.id, matchedBy: resolution.matchedBy },
      { id: 'tenant-b', matchedBy: 'header' },
    );
    // Host e path hanno precedenza sull'header.
    assert.equal(withHeader.resolve({ host: 'app-a.example.com', header: 'tenant-b' }).tenant.id, 'tenant-a');
    assert.equal(withHeader.resolve({ path: '/tenant-b', header: 'tenant-a' }).tenant.id, 'tenant-b');
  } finally {
    cleanup(directory);
  }
});

test('#10: errori di isolamento e configurazione', () => {
  const sharedSecret = tenantEnv({ ACCESSI_TENANT_HOSTS: 'a.example.test' });
  const duplicateHost = tenantEnv({ ACCESSI_TENANT_HOSTS: 'a.example.test', ACCESSI_JWT_SECRET: 'other-0123456789-0123456789', ACCESSI_JWT_ISSUER: 'https://other' });

  const duplicate = makeDirectory({
    'one.env': sharedSecret,
    'two.env': sharedSecret.replace('a.example.test', 'b.example.test'),
  });
  try {
    assert.throws(
      () => loadAccessiTenants({ directory: duplicate }),
      (error) => error.issues.some((issue) => /Chiave JWT condivisa/.test(issue)),
    );
  } finally {
    cleanup(duplicate);
  }

  const hostClash = makeDirectory({
    'one.env': sharedSecret,
    'two.env': duplicateHost,
  });
  try {
    assert.throws(
      () => loadAccessiTenants({ directory: hostClash }),
      (error) => error.issues.some((issue) => /Host "a\.example\.test"/.test(issue)),
    );
  } finally {
    cleanup(hostClash);
  }

  const missingDb = makeDirectory({
    'broken.env': tenantEnv({ ACCESSI_DB_HOST: undefined, ACCESSI_DB_DATABASE: undefined, ACCESSI_TENANT_HOSTS: 'broken.example.test' }),
  });
  try {
    assert.throws(
      () => loadAccessiTenants({ directory: missingDb }),
      (error) => error.issues.some((issue) => /broken\.env:.*ACCESSI_DB_HOST/.test(issue)),
    );
  } finally {
    cleanup(missingDb);
  }

  const empty = makeDirectory({});
  try {
    assert.throws(() => loadAccessiTenants({ directory: empty }), /Nessun file \.env/);
  } finally {
    cleanup(empty);
  }

  const sharedIssuer = makeDirectory({
    'a.env': tenantEnv({ ACCESSI_TENANT_HOSTS: 'a.example.test' }),
    'b.env': tenantEnv({
      ACCESSI_TENANT_HOSTS: 'b.example.test',
      ACCESSI_JWT_SECRET: 'b-secret-0123456789-0123456789',
    }),
  });
  try {
    const registry = loadAccessiTenants({ directory: sharedIssuer });
    assert.ok(registry.warnings.some((warning) => /Issuer\/audience/.test(warning)));
    const strict = loadAccessiTenants({ directory: sharedIssuer, allowSharedIssuer: true });
    assert.equal(strict.warnings.filter((warning) => /Issuer\/audience/.test(warning)).length, 0);
  } finally {
    cleanup(sharedIssuer);
  }
});

test('#10: tenant disabilitati e prefisso Redis isolato', () => {
  const directory = makeDirectory({
    'enabled.env': tenantEnv({ ACCESSI_TENANT_HOSTS: 'a.example.test' }),
    'disabled.env': tenantEnv({
      ACCESSI_TENANT_HOSTS: 'b.example.test',
      ACCESSI_TENANT_ENABLED: 'false',
      ACCESSI_JWT_SECRET: 'b-secret-0123456789-0123456789',
      ACCESSI_JWT_ISSUER: 'https://b.example.test',
    }),
  });
  try {
    const registry = loadAccessiTenants({ directory });
    assert.equal(registry.resolve({ host: 'b.example.test' }), undefined);
    assert.equal(registry.resolve({ host: 'a.example.test' }).tenant.id, 'enabled');
    assert.equal(getAccessiTenantRedisPrefix('tenant-a'), 'accessi:tenant-a:');
  } finally {
    cleanup(directory);
  }
});

test('#10: CLI valida, elenca e risolve', () => {
  const directory = makeDirectory({
    'tenant-a.env': tenantEnv({ ACCESSI_TENANT_HOSTS: 'app-a.example.test' }),
  });
  try {
    const list = execFileSync(process.execPath, [SCRIPT, '--dir', directory, '--list'], { encoding: 'utf8' });
    const parsed = JSON.parse(list);
    assert.equal(parsed.tenants.length, 1);
    assert.equal(parsed.tenants[0].id, 'tenant-a');

    const check = execFileSync(process.execPath, [SCRIPT, '--dir', directory, '--check'], { encoding: 'utf8' });
    assert.match(check, /Configurazione tenant valida: 1 tenant/);

    const resolved = execFileSync(
      process.execPath,
      [SCRIPT, '--dir', directory, '--resolve', 'app-a.example.test'],
      { encoding: 'utf8' },
    );
    assert.deepEqual(JSON.parse(resolved), { id: 'tenant-a', matchedBy: 'host' });
  } finally {
    cleanup(directory);
  }
});
