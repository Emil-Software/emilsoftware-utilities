require('ts-node/register/transpile-only');
require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const {
  accessiOptionsFromTenantEnvironment,
  getAccessiTenantRedisPrefix,
  loadAccessiTenantEnvironmentFile,
  loadAccessiTenants,
} = require('../src/accessi/server');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'accessi-tenants.cjs');

function environmentSource(overrides = {}) {
  const tenant = {
    id: 'tenant-a',
    ...(overrides.tenant?.hosts === undefined && overrides.tenant?.path === undefined
      ? { hosts: ['app-a.example.test'] }
      : {}),
    ...(overrides.tenant ?? {}),
  };
  const database = {
    host: 'db.example.test',
    port: 3050,
    database: '/data/accessi.fdb',
    user: 'SYSDBA',
    password: 'db-password',
    ...(overrides.database ?? {}),
  };
  const jwt = {
    secret: 'jwt-secret-0123456789-0123456789',
    expiresIn: '1h',
    issuer: 'https://accessi.example.test',
    audience: 'accessi-api',
    ...(overrides.jwt ?? {}),
  };
  const email = {
    host: 'localhost',
    port: 25,
    secure: false,
    requireTLS: false,
    tls: { rejectUnauthorized: false },
    from: 'noreply@example.test',
    auth: { user: 'smtp-user', pass: 'smtp-password' },
    ...(overrides.email ?? {}),
  };

  return `export default {
  tenant: ${JSON.stringify(tenant)},
  database: ${JSON.stringify(database)},
  jwt: ${JSON.stringify(jwt)},
  email: ${JSON.stringify(email)},
  encryptionKey: '0123456789ABCDEF',
  confirmationEmailUrl: 'https://accessi.example.test',
  confirmationEmailReturnUrl: 'https://accessi.example.test',
  ${overrides.extra ?? ''}
};
`;
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

test('#10: la configurazione tipizzata diventa AccessiOptions con i default', () => {
  const environment = {
    tenant: { id: 'acme', hosts: ['accessi.acme.test'], port: 3301 },
    database: {
      host: 'db-acme',
      database: '/data/acme.fdb',
      wireCrypt: 'disabled',
      pluginName: 'Legacy_Auth',
    },
    jwt: { secret: 's'.repeat(40), expiresIn: '1h', issuer: 'https://acme.test' },
    email: {
      host: 'localhost',
      port: 25,
      secure: false,
      requireTLS: false,
      tls: { rejectUnauthorized: false },
      from: 'noreply@acme.test',
      auth: { user: 'u', pass: 'p' },
    },
    encryptionKey: '0123456789ABCDEF',
    confirmationEmailUrl: 'https://acme.test',
    confirmationEmailReturnUrl: 'https://acme.test',
    publicBaseUrl: 'https://accessi.acme.test',
    mockDemoUser: false,
    passwordExpiration: true,
    passwordExpirationDays: 60,
    authCookie: { enabled: true, secure: false },
    metrics: { enabled: true, prefix: 'acme' },
    audit: { retentionDays: 30, logger: false },
    http: { trustProxy: 1 },
  };

  const options = accessiOptionsFromTenantEnvironment(environment);
  assert.equal(options.tenantId, 'acme');
  assert.equal(options.databaseOptions.port, 3050);
  assert.equal(options.databaseOptions.user, 'SYSDBA');
  assert.equal(options.databaseOptions.password, 'masterkey');
  assert.equal(options.databaseOptions.pluginName, 'Legacy_Auth');
  assert.equal(options.passwordExpirationDays, 60);
  assert.equal(options.authCookie.enabled, true);
  assert.equal(options.metrics.prefix, 'acme');
  assert.equal(options.audit.retentionDays, 30);
  assert.equal(options.http.trustProxy, 1);
  assert.equal(options.jwtOptions.issuer, 'https://acme.test');
});

test('#10: caricamento di due *.environment.ts e summary senza segreti', () => {
  const directory = makeDirectory({
    'tenant-a.environment.ts': environmentSource({
      tenant: { id: 'tenant-a', hosts: ['app-a.example.test', '*.a.example.test'] },
      jwt: { secret: 'secret-a-0123456789-0123456789', issuer: 'https://a.example.test' },
    }),
    'tenant-b.environment.ts': environmentSource({
      tenant: { id: 'tenant-b', path: '/tenant-b', port: 3301 },
      database: { database: '/data/b.fdb' },
      jwt: { secret: 'secret-b-0123456789-0123456789', issuer: 'https://b.example.test' },
    }),
  });

  try {
    const registry = loadAccessiTenants({ directory });
    assert.equal(registry.tenants.length, 2);
    assert.deepEqual(registry.tenants.map((tenant) => tenant.id), ['tenant-a', 'tenant-b']);
    assert.equal(registry.byId.get('tenant-a').options.tenantId, 'tenant-a');
    assert.match(registry.byId.get('tenant-a').environmentFile, /tenant-a\.environment\.ts$/);
    assert.equal(registry.byId.get('tenant-b').port, 3301);

    const summary = JSON.stringify(registry.summary());
    assert.doesNotMatch(summary, /secret-a/);
    assert.doesNotMatch(summary, /db-password/);
    assert.doesNotMatch(summary, /smtp-password/);
    assert.match(summary, /app-a\.example\.test/);
    assert.match(summary, /\/data\/b\.fdb/);
  } finally {
    cleanup(directory);
  }
});

test('#10: risoluzione host, wildcard, path e header fidato', () => {
  const directory = makeDirectory({
    'tenant-a.environment.ts': environmentSource({
      tenant: { id: 'tenant-a', hosts: ['app-a.example.test', '*.wild.example.test'] },
      jwt: { secret: 'secret-a-0123456789-0123456789', issuer: 'https://a.example.test' },
    }),
    'tenant-b.environment.ts': environmentSource({
      tenant: { id: 'tenant-b', path: '/tenant-b' },
      jwt: { secret: 'secret-b-0123456789-0123456789', issuer: 'https://b.example.test' },
    }),
  });

  try {
    const noHeader = loadAccessiTenants({ directory });
    assert.equal(noHeader.resolve({ host: 'app-a.example.test' }).tenant.id, 'tenant-a');
    assert.equal(noHeader.resolve({ host: 'x.wild.example.test' }).tenant.id, 'tenant-a');
    assert.equal(noHeader.resolve({ path: '/tenant-b/api/accessi' }).tenant.id, 'tenant-b');
    assert.equal(noHeader.resolve({ header: 'tenant-b' }), undefined);
    assert.equal(noHeader.resolve({ host: 'unknown.example.test', path: '/tenant-c' }), undefined);

    const withHeader = loadAccessiTenants({ directory, allowHeader: true });
    const resolution = withHeader.resolve({ header: 'tenant-b' });
    assert.deepEqual(
      { id: resolution.tenant.id, matchedBy: resolution.matchedBy },
      { id: 'tenant-b', matchedBy: 'header' },
    );
    assert.equal(withHeader.resolve({ host: 'app-a.example.test', header: 'tenant-b' }).tenant.id, 'tenant-a');
    assert.equal(withHeader.resolve({ path: '/tenant-b', header: 'tenant-a' }).tenant.id, 'tenant-b');
  } finally {
    cleanup(directory);
  }
});

test('#10: errori di isolamento e configurazione runtime', () => {
  const sharedSecret = environmentSource({
    tenant: { id: 'one', hosts: ['a.example.test'] },
    jwt: { secret: 'same-secret-0123456789-0123456789' },
  });
  const duplicate = makeDirectory({
    'one.environment.ts': sharedSecret,
    'two.environment.ts': sharedSecret.replace('"id":"one"', '"id":"two"').replace('a.example.test', 'b.example.test'),
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
    'one.environment.ts': sharedSecret,
    'two.environment.ts': environmentSource({
      tenant: { id: 'two', hosts: ['a.example.test'] },
      jwt: { secret: 'other-0123456789-0123456789' },
    }),
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
    'broken.environment.ts': `export default {
  tenant: { id: 'broken', hosts: ['broken.example.test'] },
  database: { host: '', database: '' },
  jwt: { secret: 'x'.repeat(40), expiresIn: '1h' },
  email: {},
  encryptionKey: '0123456789ABCDEF',
  confirmationEmailUrl: 'http://localhost',
  confirmationEmailReturnUrl: 'http://localhost',
};`,
  });
  try {
    assert.throws(
      () => loadAccessiTenants({ directory: missingDb }),
      (error) => error.issues.some((issue) => /database\.host obbligatorio/.test(issue)),
    );
  } finally {
    cleanup(missingDb);
  }

  const empty = makeDirectory({});
  try {
    assert.throws(() => loadAccessiTenants({ directory: empty }), /Nessun file \*\.environment\.ts/);
  } finally {
    cleanup(empty);
  }

  const sharedIssuer = makeDirectory({
    'a.environment.ts': environmentSource({ tenant: { id: 'a', hosts: ['a.example.test'] } }),
    'b.environment.ts': environmentSource({
      tenant: { id: 'b', hosts: ['b.example.test'] },
      jwt: { secret: 'b-secret-0123456789-0123456789' },
    }),
  });
  try {
    const registry = loadAccessiTenants({ directory: sharedIssuer });
    assert.ok(registry.warnings.some((warning) => /Issuer\/audience/.test(warning)));
  } finally {
    cleanup(sharedIssuer);
  }
});

test('#10: tenant disabilitati, file singolo e prefisso Redis', () => {
  const directory = makeDirectory({
    'enabled.environment.ts': environmentSource({ tenant: { id: 'enabled', hosts: ['a.example.test'] } }),
    'disabled.environment.ts': environmentSource({
      tenant: { id: 'disabled', hosts: ['b.example.test'], enabled: false },
      jwt: { secret: 'b-secret-0123456789-0123456789', issuer: 'https://b.example.test' },
    }),
  });
  try {
    const registry = loadAccessiTenants({ directory });
    assert.equal(registry.resolve({ host: 'b.example.test' }), undefined);
    assert.equal(registry.resolve({ host: 'a.example.test' }).tenant.id, 'enabled');
    assert.equal(getAccessiTenantRedisPrefix('tenant-a'), 'accessi:tenant-a:');

    const single = loadAccessiTenantEnvironmentFile(
      path.join(directory, 'enabled.environment.ts'),
    );
    assert.equal(single.tenant.id, 'enabled');
    assert.equal(single.environment.tenant.id, 'enabled');
  } finally {
    cleanup(directory);
  }
});

test('#10: CLI valida, elenca e risolve file *.environment.ts', () => {
  const directory = makeDirectory({
    'tenant-a.environment.ts': environmentSource({ tenant: { id: 'tenant-a', hosts: ['app-a.example.test'] } }),
  });
  try {
    const list = execFileSync(process.execPath, [SCRIPT, '--dir', directory, '--list'], { encoding: 'utf8' });
    const parsed = JSON.parse(list);
    assert.equal(parsed.tenants.length, 1);
    assert.equal(parsed.tenants[0].id, 'tenant-a');
    assert.match(parsed.tenants[0].file, /tenant-a\.environment\.ts$/);

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
