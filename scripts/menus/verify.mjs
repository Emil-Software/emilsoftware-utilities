#!/usr/bin/env node
/**
 * Verifica che i cataloghi menu delle app siano allineati al database Accessi.
 *
 * Per ogni app riporta:
 *   +  voci presenti nel catalogo (FE) e assenti nel DB  -> il DB ne ha meno
 *   ~  voci presenti in entrambi ma con campi diversi
 *   -  voci del DB nei gruppi dell'app non dichiarate nel catalogo
 *
 * A livello globale riporta i menu del DB che nessun catalogo dichiara:
 * sono le voci "in piu" del database, tipicamente legacy.
 *
 * Uso:
 *   npm run menus:verify                # tutte le app
 *   npm run menus:verify -- --app=SteX
 *   npm run menus:verify -- --strict    # fallisce anche per le voci extra del DB
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
  isAligned,
  normalizeCode,
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

const registry = loadRegistry();
const baseUrl = flag('url') ?? process.env['ACCESSI_BASE_URL'] ?? registry.defaultBaseUrl;
const strict = has('strict');
const requested = appNamesFromArgs();
const apps = requested.length > 0 ? requested.map((name) => resolveApp(registry, name)) : registry.apps;

console.log(`Verifica menu Accessi: ${baseUrl}\n`);
const credentials = await askCredentials({ email: flag('email'), password: flag('password') });
const { client, user } = await connect({ baseUrl, ...credentials });
console.log(`Autenticato come ${user?.email ?? credentials.email}\n`);

const snapshot = await fetchSnapshot(client);
const catalogs = new Map();
const union = new Set();
let problems = 0;

// Unione globale: serve a distinguere i menu "orfani" del DB dai codici
// condivisi che un'altra app dichiara nel proprio catalogo.
for (const app of apps) {
  const catalog = readCatalog(app);
  catalogs.set(app.app, catalog);
  for (const menu of catalog.menus ?? []) union.add(normalizeCode(menu.codiceMenu));
}

for (const app of apps) {
  const catalog = catalogs.get(app.app);
  const errors = validateCatalog(catalog, app.app);
  if (errors.length > 0) {
    console.log(`${app.app}: catalogo non valido`);
    for (const error of errors) console.log(`  - ${error}`);
    problems += errors.length;
    continue;
  }
  const diff = diffCatalog(catalog, snapshot);
  const feCount = catalog.menus.length;
  const aligned = isAligned(diff);
  console.log(`${app.app}: catalogo ${feCount} voci - ${aligned ? 'allineato' : 'DA ALLINEARE'}`);

  if (diff.missingScopes.length > 0) {
    console.log(`  + scope mancanti nel DB (${diff.missingScopes.length}): ${diff.missingScopes.map((s) => s.codice).join(', ')}`);
    problems += diff.missingScopes.length;
  }
  if (diff.scopeDrift.length > 0) {
    console.log(`  ~ scope con nome diverso (${diff.scopeDrift.length}): ${diff.scopeDrift.map((s) => s.code).join(', ')}`);
    problems += diff.scopeDrift.length;
  }
  if (diff.missingTypes.length > 0) {
    console.log(`  + tipi mancanti nel DB (${diff.missingTypes.length}): ${diff.missingTypes.map((t) => t.codiceTipo).join(', ')}`);
    problems += diff.missingTypes.length;
  }
  if (diff.missingGroups.length > 0) {
    console.log(`  + gruppi mancanti nel DB (${diff.missingGroups.length}): ${diff.missingGroups.map((g) => `${g.codiceGruppo} ${g.descrizioneGruppo ?? ''}`).join(', ')}`);
    problems += diff.missingGroups.length;
  }
  if (diff.missingMenus.length > 0) {
    console.log(`  + menu mancanti nel DB (${diff.missingMenus.length}): ${diff.missingMenus.map((m) => m.codiceMenu).join(', ')}`);
    problems += diff.missingMenus.length;
  }
  if (diff.typeDrift.length > 0) {
    console.log(`  ~ tipi diversi (${diff.typeDrift.length}): ${diff.typeDrift.map((t) => `${t.code} [${Object.keys(t.changes).join(',')}]`).join(', ')}`);
    problems += diff.typeDrift.length;
  }
  if (diff.groupDrift.length > 0) {
    console.log(`  ~ gruppi diversi (${diff.groupDrift.length}): ${diff.groupDrift.map((g) => `${g.code} [${Object.keys(g.changes).join(',')}]`).join(', ')}`);
    problems += diff.groupDrift.length;
  }
  if (diff.menuDrift.length > 0) {
    console.log(`  ~ menu diversi (${diff.menuDrift.length}): ${diff.menuDrift.map((m) => `${m.code} [${Object.keys(m.changes).join(',')}]`).join(', ')}`);
    problems += diff.menuDrift.length;
  }
  const realExtras = diff.extraMenus.filter((menu) => !union.has(normalizeCode(menu.codiceMenu)));
  if (realExtras.length > 0) {
    console.log(`  - menu del DB nei gruppi dell'app non in catalogo (${realExtras.length}): ${realExtras.map((m) => m.codiceMenu).join(', ')}`);
    if (strict) problems += realExtras.length;
  }
  console.log('');
}

const orphans = [...snapshot.menus.values()]
  .filter((menu) => !union.has(normalizeCode(menu.codiceMenu)))
  .sort((a, b) => a.codiceMenu.localeCompare(b.codiceMenu));

console.log('Riepilogo');
console.log(`  menu nel DB: ${snapshot.menus.size}`);
console.log(`  menu nel catalogo (unione app): ${union.size}`);
console.log(`  menu del DB non dichiarati da nessuna app: ${orphans.length}`);
if (orphans.length > 0) {
  console.log(`  orfani: ${orphans.map((m) => `${m.codiceMenu}(${m.codiceGruppo})`).join(', ')}`);
}

if (problems > 0) {
  console.log(`\nEsito: ${problems} disallineamenti. Esegui "npm run menus:init".`);
  process.exit(1);
}
console.log('\nEsito: cataloghi allineati al database.');
