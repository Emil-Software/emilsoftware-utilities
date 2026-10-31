// Gestione della cartella multi-tenant Accessi.
//
// Uso:
//   node scripts/accessi-tenants.cjs --dir ./tenants --check
//   node scripts/accessi-tenants.cjs --dir ./tenants --list
//   node scripts/accessi-tenants.cjs --dir ./tenants --resolve app.example.com /api/accessi
//   node scripts/accessi-tenants.cjs --dir ./tenants --serve --base-port 3200
//   node scripts/accessi-tenants.cjs --dir ./tenants --serve --watch
//
// `--watch` riapplica la cartella quando un *.environment.ts cambia: i tenant
// invariati non vengono riavviati, un file invalido non tocca quelli attivi.
//
// Ogni file `<id>.environment.ts` esporta un oggetto AccessiTenantEnvironment:
//   tenant, database, jwt, email, encryptionKey, URL e opzioni Accessi tipizzate.
// I segreti possono essere letti da process.env dentro il file.
//   ACCESSI_TENANT_HOSTS non serve: usare tenant.hosts/path/port nel file.
require('ts-node/register/transpile-only');
require('reflect-metadata');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const {
  createAccessiTenantSupervisor,
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
    const distRunner = path.join(repository, 'dist', 'scripts', 'startAccessiTenantService.js');
    const useDist = fs.existsSync(distRunner);
    const runner = useDist
      ? { command: process.execPath, args: [distRunner] }
      : {
          command: process.execPath,
          args: ['-r', 'ts-node/register/transpile-only', path.join(repository, 'src', 'scripts', 'startAccessiTenantService.ts')],
        };
    const host = arg('host', '127.0.0.1');
    const basePort = Number(arg('base-port', '3200'));
    const supervisor = createAccessiTenantSupervisor({
      directory,
      basePort,
      allowHeader: flag('allow-header'),
      spawn: (tenant, port) => spawn(runner.command, runner.args, {
        cwd: repository,
        stdio: 'inherit',
        env: {
          ...process.env,
          PORT: String(port),
          ACCESSI_TENANT_ENVIRONMENT: tenant.environmentFile,
          ACCESSI_TENANT_ID: tenant.id,
        },
      }),
      logger: ({ level, message }) => {
        if (level === 'error') console.error(message);
        else if (level === 'warn') console.warn(message);
        else console.log(message);
      },
    });

    await supervisor.start();
    const state = supervisor.state();
    if (state.length === 0) {
      console.warn('Nessun tenant abilitato: il supervisore resta in attesa di modifiche.');
    }
    for (const entry of state) {
      console.log(`Tenant ${entry.id}: http://${host}:${entry.port}`);
    }
    if (flag('watch')) supervisor.watch();

    let stopping = false;
    const shutdown = async (signal) => {
      if (stopping) return;
      stopping = true;
      console.log(`Ricevuto ${signal}: arresto tenant...`);
      await supervisor.stop();
      process.exit(0);
    };
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    process.on('SIGINT', () => void shutdown('SIGINT'));
    return;
  }

  // --check: la sola validazione e' gia' avvenuta.
  console.log(`Configurazione tenant valida: ${registry.tenants.length} tenant.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
