#!/usr/bin/env node
/**
 * Inizializza i menu delle app Angular nel database Accessi di riferimento.
 *
 * - Chiede email e password dell'admin in console (o le legge da
 *   ACCESSI_USER / ACCESSI_PASSWORD, utile per la CI).
 * - Usa il client Orval della libreria Accessi (`login`, `createMenu`, ...).
 * - E' idempotente: crea solo cio' che manca e aggiorna solo i campi che il
 *   catalogo dichiara come diversi. Non elimina nulla.
 *
 * Uso:
 *   npm run menus:init                     # tutte le app
 *   npm run menus:init -- --app=SteX       # una sola app
 *   npm run menus:init -- --dry-run        # mostra il piano senza scrivere
 *   npm run menus:init -- --url=http://localhost:3000
 */
import {
  loadRegistry,
  resolveApp,
  readCatalog,
  validateCatalog,
  askCredentials,
  connect,
  fetchSnapshot,
  diffCatalog,
  applyCatalog,
} from './lib.mjs';

function flag(name) {
  const prefix = `--${name}=`;
  const found = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return found?.slice(prefix.length);
}

function has(name) {
  return process.argv.slice(2).includes(`--${name}`);
}

function appNamesFromArgs() {
  return process.argv
    .slice(2)
    .filter((arg) => arg.startsWith('--app='))
    .map((arg) => arg.slice('--app='.length));
}

function printActions(appName, actions) {
  if (actions.length === 0) {
    console.log(`  ${appName}: gia allineato`);
    return;
  }
  const warnings = actions.filter((action) => action.kind === 'warning');
  for (const warning of warnings) console.log(`    ! ${warning.code}: ${warning.message}`);
  const created = actions.filter((action) => action.kind === 'create');
  const updated = actions.filter((action) => action.kind === 'update');
  if (created.length > 0) {
    console.log(`  ${appName}: ${created.length} da creare`);
    for (const action of created) console.log(`    + ${action.entity} ${action.code}`);
  }
  if (updated.length > 0) {
    console.log(`  ${appName}: ${updated.length} da aggiornare`);
    for (const action of updated) {
      const fields = Object.keys(action.changes).join(', ');
      console.log(`    ~ ${action.entity} ${action.code} (${fields})`);
    }
  }
}

const registry = loadRegistry();
const baseUrl = flag('url') ?? process.env['ACCESSI_BASE_URL'] ?? registry.defaultBaseUrl;
const dryRun = has('dry-run');
const requested = appNamesFromArgs();
const apps = requested.length > 0 ? requested.map((name) => resolveApp(registry, name)) : registry.apps;

console.log(`Accessi: ${baseUrl}${dryRun ? ' (dry-run)' : ''}`);
const credentials = await askCredentials({ email: flag('email'), password: flag('password') });

const { client, user } = await connect({ baseUrl, ...credentials });
console.log(`Autenticato come ${user?.email ?? credentials.email}\n`);

const snapshot = await fetchSnapshot(client);
const failedApps = [];

for (const app of apps) {
  const catalog = readCatalog(app);
  const errors = validateCatalog(catalog, app.app);
  if (errors.length > 0) {
    console.error(`${app.app}: catalogo non valido`);
    for (const error of errors) console.error(`  - ${error}`);
    failedApps.push(app.app);
    continue;
  }
  const diff = diffCatalog(catalog, snapshot);
  const actions = await applyCatalog(client, catalog, snapshot, { dryRun });
  printActions(app.app, actions);
  if (diff.missingMenus.length > 0 && !dryRun && actions.some((a) => a.entity === 'menu' && a.kind === 'create')) {
    console.log(`    (${diff.missingMenus.length} menu creati dal catalogo)`);
  }
}

if (failedApps.length > 0) {
  console.error(`\nApp con errori: ${failedApps.join(', ')}`);
  process.exit(1);
}
console.log(dryRun ? '\nNessuna modifica scritta (dry-run).' : '\nMenu allineati.');
