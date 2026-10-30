// Gestione della cartella multi-tenant Accessi.
//
// Uso:
//   node scripts/accessi-tenants.cjs --dir ./tenants --check
//   node scripts/accessi-tenants.cjs --dir ./tenants --list
//   node scripts/accessi-tenants.cjs --dir ./tenants --resolve app.example.com /api/accessi
//   node scripts/accessi-tenants.cjs --dir ./tenants --serve --base-port 3200
//
// Ogni file `<id>.env` contiene le normali variabili ACCESSI_* del tenant piu':
//   ACCESSI_TENANT_HOSTS=app.example.com,www.example.com
//   ACCESSI_TENANT_PATH=/tenant-a
//   ACCESSI_TENANT_PORT=3201
//   ACCESSI_TENANT_ENABLED=true
require('ts-node/register/transpile-only');
require('reflect-metadata');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const {
  loadAccessiTenants,
} = require('../src/accessi/server');

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function flag(name) {
  return process.argv.includes(`--${name}`);
}

async function main() {
  const directory = arg('dir', process.env.ACCESSI_TENANTS_DIR ?? './tenants');
  let registry;
  try {
    registry = loadAccessiTenants({
      directory,
      allowHeader: flag('allow-header'),
    });
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }

  for (const warning of registry.warnings) console.warn(`ATTENZIONE: ${warning}`);

  if (flag('list') || (!flag('resolve') && !flag('serve') && !flag('check'))) {
    console.log(JSON.stringify({ directory: registry.directory, tenants: registry.summary() }, null, 2));
    return;
  }

  if (flag('resolve')) {
    let host = arg('host');
    if (!host) {
      const index = process.argv.indexOf('--resolve');
      host = process.argv[index + 1];
    }
    const path = arg('path', '/');
    const resolution = registry.resolve({ host, path }, { allowHeader: flag('allow-header') });
    if (!resolution) {
      console.error('Nessun tenant corrisponde alla richiesta.');
      process.exit(1);
    }
    console.log(JSON.stringify({ id: resolution.tenant.id, matchedBy: resolution.matchedBy }, null, 2));
    return;
  }

  if (flag('serve')) {
    const repository = path.resolve(__dirname, '..');
    const distRunner = path.join(repository, 'dist', 'scripts', 'startAccessiService.js');
    const useDist = fs.existsSync(distRunner);
    const runner = useDist
      ? { command: process.execPath, args: [distRunner] }
      : {
          command: process.execPath,
          args: ['-r', 'ts-node/register/transpile-only', path.join(repository, 'src', 'scripts', 'startAccessiService.ts')],
        };
    const host = arg('host', '127.0.0.1');
    const basePort = Number(arg('base-port', '3200'));
    const children = [];
    let stopping = false;

    for (const [index, tenant] of registry.tenants.filter((entry) => entry.enabled).entries()) {
      const port = tenant.port ?? basePort + index;
      const child = spawn(runner.command, runner.args, {
        cwd: repository,
        stdio: 'inherit',
        env: {
          ...process.env,
          ...tenant.env,
          PORT: String(port),
          ACCESSI_TENANT_ID: tenant.id,
        },
      });
      children.push({ tenant, child, port });
      console.log(`Tenant ${tenant.id}: http://${host}:${port} (pid ${child.pid})`);
      child.on('exit', (code, signal) => {
        console.error(`Tenant ${tenant.id} terminato (code=${code}, signal=${signal}).`);
        if (!stopping) process.exitCode = 1;
      });
    }

    const shutdown = async (signal) => {
      if (stopping) return;
      stopping = true;
      console.log(`Ricevuto ${signal}: arresto tenant...`);
      for (const { child } of children) child.kill('SIGTERM');
      setTimeout(() => {
        for (const { child } of children) child.kill('SIGKILL');
        process.exit(0);
      }, 10_000).unref();
    };
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    process.on('SIGINT', () => void shutdown('SIGINT'));

    // Il supervisore resta attivo finche ci sono figli; se un tenant termina,
    // systemd/docker/il gestore di processo lo riavvia. Non riavviare in automatico
    // evita loop su una configurazione rotta.
    const checkAllExited = setInterval(() => {
      if (children.every(({ child }) => child.exitCode !== null || child.signalCode !== null)) {
        clearInterval(checkAllExited);
        process.exitCode = 1;
      }
    }, 2_000);
    checkAllExited.unref();
    return;
  }

  // --check: la sola validazione e' gia' avvenuta.
  console.log(`Configurazione tenant valida: ${registry.tenants.length} tenant.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
