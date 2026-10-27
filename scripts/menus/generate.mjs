#!/usr/bin/env node
/**
 * Genera i file TypeScript tipizzati dei cataloghi menu.
 *
 * Il JSON resta la fonte di verita'; il TS serve al codice dell'app
 * (`MENU.MNUMAIN`, `MENU_CODES`, `MENU_BY_CODE`).
 *
 * Uso:
 *   npm run menus:generate
 *   npm run menus:generate -- --app=SteX
 *   npm run menus:generate -- --check   # CI: fallisce se il TS non e aggiornato
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  loadRegistry,
  resolveApp,
  readCatalog,
  validateCatalog,
  appPaths,
  buildGeneratedTs,
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
const requested = appNamesFromArgs();
const apps = requested.length > 0 ? requested.map((name) => resolveApp(registry, name)) : registry.apps;
const checkOnly = has('check');
let failures = 0;

for (const app of apps) {
  const catalog = readCatalog(app);
  const errors = validateCatalog(catalog, app.app, app.scope?.codice);
  if (errors.length > 0) {
    console.error(`${app.app}: catalogo non valido`);
    for (const error of errors) console.error(`  - ${error}`);
    failures += 1;
    continue;
  }

  const paths = appPaths(app);
  const expected = buildGeneratedTs(app, catalog);
  const current = fs.existsSync(paths.generated) ? fs.readFileSync(paths.generated, 'utf8') : '';

  if (checkOnly) {
    if (current !== expected) {
      console.error(`${app.app}: ${paths.generated} non aggiornato (esegui npm run menus:generate)`);
      failures += 1;
    } else {
      console.log(`${app.app}: ok`);
    }
    continue;
  }

  fs.mkdirSync(path.dirname(paths.generated), { recursive: true });
  fs.writeFileSync(paths.generated, expected, 'utf8');
  console.log(`${app.app}: ${paths.generated.replace(/\\/g, '/')}`);
}

if (failures > 0) process.exit(1);
