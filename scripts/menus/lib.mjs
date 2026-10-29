/**
 * Libreria condivisa per il catalogo menu Accessi.
 *
 * Il catalogo vive in ogni app Angular (`menus/menu-catalog.json`) e contiene
 * solo cio' che serve: gruppi, tipi e voci di menu. Le voci sono la copia
 * esatta del database Accessi di riferimento, piu' le voci nuove che l'app
 * dichiara nel proprio codice.
 *
 * I comandi che usano questa libreria sono:
 *   node scripts/menus/init.mjs     crea/aggiorna i menu nel DB (idempotente)
 *   node scripts/menus/verify.mjs   confronta catalogo e DB
 *   node scripts/menus/generate.mjs genera il file TS tipizzato
 *   node scripts/menus/bootstrap.mjs ricostruisce i cataloghi da DB + codice FE
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const REGISTRY_PATH = path.join(ROOT, 'menus', 'apps.json');

const require = createRequire(import.meta.url);

/** Codici validi: maiuscole, cifre, underscore; il primo carattere e' una lettera. */
const CODE_RE = /^[A-Z][A-Z0-9_]{0,19}$/;
/** Chiave TypeScript valida (i codici Accessi lo sono sempre). */
const IDENTIFIER_RE = /^[A-Z_][A-Z0-9_]*$/;

export const LIMITS = {
  codiceMenu: 20,
  descrizioneMenu: 100,
  pagina: 50,
  icona: 50,
  codiceGruppo: 1,
  codiceTipo: 1,
  note: 1000,
};

/**
 * Scope applicativo dichiarato dall'environment del frontend.
 *
 * L'environment (`src/environments/environment*.ts`) e' la fonte unica del
 * codice scope: il catalogo menu deve dichiararlo e ogni menu deve
 * appartenerci. Il registro apps.json resta solo per i percorsi e il nome.
 */
export function readEnvironmentScope(app) {
  const { root } = appPaths(app);
  const envDir = path.join(root, 'src', 'environments');
  const candidates = fs.existsSync(envDir)
    ? fs.readdirSync(envDir).filter((name) => /^environment.*\.ts$/.test(name))
    : [];
  for (const name of candidates) {
    const contents = fs.readFileSync(path.join(envDir, name), 'utf8');
    const match = contents.match(/accessiScope\s*:\s*'([A-Z][A-Z0-9_]{0,19})'/);
    if (match) return normalizeCode(match[1]);
  }
  return undefined;
}

export function loadRegistry() {
  const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));
  for (const app of registry.apps) {
    const envScope = readEnvironmentScope(app);
    if (envScope) {
      app.scope = { codice: envScope, nome: app.scope?.nome ?? app.app };
    }
  }
  return registry;
}

export function resolveApp(registry, appName) {
  const app = registry.apps.find((entry) => entry.app.toLowerCase() === appName.toLowerCase());
  if (!app) {
    throw new Error(
      `App sconosciuta: "${appName}". Disponibili: ${registry.apps.map((a) => a.app).join(', ')}`,
    );
  }
  return app;
}

export function appPaths(app) {
  const root = path.resolve(ROOT, app.folder);
  return {
    root,
    catalog: path.join(root, app.catalog),
    generated: path.join(root, app.generated),
  };
}

export function readCatalog(app) {
  const { catalog } = appPaths(app);
  if (!fs.existsSync(catalog)) {
    throw new Error(`Catalogo mancante: ${catalog}. Esegui prima "npm run menus:bootstrap".`);
  }
  return JSON.parse(fs.readFileSync(catalog, 'utf8'));
}

export function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function normalizeCode(value) {
  return String(value ?? '').trim().toUpperCase();
}

/**
 * Valida il catalogo di un'app. Restituisce la lista degli errori invece di
 * lanciare, cosi' verify puo' mostrarli tutti insieme.
 */
export function validateCatalog(catalog, appName, envScope) {
  const errors = [];
  if (!catalog || typeof catalog !== 'object') {
    return ['il catalogo non e un oggetto'];
  }
  if (catalog.app !== appName) {
    errors.push(`"app" deve essere "${appName}" (trovato "${catalog.app}")`);
  }

  const groups = Array.isArray(catalog.groups) ? catalog.groups : [];
  const types = Array.isArray(catalog.menuTypes) ? catalog.menuTypes : [];
  const menus = Array.isArray(catalog.menus) ? catalog.menus : [];

  const scopeCodes = new Set();
  for (const scope of Array.isArray(catalog.scopes) ? catalog.scopes : []) {
    const code = normalizeCode(scope.codice);
    if (!IDENTIFIER_RE.test(code) || code.length > 20) {
      errors.push(`scope "${scope.codice}": codice non valido`);
    }
    if (scopeCodes.has(code)) errors.push(`scope duplicato: ${code}`);
    scopeCodes.add(code);
    if (!String(scope.nome ?? '').trim()) errors.push(`scope ${code}: nome mancante`);
  }
  if (scopeCodes.size === 0) errors.push('catalog.scopes mancante');
  if (envScope && !scopeCodes.has(envScope)) {
    errors.push(`accessiScope "${envScope}" non dichiarato in catalog.scopes`);
  }

  const groupCodes = new Set();
  for (const group of groups) {
    const code = normalizeCode(group.codiceGruppo);
    if (code.length !== 1) errors.push(`gruppo "${group.codiceGruppo}": codice non valido (1 carattere)`);
    if (groupCodes.has(code)) errors.push(`gruppo duplicato: ${code}`);
    groupCodes.add(code);
    if (group.descrizioneGruppo && group.descrizioneGruppo.length > 100) {
      errors.push(`gruppo ${code}: descrizione oltre 100 caratteri`);
    }
  }

  const typeCodes = new Set();
  for (const type of types) {
    const code = normalizeCode(type.codiceTipo);
    if (code.length !== 1) errors.push(`tipo "${type.codiceTipo}": codice non valido (1 carattere)`);
    if (typeCodes.has(code)) errors.push(`tipo duplicato: ${code}`);
    typeCodes.add(code);
    if (type.descrizioneTipo && type.descrizioneTipo.length > 20) {
      errors.push(`tipo ${code}: descrizione oltre 20 caratteri`);
    }
  }

  const menuCodes = new Set();
  for (const menu of menus) {
    const code = normalizeCode(menu.codiceMenu);
    if (!CODE_RE.test(code)) {
      errors.push(`menu "${menu.codiceMenu}": codice non valido (${LIMITS.codiceMenu} caratteri max, A-Z 0-9 _)`);
    }
    if (!IDENTIFIER_RE.test(code)) {
      errors.push(`menu "${code}": non e un identificatore TypeScript valido`);
    }
    if (menuCodes.has(code)) errors.push(`menu duplicato: ${code}`);
    menuCodes.add(code);
    if (!menu.descrizioneMenu) errors.push(`menu ${code}: descrizione mancante`);
    else if (menu.descrizioneMenu.length > LIMITS.descrizioneMenu) {
      errors.push(`menu ${code}: descrizione oltre ${LIMITS.descrizioneMenu} caratteri`);
    }
    const group = normalizeCode(menu.codiceGruppo);
    if (group.length !== 1) errors.push(`menu ${code}: codiceGruppo non valido`);
    if (!groupCodes.has(group)) {
      errors.push(`menu ${code}: gruppo "${group}" non dichiarato in "groups"`);
    }
    const type = normalizeCode(menu.tipo);
    if (type.length !== 1) errors.push(`menu ${code}: tipo non valido`);
    if (!typeCodes.has(type)) {
      errors.push(`menu ${code}: tipo "${type}" non dichiarato in "menuTypes"`);
    }
    if (menu.pagina && menu.pagina.length > LIMITS.pagina) {
      errors.push(`menu ${code}: pagina oltre ${LIMITS.pagina} caratteri`);
    }
    if (menu.icona && menu.icona.length > LIMITS.icona) {
      errors.push(`menu ${code}: icona oltre ${LIMITS.icona} caratteri`);
    }
    if (menu.note && menu.note.length > LIMITS.note) {
      errors.push(`menu ${code}: note oltre ${LIMITS.note} caratteri`);
    }
    const menuScopes = Array.isArray(menu.scopes) ? menu.scopes.map(normalizeCode) : [];
    if (menuScopes.length === 0) errors.push(`menu ${code}: scopes mancanti`);
    for (const scope of menuScopes) {
      if (!scopeCodes.has(scope)) errors.push(`menu ${code}: scope "${scope}" non dichiarato`);
    }
    if (envScope && !menuScopes.includes(envScope)) {
      errors.push(`menu ${code}: manca lo scope dell'app "${envScope}"`);
    }
  }

  return errors;
}

/** Installa un fetch che risolve gli URL relativi del client Orval sulla base scelta. */
export function installFetchBase(baseUrl) {
  const base = new URL(baseUrl);
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    if (typeof input === 'string' && input.startsWith('/')) {
      return nativeFetch(new URL(input, base), init);
    }
    return nativeFetch(input, init);
  };
}

export function loadOrvalClient() {
  const clientPath = path.join(
    ROOT,
    'dist',
    'accessi-module',
    'Console',
    'generated',
    'accessiApi.js',
  );
  if (!fs.existsSync(clientPath)) {
    throw new Error('Client Orval non compilato: esegui "npm run build" in emilsoftware-utilities.');
  }
  const fetchPath = path.join(ROOT, 'dist', 'accessi-module', 'Console', 'accessiFetch.js');
  const api = require(clientPath);
  const mutator = fs.existsSync(fetchPath) ? require(fetchPath) : {};
  return { ...api, setAccessiConsoleToken: mutator.setAccessiConsoleToken };
}

export async function askCredentials(options = {}) {
  const email = options.email ?? process.env['ACCESSI_USER'];
  const password = options.password ?? process.env['ACCESSI_PASSWORD'];
  if (email && password) return { email, password };

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answerEmail = email ?? (await rl.question('Email admin Accessi: '));
    const answerPassword = password ?? (await askHidden('Password: '));
    return { email: answerEmail.trim(), password: answerPassword };
  } finally {
    rl.close();
  }
}

async function askHidden(prompt) {
  if (!process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      return await rl.question(prompt);
    } finally {
      rl.close();
    }
  }
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    let value = '';
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    const onData = (char) => {
      if (char === '\r' || char === '\n') {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(value);
        return;
      }
      if (char === '\u0003') {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener('data', onData);
        process.stdout.write('\n');
        process.exit(130);
      }
      if (char === '\u007f' || char === '\b') {
        value = value.slice(0, -1);
        return;
      }
      value += char;
    };
    stdin.on('data', onData);
  });
}

/** Autentica l'admin e restituisce il client Orval pronto all'uso. */
export async function connect({ baseUrl, email, password }) {
  installFetchBase(baseUrl);
  const client = loadOrvalClient();
  const response = await client.login({ email, password });
  const token = response?.data?.Result?.token?.value;
  if (!token) {
    const message = response?.data?.Message ?? 'login senza token';
    throw new Error(`Login Accessi fallito: ${message}`);
  }
  client.setAccessiConsoleToken(token);
  return { client, user: response.data.Result.utente };
}

/** Fotografia del catalogo Accessi: menu, gruppi e tipi. */
export async function fetchSnapshot(client) {
  const [menusResponse, groupsResponse, typesResponse, scopesResponse] = await Promise.all([
    client.getMenus(),
    client.getGroupsWithMenus({ includeDisabled: true }),
    client.getMenuTypes(),
    client.getScopes(),
  ]);

  const menus = new Map();
  for (const menu of menusResponse.data.Result ?? []) {
    menus.set(normalizeCode(menu.codiceMenu), menu);
  }
  const groups = new Map();
  for (const group of groupsResponse.data.Result ?? []) {
    groups.set(normalizeCode(group.codiceGruppo), group);
  }
  const types = new Map();
  for (const type of typesResponse.data.Result ?? []) {
    types.set(normalizeCode(type.codiceTipo), type);
  }
  const scopes = new Map();
  for (const scope of scopesResponse.data.Result ?? []) {
    scopes.set(normalizeCode(scope.codice), scope);
  }
  return { menus, groups, types, scopes };
}

function text(value) {
  return value === undefined || value === null ? '' : String(value);
}

/**
 * Confronta una voce di catalogo con la riga del DB.
 * Restituisce solo i campi che il catalogo dichiara e che differiscono.
 * Un campo assente dal catalogo non viene toccato.
 */
export function diffMenu(desired, actual) {
  const changes = {};
  const compare = (field, normalize = text) => {
    if (desired[field] === undefined) return;
    if (normalize(desired[field]) !== normalize(actual[field])) {
      changes[field] = desired[field];
    }
  };
  compare('descrizioneMenu');
  compare('codiceGruppo');
  compare('tipo');
  compare('icona');
  compare('pagina');
  compare('rifMenu');
  compare('note');
  compare('ordineMenu', (value) => Number(value ?? 0));
  if (desired.enabled !== undefined && Boolean(desired.enabled) !== Boolean(actual.enabled ?? true)) {
    changes.enabled = Boolean(desired.enabled);
  }
  return changes;
}

export function diffGroup(desired, actual) {
  const changes = {};
  if (
    desired.descrizioneGruppo !== undefined &&
    text(desired.descrizioneGruppo) !== text(actual.descrizioneGruppo)
  ) {
    changes.descrizioneGruppo = desired.descrizioneGruppo;
  }
  if (desired.ordineGruppo !== undefined && Number(desired.ordineGruppo) !== Number(actual.ordineGruppo ?? 0)) {
    changes.ordineGruppo = Number(desired.ordineGruppo);
  }
  if (desired.enabled !== undefined && Boolean(desired.enabled) !== Boolean(actual.enabled ?? true)) {
    changes.enabled = Boolean(desired.enabled);
  }
  return changes;
}

export function diffType(desired, actual) {
  const changes = {};
  if (desired.descrizioneTipo !== undefined && text(desired.descrizioneTipo) !== text(actual.descrizioneTipo)) {
    changes.descrizioneTipo = desired.descrizioneTipo;
  }
  return changes;
}

/** Confronto completo catalogo/DB per una singola app. */
export function diffCatalog(catalog, snapshot) {
  const missingScopes = [];
  const scopeDrift = [];
  for (const scope of catalog.scopes ?? []) {
    const code = normalizeCode(scope.codice);
    const actual = snapshot.scopes.get(code);
    if (!actual) {
      missingScopes.push(scope);
      continue;
    }
    if (text(actual.nome) !== text(scope.nome)) {
      scopeDrift.push({ code, changes: { nome: scope.nome }, actual });
    }
  }

  const missingTypes = [];
  const typeDrift = [];
  for (const type of catalog.menuTypes ?? []) {
    const code = normalizeCode(type.codiceTipo);
    const actual = snapshot.types.get(code);
    if (!actual) {
      missingTypes.push(type);
      continue;
    }
    const changes = diffType(type, actual);
    if (Object.keys(changes).length > 0) typeDrift.push({ code, changes, actual });
  }

  const missingGroups = [];
  const groupDrift = [];
  for (const group of catalog.groups ?? []) {
    const code = normalizeCode(group.codiceGruppo);
    const actual = snapshot.groups.get(code);
    if (!actual) {
      missingGroups.push(group);
      continue;
    }
    const changes = diffGroup(group, actual);
    if (Object.keys(changes).length > 0) groupDrift.push({ code, changes, actual });
  }

  const missingMenus = [];
  const menuDrift = [];
  for (const menu of catalog.menus ?? []) {
    const code = normalizeCode(menu.codiceMenu);
    const actual = snapshot.menus.get(code);
    if (!actual) {
      missingMenus.push(menu);
      continue;
    }
    const changes = diffMenu(menu, actual);
    if (Object.keys(changes).length > 0) menuDrift.push({ code, changes, actual });
  }

  const catalogCodes = new Set((catalog.menus ?? []).map((menu) => normalizeCode(menu.codiceMenu)));
  const anyOwnedFlag = (catalog.groups ?? []).some((group) => group.owned !== undefined);
  const catalogGroups = new Set(
    (catalog.groups ?? [])
      .filter((group) => !anyOwnedFlag || group.owned === true)
      .map((group) => normalizeCode(group.codiceGruppo)),
  );
  const extraMenus = [];
  for (const [code, menu] of snapshot.menus) {
    if (!catalogGroups.has(normalizeCode(menu.codiceGruppo))) continue;
    if (!catalogCodes.has(code)) extraMenus.push(menu);
  }

  return {
    missingScopes,
    scopeDrift,
    missingTypes,
    typeDrift,
    missingGroups,
    groupDrift,
    missingMenus,
    menuDrift,
    extraMenus: extraMenus.sort((a, b) => a.codiceMenu.localeCompare(b.codiceMenu)),
  };
}

export function isAligned(diff) {
  return (
    diff.missingScopes.length === 0 &&
    diff.scopeDrift.length === 0 &&
    diff.missingTypes.length === 0 &&
    diff.typeDrift.length === 0 &&
    diff.missingGroups.length === 0 &&
    diff.groupDrift.length === 0 &&
    diff.missingMenus.length === 0 &&
    diff.menuDrift.length === 0
  );
}

function menuPayload(menu, groupCode) {
  const payload = {
    codiceMenu: normalizeCode(menu.codiceMenu),
    descrizioneMenu: menu.descrizioneMenu,
    codiceGruppo: groupCode,
    tipo: normalizeCode(menu.tipo),
    enabled: menu.enabled ?? true,
    ordineMenu: Number(menu.ordineMenu ?? 0),
  };
  if (menu.icona) payload.icona = menu.icona;
  if (menu.pagina) payload.pagina = menu.pagina;
  if (menu.rifMenu) payload.rifMenu = menu.rifMenu;
  if (menu.note) payload.note = menu.note;
  return payload;
}

/**
 * Applica il catalogo al DB: crea cio' che manca e aggiorna solo i campi
 * dichiarati che differiscono. Non elimina nulla (nessun --prune implicito).
 */
async function syncMenuScopes(client, code, desiredScopes, snapshot, actions, dryRun) {
  if (desiredScopes.length === 0) return;
  const response = await client.getMenuScopes(code);
  const existing = new Set((response?.data?.Result ?? []).map(normalizeCode));
  const missing = desiredScopes.filter((scope) => !existing.has(scope));
  if (missing.length === 0) return;
  const merged = [...existing, ...missing];
  actions.push({ kind: 'update', entity: 'menu-scopes', code, changes: { scopes: merged } });
  if (dryRun) return;
  await client.setMenuScopes(code, { scopes: merged });
}

/**
 * Riallinea gli scope dell'applicazione: lo scope dell'app viene staccato dai
 * menu che non sono piu' nel catalogo, cosi un utente dell'app non riceve per
 * errore menu di altre applicazioni. Gli scope delle altre app sui menu
 * condivisi non vengono toccati.
 */
async function reconcileMenuScopes(client, catalog, actions, dryRun) {
  const scopeCodes = (catalog.scopes ?? []).map((scope) => normalizeCode(scope.codice));
  if (scopeCodes.length === 0) return;
  const catalogCodes = new Set((catalog.menus ?? []).map((menu) => normalizeCode(menu.codiceMenu)));
  const response = await client.getMenus({ scope: scopeCodes.join(',') });
  const scoped = new Set((response?.data?.Result ?? []).map((menu) => normalizeCode(menu.codiceMenu)));
  for (const code of scoped) {
    if (!code || catalogCodes.has(code)) continue;
    const current = await client.getMenuScopes(code);
    const existing = (current?.data?.Result ?? []).map(normalizeCode);
    const remaining = existing.filter((scope) => !scopeCodes.includes(scope));
    if (remaining.length === existing.length) continue;
    actions.push({ kind: 'detach', entity: 'menu-scopes', code, changes: { scopes: remaining } });
    if (dryRun) continue;
    await client.setMenuScopes(code, { scopes: remaining });
  }
}

export async function applyCatalog(client, catalog, snapshot, options = {}) {
  const dryRun = options.dryRun === true;
  const actions = [];
  for (const scope of catalog.scopes ?? []) {
    const code = normalizeCode(scope.codice);
    const actual = snapshot.scopes.get(code);
    if (!actual) {
      actions.push({ kind: 'create', entity: 'scope', code });
      if (!dryRun) {
        await client.createScope({ codice: code, nome: scope.nome });
        snapshot.scopes.set(code, { codice: code, nome: scope.nome });
      }
      continue;
    }
    if (text(actual.nome) !== text(scope.nome)) {
      actions.push({ kind: 'update', entity: 'scope', code, changes: { nome: scope.nome } });
      if (!dryRun) {
        await client.updateScope(code, { nome: scope.nome });
        snapshot.scopes.set(code, { ...actual, nome: scope.nome });
      }
    }
  }
  const groupCodes = new Map(
    (catalog.groups ?? []).map((group) => [normalizeCode(group.codiceGruppo), normalizeCode(group.codiceGruppo)]),
  );

  for (const type of catalog.menuTypes ?? []) {
    const code = normalizeCode(type.codiceTipo);
    if (!snapshot.types.has(code)) {
      actions.push({ kind: 'create', entity: 'type', code });
      if (dryRun) continue;
      await client.createMenuType({
        codiceTipo: code,
        ...(type.descrizioneTipo ? { descrizioneTipo: type.descrizioneTipo } : {}),
      });
      snapshot.types.set(code, { ...type, codiceTipo: code });
      continue;
    }
    const actual = snapshot.types.get(code);
    const changes = diffType(type, actual);
    if (Object.keys(changes).length > 0) {
      actions.push({ kind: 'update', entity: 'type', code, changes });
      if (dryRun) continue;
      await client.updateMenuType(code, changes);
      snapshot.types.set(code, { ...actual, ...changes });
    }
  }

  for (const group of catalog.groups ?? []) {
    const code = normalizeCode(group.codiceGruppo);
    if (!snapshot.groups.has(code)) {
      actions.push({ kind: 'create', entity: 'group', code });
      if (dryRun) continue;
      try {
        await client.createMenuGroup({
          codiceGruppo: code,
          ...(group.descrizioneGruppo ? { descrizioneGruppo: group.descrizioneGruppo } : {}),
          ...(group.ordineGruppo !== undefined ? { ordineGruppo: Number(group.ordineGruppo) } : {}),
          ...(group.enabled !== undefined ? { enabled: Boolean(group.enabled) } : {}),
        });
      } catch (error) {
        // L'API non elenca i gruppi vuoti: un gruppo creato in un'esecuzione
        // precedente ma ancora senza menu risulta "inesistente". Se il DB dice
        // che c'e gia', e' idempotente andare avanti.
        if (!/esiste gia/i.test(String(error?.message ?? ''))) throw error;
      }
      snapshot.groups.set(code, {
        codiceGruppo: code,
        descrizioneGruppo: group.descrizioneGruppo ?? '',
        ordineGruppo: Number(group.ordineGruppo ?? 0),
        enabled: group.enabled ?? true,
        menus: [],
      });
      continue;
    }
    const actual = snapshot.groups.get(code);
    const changes = diffGroup(group, actual);
    if (Object.keys(changes).length > 0) {
      actions.push({ kind: 'update', entity: 'group', code, changes });
      if (dryRun) continue;
      await client.updateMenuGroup(code, changes);
      snapshot.groups.set(code, { ...actual, ...changes });
    }
  }

  const pageOwners = new Map();
  for (const menu of snapshot.menus.values()) {
    const page = normalizeCode(menu.pagina);
    if (page) pageOwners.set(page, normalizeCode(menu.codiceMenu));
  }

  for (const menu of catalog.menus ?? []) {
    const code = normalizeCode(menu.codiceMenu);
    const groupCode = normalizeCode(menu.codiceGruppo);
    if (!groupCodes.has(groupCode)) {
      throw new Error(`Menu ${code}: gruppo ${groupCode} assente dal catalogo.`);
    }
    const actual = snapshot.menus.get(code);
    if (!actual) {
      const payload = menuPayload(menu, groupCode);
      const page = normalizeCode(payload.pagina);
      if (page && pageOwners.has(page) && pageOwners.get(page) !== code) {
        actions.push({
          kind: 'warning',
          entity: 'menu',
          code,
          message: `pagina "${payload.pagina}" gia usata da ${pageOwners.get(page)}: menu creato senza pagina`,
        });
        delete payload.pagina;
      }
      actions.push({ kind: 'create', entity: 'menu', code });
      if (!dryRun) {
        await client.createMenu(payload);
        snapshot.menus.set(code, payload);
        if (page) pageOwners.set(page, code);
      }
      await syncMenuScopes(client, code, (menu.scopes ?? []).map(normalizeCode), snapshot, actions, dryRun);
      continue;
    }
    const changes = diffMenu(menu, actual);
    if (changes.pagina) {
      const page = normalizeCode(changes.pagina);
      if (pageOwners.has(page) && pageOwners.get(page) !== code) {
        actions.push({
          kind: 'warning',
          entity: 'menu',
          code,
          message: `pagina "${changes.pagina}" gia usata da ${pageOwners.get(page)}: pagina non aggiornata`,
        });
        delete changes.pagina;
      }
    }
    if (Object.keys(changes).length > 0) {
      actions.push({ kind: 'update', entity: 'menu', code, changes });
      if (dryRun) continue;
      await client.updateMenu(code, changes);
      snapshot.menus.set(code, { ...actual, ...changes });
      if (changes.pagina) pageOwners.set(normalizeCode(changes.pagina), code);
    }
    await syncMenuScopes(client, code, (menu.scopes ?? []).map(normalizeCode), snapshot, actions, dryRun);
  }

  await reconcileMenuScopes(client, catalog, actions, dryRun);

  return actions;
}

/** Nome leggibile per un codice nuovo: `WIDGET_CONTA_CLIENTI` -> "Widget conta clienti". */
export function humanize(code) {
  const words = normalizeCode(code)
    .replace(/^(MENU|WIDGET|ABIL|COL|INV|WHIDE|W)_?/, '')
    .toLowerCase()
    .split(/_+/)
    .filter(Boolean);
  if (words.length === 0) return code;
  return words[0].charAt(0).toUpperCase() + words[0].slice(1) + (words.length > 1 ? ` ${words.slice(1).join(' ')}` : '');
}

function escapeTs(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/** Genera il contenuto del file TypeScript tipizzato del catalogo. */
export function buildGeneratedTs(app, catalog) {
  const groups = [...(catalog.groups ?? [])].sort(
    (a, b) => Number(a.ordineGruppo ?? 0) - Number(b.ordineGruppo ?? 0),
  );
  const groupByCode = new Map(groups.map((group) => [normalizeCode(group.codiceGruppo), group]));
  const menus = [...(catalog.menus ?? [])].sort((a, b) => {
    const groupA = normalizeCode(a.codiceGruppo);
    const groupB = normalizeCode(b.codiceGruppo);
    const orderA = Number(groupByCode.get(groupA)?.ordineGruppo ?? 0);
    const orderB = Number(groupByCode.get(groupB)?.ordineGruppo ?? 0);
    if (orderA !== orderB) return orderA - orderB;
    if (groupA !== groupB) return groupA.localeCompare(groupB);
    return Number(a.ordineMenu ?? 0) - Number(b.ordineMenu ?? 0) || a.codiceMenu.localeCompare(b.codiceMenu);
  });

  const lines = [];
  lines.push('/**');
  lines.push(' * Catalogo menu dell\'applicazione, generato da `menus/menu-catalog.json`.');
  lines.push(' *');
  lines.push(' * NON modificare a mano: usare `npm run menus:generate`.');
  lines.push(' * Le voci sono tipizzate con i modelli Orval di Accessi, quindi `MENU.FOO`');
  lines.push(' * espone direttamente il `MenuEntity` salvato nel database.');
  lines.push(' */');
  const modelsImport = catalog.modelsImport ?? app.modelsImport;
  lines.push(`import type { GroupWithMenusEntity, MenuEntity, MenuTypeEntity, ScopeEntity } from '${modelsImport}';`);
  lines.push('');
  lines.push('/** Scope applicativi dichiarati da questa app. */');
  lines.push('export const SCOPES = [');
  for (const scope of catalog.scopes ?? []) {
    lines.push('  {');
    lines.push(`    codice: '${escapeTs(normalizeCode(scope.codice))}',`);
    lines.push(`    nome: '${escapeTs(scope.nome)}',`);
    lines.push('  },');
  }
  lines.push('] as const satisfies readonly ScopeEntity[];');
  lines.push('');
  lines.push("export type ScopeCode = (typeof SCOPES)[number]['codice'];");
  lines.push('');

  lines.push('/** Gruppi menu dell\'applicazione (senza la lista dei menu, che e in MENU). */');
  lines.push('export const MENU_GROUPS = [');
  for (const group of groups) {
    lines.push('  {');
    lines.push(`    codiceGruppo: '${escapeTs(group.codiceGruppo)}',`);
    if (group.descrizioneGruppo) lines.push(`    descrizioneGruppo: '${escapeTs(group.descrizioneGruppo)}',`);
    lines.push(`    ordineGruppo: ${Number(group.ordineGruppo ?? 0)},`);
    lines.push(`    enabled: ${group.enabled === false ? 'false' : 'true'},`);
    lines.push('  },');
  }
  lines.push('] as const satisfies readonly Omit<GroupWithMenusEntity, \'menus\'>[];');
  lines.push('');
  lines.push('/** Tipi menu usati dall\'applicazione. */');
  lines.push('export const MENU_TYPES = [');
  for (const type of catalog.menuTypes ?? []) {
    lines.push('  {');
    lines.push(`    codiceTipo: '${escapeTs(type.codiceTipo)}',`);
    if (type.descrizioneTipo) lines.push(`    descrizioneTipo: '${escapeTs(type.descrizioneTipo)}',`);
    lines.push('  },');
  }
  lines.push('] as const satisfies readonly MenuTypeEntity[];');
  lines.push('');
  const firstMenuCode = menus[0]?.codiceMenu ?? 'HOME';
  lines.push(`/** Menu dell'applicazione: \`MENU.${firstMenuCode}.codiceMenu === '${firstMenuCode}'\`. */`);
  lines.push('export const MENU = {');
  for (const menu of menus) {
    const group = groupByCode.get(normalizeCode(menu.codiceGruppo));
    lines.push(`  ${menu.codiceMenu}: {`);
    lines.push(`    codiceMenu: '${escapeTs(menu.codiceMenu)}',`);
    lines.push(`    descrizioneMenu: '${escapeTs(menu.descrizioneMenu)}',`);
    lines.push(`    codiceGruppo: '${escapeTs(menu.codiceGruppo)}',`);
    if (group?.descrizioneGruppo) {
      lines.push(`    descrizioneGruppo: '${escapeTs(group.descrizioneGruppo)}',`);
    }
    lines.push(`    tipo: '${escapeTs(menu.tipo)}',`);
    if (menu.icona) lines.push(`    icona: '${escapeTs(menu.icona)}',`);
    if (menu.pagina) lines.push(`    pagina: '${escapeTs(menu.pagina)}',`);
    lines.push(`    ordineMenu: ${Number(menu.ordineMenu ?? 0)},`);
    lines.push(`    ordineGruppo: ${Number(group?.ordineGruppo ?? 0)},`);
    if (menu.rifMenu) lines.push(`    rifMenu: '${escapeTs(menu.rifMenu)}',`);
    if (menu.note) lines.push(`    note: '${escapeTs(menu.note)}',`);
    lines.push(`    enabled: ${menu.enabled === false ? 'false' : 'true'},`);
    lines.push('  },');
  }
  lines.push('} as const satisfies Record<string, MenuEntity>;');
  lines.push('');
  lines.push('export type MenuCode = keyof typeof MENU;');
  lines.push('export type MenuItem = (typeof MENU)[MenuCode];');
  lines.push('');
  lines.push('/** Tutti i codici menu, nell\'ordine del catalogo. */');
  lines.push('export const MENU_CODES = Object.keys(MENU) as MenuCode[];');
  lines.push('');
  lines.push('/** Accesso per codice runtime (es. codici che arrivano dal DB). */');
  lines.push('export const MENU_BY_CODE: Readonly<Record<string, MenuEntity>> = MENU;');
  lines.push('');
  lines.push("/** Scope di ogni menu: usato dal sync per popolare MENU_SCOPES. */");
  lines.push('export const MENU_SCOPES = {');
  for (const menu of menus) {
    const scopes = (menu.scopes ?? []).map((scope) => `'${escapeTs(normalizeCode(scope))}'`).join(', ');
    lines.push(`  ${menu.codiceMenu}: [${scopes}],`);
  }
  lines.push('} as const satisfies Record<MenuCode, readonly ScopeCode[]>;');
  lines.push('');

  return `${lines.join('\n')}\n`;
}

/** Scrive il file TypeScript generato e restituisce il percorso. */
export function writeGeneratedTs(app, catalog) {
  const paths = appPaths(app);
  fs.mkdirSync(path.dirname(paths.generated), { recursive: true });
  fs.writeFileSync(paths.generated, buildGeneratedTs(app, catalog), 'utf8');
  return paths.generated;
}

/** Legge i codici dichiarati nei file sorgente dell'app (costanti, cataloghi, route). */
export function scanDeclaredCodes(app) {
  const codes = new Map();
  const root = appPaths(app).root;
  for (const source of app.sources ?? []) {
    const file = path.join(root, source);
    if (!fs.existsSync(file)) continue;
    const content = fs.readFileSync(file, 'utf8');
    for (const match of content.matchAll(/([A-Za-z_$][\w$]*)\s*:\s*'([^']+)'/g)) {
      const code = match[2].trim();
      if (CODE_RE.test(code)) codes.set(code, { key: match[1], source });
    }
    for (const match of content.matchAll(/([A-Za-z_$][\w$]*)\s*=\s*'([^']+)'/g)) {
      const code = match[2].trim();
      if (CODE_RE.test(code)) codes.set(code, { key: match[1], source });
    }
  }
  return codes;
}

/** Tutti i letterali del FE che coincidono con un codice menu del DB. */
export function scanUsedDbCodes(app, dbCodes) {
  const used = new Set();
  const root = appPaths(app).root;
  const skipDirs = new Set(['node_modules', 'api', 'generated', 'assets', '.git', 'dist', 'www']);
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!skipDirs.has(entry.name)) walk(full);
        continue;
      }
      if (!entry.name.endsWith('.ts') || entry.name.endsWith('.spec.ts')) continue;
      const content = fs.readFileSync(full, 'utf8');
      for (const match of content.matchAll(/'([A-Z][A-Z0-9_]{2,19})'/g)) {
        const code = match[1];
        if (dbCodes.has(code)) used.add(code);
      }
    }
  };
  walk(path.join(root, 'src', 'app'));
  return used;
}
