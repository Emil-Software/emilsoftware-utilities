#!/usr/bin/env node
/**
 * Rigenera il seed di sistema degli scope (`MENU_SCOPE_SEED`) dai cataloghi
 * menu delle app. La versione viene incrementata solo quando il contenuto
 * cambia, cosi un bootstrap successivo applica le nuove associazioni.
 *
 * Uso:
 *   npm run menus:seed
 *   npm run menus:seed -- --check   # CI: fallisce se il seed non e aggiornato
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT,
  loadRegistry,
  readCatalog,
  normalizeCode,
} from './lib.mjs';

const SEED_PATH = path.join(
  ROOT,
  'src',
  'accessi-module',
  'database-updates',
  'menuScopeSeed.ts',
);

const SCOPE_SEED = [
  { code: 'CENTROCONTROLLO', name: 'CentroControllo' },
  { code: 'ESGESTX', name: 'EsGestX' },
  { code: 'MAGAZTINT', name: 'Magaz-Tint' },
  { code: 'STAFFX', name: 'StaffX' },
  { code: 'STERILIX', name: 'SteriliX' },
  { code: 'STEX', name: 'SteX' },
  { code: 'TINTEMIX', name: 'TintemiX' },
];

function has(name) {
  return process.argv.slice(2).includes(`--${name}`);
}

function currentVersion() {
  if (!fs.existsSync(SEED_PATH)) return undefined;
  const match = fs.readFileSync(SEED_PATH, 'utf8').match(/MENU_SCOPE_SEED_VERSION = '([^']+)'/);
  return match?.[1];
}

function nextVersion(version) {
  const today = new Date().toISOString().slice(0, 10);
  if (!version) return `${today}.1`;
  const [date, revision] = version.split('.');
  if (date !== today) return `${today}.1`;
  return `${today}.${Number(revision ?? 0) + 1}`;
}

function build(version) {
  const scopes = new Map();
  for (const app of loadRegistry().apps) {
    const catalog = readCatalog(app);
    for (const menu of catalog.menus ?? []) {
      const code = normalizeCode(menu.codiceMenu);
      if (!scopes.has(code)) scopes.set(code, new Set());
      for (const scope of menu.scopes ?? []) scopes.get(code).add(normalizeCode(scope));
    }
  }

  const lines = [];
  lines.push('/**');
  lines.push(' * Seed di sistema degli scope applicativi.');
  lines.push(' *');
  lines.push(' * Generato dai cataloghi menu delle app (`menus/menu-catalog.json`):');
  lines.push(' * un menu puo appartenere a piu scope. Non modificare a mano: rigenerare');
  lines.push(' * con `npm run menus:seed` e incrementare MENU_SCOPE_SEED_VERSION.');
  lines.push(' */');
  lines.push('');
  lines.push(`export const MENU_SCOPE_SEED_VERSION = '${version}';`);
  lines.push('');
  lines.push('export interface ScopeSeed {');
  lines.push('  code: string;');
  lines.push('  name: string;');
  lines.push('}');
  lines.push('');
  lines.push('export const SCOPE_SEED: readonly ScopeSeed[] = [');
  for (const scope of SCOPE_SEED) lines.push(`  { code: '${scope.code}', name: '${scope.name}' },`);
  lines.push('];');
  lines.push('');
  lines.push('/** menu -> scope applicativi */');
  lines.push('export const MENU_SCOPE_SEED: Readonly<Record<string, readonly string[]>> = {');
  for (const code of [...scopes.keys()].sort()) {
    const list = [...scopes.get(code)].sort();
    lines.push(`  ${code}: [${list.map((scope) => `'${scope}'`).join(', ')}],`);
  }
  lines.push('};');
  lines.push('');
  return lines.join('\n');
}

const current = fs.existsSync(SEED_PATH) ? fs.readFileSync(SEED_PATH, 'utf8') : '';
const version = currentVersion();
const generated = build(version ?? nextVersion());
if (current === generated) {
  console.log('menuScopeSeed.ts: aggiornato');
  process.exit(0);
}

if (has('check')) {
  console.error('menuScopeSeed.ts non aggiornato: esegui npm run menus:seed');
  process.exit(1);
}

const next = version ? nextVersion(version) : nextVersion();
fs.writeFileSync(SEED_PATH, build(next), 'utf8');
console.log(`menuScopeSeed.ts: aggiornato (${next})`);
