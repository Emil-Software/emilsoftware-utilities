require('ts-node/register/transpile-only');
require('reflect-metadata');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  accessiTenantDirectorySignature,
  createAccessiTenantSupervisor,
  waitForTenantState,
} = require('../src/accessi/server');

function environmentSource(id, hosts, extra = '') {
  return `export default {
  tenant: { id: '${id}', hosts: ${JSON.stringify(hosts)} },
  database: { host: 'db-${id}', database: '/data/${id}.fdb' },
  jwt: { secret: '${id}-secret-0123456789-0123456789', expiresIn: '1h', issuer: 'https://${id}.example.test', audience: 'accessi-api' },
  email: { host: 'localhost', port: 25, secure: false, requireTLS: false, tls: { rejectUnauthorized: false }, from: 'noreply@example.test', auth: { user: 'u', pass: 'p' } },
  encryptionKey: '0123456789ABCDEF',
  confirmationEmailUrl: 'https://${id}.example.test',
  confirmationEmailReturnUrl: 'https://${id}.example.test',
  ${extra}
};
`;
}

function makeDirectory(files) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'accessi-supervisor-'));
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(directory, name), content);
  }
  return directory;
}

function fakeProcesses() {
  let nextPid = 100;
  const processes = [];
  const spawn = (tenant, port) => {
    const listeners = [];
    const handle = {
      pid: nextPid++,
      tenantId: tenant.id,
      port,
      killed: false,
      signal: undefined,
      kill(signal) {
        this.killed = true;
        this.signal = signal;
        for (const listener of listeners.splice(0)) listener(0, signal ?? null);
        return true;
      },
      once(event, listener) {
        if (event === 'exit') listeners.push(listener);
        return this;
      },
    };
    processes.push(handle);
    return handle;
  };
  return { spawn, processes };
}

function messages() {
  const entries = [];
  return { entries, logger: (event) => entries.push(event) };
}

test('#22: avvio, tenant invariati e restart sulla stessa porta', async () => {
  const directory = makeDirectory({
    'a.environment.ts': environmentSource('a', ['a.example.test']),
    'b.environment.ts': environmentSource('b', ['b.example.test']),
  });
  const fake = fakeProcesses();
  const log = messages();
  const supervisor = createAccessiTenantSupervisor({
    directory,
    basePort: 3400,
    spawn: fake.spawn,
    logger: log.logger,
  });

  try {
    await supervisor.start();
    assert.deepEqual(supervisor.state().map((entry) => entry.id), ['a', 'b']);
    assert.deepEqual(supervisor.state().map((entry) => entry.port), [3400, 3401]);

    const firstA = fake.processes.find((entry) => entry.tenantId === 'a');
    const unchanged = await supervisor.reload();
    assert.deepEqual(unchanged, { added: [], removed: [], restarted: [], unchanged: ['a', 'b'] });
    assert.equal(firstA.killed, false);

    fs.writeFileSync(path.join(directory, 'a.environment.ts'), environmentSource('a', ['a.example.test'], 'description: "modificato"'));
    const restarted = await supervisor.reload();
    assert.deepEqual(restarted.restarted, ['a']);
    assert.equal(firstA.killed, true);
    const secondA = fake.processes.filter((entry) => entry.tenantId === 'a').at(-1);
    assert.equal(secondA.port, firstA.port);
    assert.notEqual(secondA.pid, firstA.pid);
  } finally {
    await supervisor.stop();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('#22: una configurazione invalida non tocca i tenant attivi', async () => {
  const directory = makeDirectory({
    'a.environment.ts': environmentSource('a', ['a.example.test']),
  });
  const fake = fakeProcesses();
  const log = messages();
  const supervisor = createAccessiTenantSupervisor({
    directory,
    basePort: 3500,
    spawn: fake.spawn,
    logger: log.logger,
  });

  try {
    await supervisor.start();
    const before = supervisor.state();

    fs.writeFileSync(path.join(directory, 'broken.environment.ts'), 'export default { tenant: { id: "broken" ');
    const result = await supervisor.reload();
    assert.deepEqual(result, { added: [], removed: [], restarted: [], unchanged: [] });
    assert.deepEqual(supervisor.state(), before);
    assert.equal(fake.processes[0].killed, false);
    assert.ok(log.entries.some((entry) => entry.level === 'error' && /Reload annullato/.test(entry.message)));

    fs.rmSync(path.join(directory, 'broken.environment.ts'));
    const afterFix = await supervisor.reload();
    assert.deepEqual(afterFix.unchanged, ['a']);
  } finally {
    await supervisor.stop();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('#22: aggiunta e rimozione di un tenant senza toccare gli altri', async () => {
  const directory = makeDirectory({
    'a.environment.ts': environmentSource('a', ['a.example.test']),
  });
  const fake = fakeProcesses();
  const supervisor = createAccessiTenantSupervisor({
    directory,
    basePort: 3600,
    spawn: fake.spawn,
  });

  try {
    await supervisor.start();
    fs.writeFileSync(path.join(directory, 'c.environment.ts'), environmentSource('c', ['c.example.test']));
    const added = await supervisor.reload();
    assert.deepEqual(added.added, ['c']);
    assert.deepEqual(supervisor.state().map((entry) => entry.id), ['a', 'c']);
    assert.equal(fake.processes.find((entry) => entry.tenantId === 'a').killed, false);

    fs.rmSync(path.join(directory, 'c.environment.ts'));
    const removed = await supervisor.reload();
    assert.deepEqual(removed.removed, ['c']);
    assert.deepEqual(supervisor.state().map((entry) => entry.id), ['a']);
    assert.equal(fake.processes.find((entry) => entry.tenantId === 'c').killed, true);
  } finally {
    await supervisor.stop();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('#22: watch applica una modifica senza riavvio manuale', async () => {
  const directory = makeDirectory({
    'a.environment.ts': environmentSource('a', ['a.example.test']),
  });
  const fake = fakeProcesses();
  const supervisor = createAccessiTenantSupervisor({
    directory,
    basePort: 3700,
    spawn: fake.spawn,
    pollIntervalMs: 50,
    debounceMs: 20,
  });

  try {
    await supervisor.start();
    supervisor.watch();
    fs.writeFileSync(path.join(directory, 'b.environment.ts'), environmentSource('b', ['b.example.test']));
    await waitForTenantState(supervisor, (state) => state.length === 2, 5000);
    assert.deepEqual(supervisor.state().map((entry) => entry.id).sort(), ['a', 'b']);
  } finally {
    await supervisor.stop();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('#22: la firma della cartella cambia con il contenuto e con i file', () => {
  const directory = makeDirectory({
    'a.environment.ts': environmentSource('a', ['a.example.test']),
  });
  try {
    const first = accessiTenantDirectorySignature(directory);
    assert.equal(first, accessiTenantDirectorySignature(directory));
    fs.writeFileSync(path.join(directory, 'a.environment.ts'), environmentSource('a', ['a.example.test'], 'description: "x"'));
    assert.notEqual(first, accessiTenantDirectorySignature(directory));
    fs.writeFileSync(path.join(directory, 'b.environment.ts'), environmentSource('b', ['b.example.test']));
    assert.notEqual(first, accessiTenantDirectorySignature(directory));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
