#!/usr/bin/env node
/**
 * Ricostruisce i cataloghi menu delle app partendo dal database Accessi e dai
 * codici dichiarati nei frontend.
 *
 * E' il tool di "anagrafica": si esegue quando si aggiungono nuove app o nuovi
 * menu nel codice. Il risultato sono i file `menus/menu-catalog.json`, che da
 * quel momento sono la fonte di verita' e si modificano a mano (o con
 * `menus:generate`) senza piu' rieseguire il bootstrap.
 *
 * Regole:
 * - ogni menu del DB viene assegnato all'app proprietaria del gruppo
 *   (prefisso della descrizione, es. ESGESTX_ -> EsGestX);
 * - ogni codice dichiarato dal FE entra nel catalogo della sua app, usando la
 *   riga del DB quando esiste;
 * - i codici nuovi (non ancora nel DB) ricevono gruppo/tipo/descrizione con le
 *   regole qui sotto, pensate per essere stabili e prevedibili.
 *
 * Uso:
 *   npm run menus:bootstrap
 *   npm run menus:bootstrap -- --app=SteriliX
 */
import {
  loadRegistry,
  resolveApp,
  appPaths,
  writeJson,
  scanDeclaredCodes,
  humanize,
  normalizeCode,
  askCredentials,
  connect,
  fetchSnapshot,
  writeGeneratedTs,
} from './lib.mjs';

// ---------------------------------------------------------------------------
// Regole di anagrafica
// ---------------------------------------------------------------------------

/** Codici usati nel FE che nel DB hanno gia' un nome piu' corto. */
const CODE_ALIASES = {
  STAFFX_COMUNICAZIONI_AZIENDA: 'STAFFX_COM_AZIENDA',
  STAFFX_COMUNICAZIONI_GENERALI: 'STAFFX_COM_GENERALI',
  STAFFX_COMUNICAZIONI_SICUREZZA: 'STAFFX_COM_SICUREZZA',
};

/** Proprietario di un gruppo, dedotto dal prefisso della descrizione. */
const GROUP_OWNERS = [
  { prefix: 'ESGESTX_', app: 'EsGestX' },
  { prefix: 'TINTEMIX_', app: 'TintemiX' },
  { prefix: 'MAGAZTINT_', app: 'Magaz-Tint' },
  { prefix: 'STEX_', app: 'SteX' },
  { prefix: 'STAFFX_', app: 'StaffX' },
  { prefix: 'STERILIX_', app: 'SteriliX' },
  { prefix: 'CENTROCONTROLLO_', app: 'SteX' },
];

/** Gruppi nuovi, per le app che non ne hanno ancora. */
const NEW_GROUPS = {
  SteriliX: [
    { codiceGruppo: 'Z', descrizioneGruppo: 'STERILIX_OPERATIVO', ordineGruppo: 70 },
    { codiceGruppo: 'Y', descrizioneGruppo: 'STERILIX_CONFIGURAZIONE', ordineGruppo: 71 },
    { codiceGruppo: 'W', descrizioneGruppo: 'STERILIX_REPORT', ordineGruppo: 72 },
  ],
};

/** Regole per i codici nuovi: primo match vince. */
const NEW_MENU_RULES = {
  EsGestX: [
    { match: 'NUOVA_SCHEDA_PERS', group: 'D', tipo: 'A' },
    { match: 'WHIDE1ACONSEGNA', group: 'D', tipo: 'C' },
    { match: 'WIDUTENTI', group: 'A', tipo: 'W' },
    { match: 'WREGISTRAART', group: 'X', tipo: 'A' },
    { match: 'WACCENTRATORELED', group: 'X', tipo: 'W' },
    { match: /^WKPI/, group: 'S', tipo: 'W' },
    { match: /^INV_/, group: 'M', tipo: 'A' },
    { match: /^(WDOTAZCLIENTE|WCREDITI|WCONSEGNECLIENTE|WESPANDINOTECLI)$/, group: 'C', tipo: 'W' },
    { match: /^W/, group: 'A', tipo: 'W' },
  ],
  'Magaz-Tint': [
    { match: 'MNUDDTEMERG', group: 'M', tipo: 'A' },
    { match: 'WIDUTENTI', group: 'A', tipo: 'W' },
    { match: 'WREGISTRAART', group: 'X', tipo: 'A' },
    { match: /^COL_/, group: 'D', tipo: 'C' },
    { match: /^INV_/, group: 'M', tipo: 'A' },
    { match: /^W/, group: 'A', tipo: 'W' },
  ],
};

/** Menu nuovi di SteriliX: l'app non ha ancora nulla in Accessi. */
const STERILIX_MENUS = [
  // La pagina e' univoca in Accessi: "/main" e "/documenti" sono gia usate da
  // altre app, quindi queste due voci si identificano solo per codice.
  { code: 'MNUSTXMAIN', group: 'Z', tipo: 'M', descrizione: 'SteriliX - Home', icona: 'home-outline' },
  { code: 'MNUSTXDASH', group: 'Z', tipo: 'M', descrizione: 'SteriliX - Dashboard', icona: 'speedometer-outline', pagina: '/dashboard' },
  { code: 'MNUSTXLOTTI', group: 'Z', tipo: 'M', descrizione: 'SteriliX - Lotti', icona: 'layers-outline', pagina: '/lotti' },
  { code: 'MNUSTXIMPS', group: 'Z', tipo: 'M', descrizione: 'SteriliX - Impianti', icona: 'business-outline', pagina: '/impianti' },
  { code: 'MNUSTXIMPSEL', group: 'Z', tipo: 'M', descrizione: 'SteriliX - Selezione impianto', icona: 'swap-horizontal-outline', pagina: '/impianti-select' },
  { code: 'MNUSTXIMPEDIT', group: 'Z', tipo: 'A', descrizione: 'SteriliX - Modifica impianto', icona: 'create-outline', pagina: '/edit-impianto' },
  { code: 'MNUSTXIMPDET', group: 'Z', tipo: 'A', descrizione: 'SteriliX - Dettaglio impianto', icona: 'information-circle-outline', pagina: '/impianto' },
  { code: 'MNUSTXMAC', group: 'Z', tipo: 'M', descrizione: 'SteriliX - Macchine', icona: 'hardware-chip-outline', pagina: '/macchine' },
  { code: 'MNUSTXALM', group: 'Z', tipo: 'M', descrizione: 'SteriliX - Allarmi', icona: 'alert-circle-outline', pagina: '/allarmi' },
  { code: 'MNUSTXSET', group: 'Y', tipo: 'M', descrizione: 'SteriliX - Impostazioni', icona: 'settings-outline', pagina: '/impostazioni' },
  { code: 'MNUSTXPAR', group: 'Y', tipo: 'M', descrizione: 'SteriliX - Parametri', icona: 'options-outline', pagina: '/parametri' },
  { code: 'MNUSTXZONE', group: 'Y', tipo: 'M', descrizione: 'SteriliX - Zone', icona: 'map-outline', pagina: '/zone' },
  { code: 'MNUSTXCAT', group: 'Y', tipo: 'M', descrizione: 'SteriliX - Categorie', icona: 'pricetags-outline', pagina: '/categorie' },
  { code: 'MNUSTXDCFG', group: 'Y', tipo: 'M', descrizione: 'SteriliX - Configurazione documenti', icona: 'document-attach-outline', pagina: '/documenti-config' },
  { code: 'MNUSTXMQTT', group: 'Y', tipo: 'M', descrizione: 'SteriliX - MQTT', icona: 'cloud-outline', pagina: '/mqtt' },
  { code: 'MNUSTXTEL', group: 'Y', tipo: 'M', descrizione: 'SteriliX - Teleassistenza', icona: 'headset-outline', pagina: '/teleassistenza' },
  { code: 'MNUSTXUSR', group: 'Y', tipo: 'M', descrizione: 'SteriliX - Utenti', icona: 'people-outline', pagina: '/utenti' },
  { code: 'MNUSTXRPT', group: 'W', tipo: 'M', descrizione: 'SteriliX - Report', icona: 'bar-chart-outline', pagina: '/report' },
  { code: 'MNUSTXDOC', group: 'W', tipo: 'M', descrizione: 'SteriliX - Documenti', icona: 'document-text-outline' },
];

const TYPE_DESCRIPTIONS = {
  M: 'Menu di navigazione',
  C: 'Controllo / Colonna',
  P: 'Pagina',
  W: 'Widget',
  A: 'Abilitazione',
};

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function flag(name) {
  const prefix = `--${name}=`;
  const found = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return found?.slice(prefix.length);
}

function appNamesFromArgs() {
  return process.argv
    .slice(2)
    .filter((arg) => arg.startsWith('--app='))
    .map((arg) => arg.slice('--app='.length));
}

function ownerOfGroup(description) {
  const value = String(description ?? '').toUpperCase();
  return GROUP_OWNERS.find((rule) => value.startsWith(rule.prefix))?.app ?? null;
}

function inferType(code) {
  if (/^W/.test(code)) return 'W';
  if (/^ABIL/.test(code)) return 'A';
  if (/^(COL_|WHIDE)/.test(code)) return 'C';
  return 'M';
}

function ruleFor(appName, code) {
  for (const rule of NEW_MENU_RULES[appName] ?? []) {
    if (typeof rule.match === 'string' ? rule.match === code : rule.match.test(code)) {
      return rule;
    }
  }
  return null;
}

function rowToEntry(row) {
  const entry = {
    codiceMenu: normalizeCode(row.codiceMenu),
    descrizioneMenu: String(row.descrizioneMenu ?? '').trim(),
    codiceGruppo: normalizeCode(row.codiceGruppo),
    tipo: normalizeCode(row.tipo) || 'M',
    ordineMenu: Number(row.ordineMenu ?? 0),
    enabled: row.enabled !== false,
  };
  if (row.icona) entry.icona = row.icona;
  if (row.pagina) entry.pagina = row.pagina;
  if (row.rifMenu) entry.rifMenu = row.rifMenu;
  if (row.note) entry.note = row.note;
  return entry;
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

const registry = loadRegistry();
const baseUrl = flag('url') ?? process.env['ACCESSI_BASE_URL'] ?? registry.defaultBaseUrl;
const requested = appNamesFromArgs();
const apps = requested.length > 0 ? requested.map((name) => resolveApp(registry, name)) : registry.apps;

console.log(`Accessi: ${baseUrl}`);
const credentials = await askCredentials({ email: flag('email'), password: flag('password') });
const { client, user } = await connect({ baseUrl, ...credentials });
console.log(`Autenticato come ${user?.email ?? credentials.email}\n`);

const snapshot = await fetchSnapshot(client);
const dbCodes = new Set(snapshot.menus.keys());

const groupsByOwner = new Map();
const unownedGroups = new Set();
for (const [code, group] of snapshot.groups) {
  const owner = ownerOfGroup(group.descrizioneGruppo);
  if (!owner) {
    unownedGroups.add(code);
    continue;
  }
  if (!groupsByOwner.has(owner)) groupsByOwner.set(owner, new Set());
  groupsByOwner.get(owner).add(code);
}

// Ordine globale per i nuovi menu: cosi' un codice condiviso da piu' app ha lo
// stesso ordine in tutti i cataloghi (una sola riga nel DB).
const nextOrder = new Map();
for (const menu of snapshot.menus.values()) {
  const group = normalizeCode(menu.codiceGruppo);
  nextOrder.set(group, Math.max(nextOrder.get(group) ?? 0, Number(menu.ordineMenu ?? 0)));
}
const assignedOrder = new Map();

const built = [];

for (const app of apps) {
  const declared = new Map();
  for (const [code, meta] of scanDeclaredCodes(app)) {
    declared.set(CODE_ALIASES[code] ?? code, meta);
  }
  const ownedGroups = groupsByOwner.get(app.app) ?? new Set();
  const codes = new Set();
  for (const [code, menu] of snapshot.menus) {
    if (ownedGroups.has(normalizeCode(menu.codiceGruppo))) codes.add(code);
  }
  for (const code of declared.keys()) codes.add(code);

  const entries = [];
  const missing = [];
  for (const code of codes) {
    const row = snapshot.menus.get(code);
    if (row) {
      entries.push(rowToEntry(row));
    } else {
      missing.push(code);
    }
  }

  for (const code of missing.sort()) {
    const explicit = app.app === 'SteriliX' ? STERILIX_MENUS.find((item) => item.code === code) : null;
    if (app.app === 'SteriliX' && !explicit) {
      console.warn(`  ! ${app.app}: ${code} dichiarato dal FE ma senza definizione, saltato`);
      continue;
    }
    const rule = ruleFor(app.app, code);
    const group = explicit?.group ?? rule?.group ?? [...ownedGroups][0] ?? 'X';
    const tipo = explicit?.tipo ?? rule?.tipo ?? inferType(code);
    const meta = declared.get(code);

    let order = assignedOrder.get(code);
    if (order === undefined) {
      order = (nextOrder.get(group) ?? 0) + 10;
      nextOrder.set(group, order);
      assignedOrder.set(code, order);
    }

    const entry = {
      codiceMenu: code,
      descrizioneMenu: explicit?.descrizione ?? humanize(meta?.key ?? code),
      codiceGruppo: group,
      tipo,
      ordineMenu: order,
      enabled: true,
    };
    if (explicit?.icona) entry.icona = explicit.icona;
    if (explicit?.pagina) entry.pagina = explicit.pagina;
    entries.push(entry);
  }

  // Solo i gruppi realmente usati: l'API elenca i gruppi vuoti come assenti,
  // quindi tenerli nel catalogo renderebbe la verifica impossibile.
  const groupCodes = new Set(entries.map((entry) => entry.codiceGruppo));
  const groups = [];
  for (const code of groupCodes) {
    const existing = snapshot.groups.get(code);
    const created = (NEW_GROUPS[app.app] ?? []).find((group) => group.codiceGruppo === code);
    if (existing) {
      groups.push({
        codiceGruppo: code,
        descrizioneGruppo: String(existing.descrizioneGruppo ?? '').trim(),
        ordineGruppo: Number(existing.ordineGruppo ?? 0),
        enabled: existing.enabled !== false,
        owned: ownedGroups.has(code),
      });
    } else if (created) {
      groups.push({ ...created, enabled: true, owned: true });
    } else {
      throw new Error(`Gruppo ${code} usato da ${app.app} ma assente dal DB e da NEW_GROUPS.`);
    }
  }
  groups.sort((a, b) => a.ordineGruppo - b.ordineGruppo || a.codiceGruppo.localeCompare(b.codiceGruppo));

  built.push({ app, catalog: { app: app.app, groups, menuTypes: [], menus: entries }, newCount: missing.length });
}

// Un codice menu vive una volta sola nel DB: se piu' app lo dichiarano, tutte
// le copie devono essere identiche. La prima app del registro fa da canonica.
const canonical = new Map();
for (const { catalog } of built) {
  for (const menu of catalog.menus) {
    if (!canonical.has(menu.codiceMenu)) canonical.set(menu.codiceMenu, menu);
  }
}

for (const { app, catalog, newCount } of built) {
  const groupDefs = new Map(catalog.groups.map((group) => [group.codiceGruppo, group]));
  const menus = catalog.menus.map((menu) => {
    const source = canonical.get(menu.codiceMenu) ?? menu;
    const copy = { ...source };
    if (!groupDefs.has(copy.codiceGruppo)) {
      const existing = snapshot.groups.get(copy.codiceGruppo);
      const created = (NEW_GROUPS[app.app] ?? []).find((group) => group.codiceGruppo === copy.codiceGruppo);
      if (existing) {
        groupDefs.set(copy.codiceGruppo, {
          codiceGruppo: copy.codiceGruppo,
          descrizioneGruppo: String(existing.descrizioneGruppo ?? '').trim(),
          ordineGruppo: Number(existing.ordineGruppo ?? 0),
          enabled: existing.enabled !== false,
          owned: false,
        });
      } else if (created) {
        groupDefs.set(copy.codiceGruppo, { ...created, enabled: true, owned: false });
      } else {
        throw new Error(`Menu ${copy.codiceMenu}: gruppo ${copy.codiceGruppo} senza definizione per ${app.app}.`);
      }
    }
    return copy;
  });

  menus.sort((a, b) => {
    const orderA = Number(groupDefs.get(a.codiceGruppo)?.ordineGruppo ?? 0);
    const orderB = Number(groupDefs.get(b.codiceGruppo)?.ordineGruppo ?? 0);
    if (orderA !== orderB) return orderA - orderB;
    if (a.codiceGruppo !== b.codiceGruppo) return a.codiceGruppo.localeCompare(b.codiceGruppo);
    return Number(a.ordineMenu ?? 0) - Number(b.ordineMenu ?? 0) || a.codiceMenu.localeCompare(b.codiceMenu);
  });

  const typeCodes = [...new Set(menus.map((entry) => entry.tipo))].sort();
  const menuTypes = typeCodes.map((code) => ({
    codiceTipo: code,
    descrizioneTipo: snapshot.types.get(code)?.descrizioneTipo ?? TYPE_DESCRIPTIONS[code] ?? code,
  }));

  const groups = [...groupDefs.values()].sort(
    (a, b) => a.ordineGruppo - b.ordineGruppo || a.codiceGruppo.localeCompare(b.codiceGruppo),
  );

  catalog.groups = groups;
  catalog.menuTypes = menuTypes;
  catalog.menus = menus;

  writeJson(appPaths(app).catalog, catalog);
  writeGeneratedTs(app, catalog);

  console.log(
    `${app.app}: ${menus.length} menu (${newCount} nuovi), ${groups.length} gruppi, ${menuTypes.length} tipi`,
  );
}

if (unownedGroups.size > 0) {
  console.log(`\nGruppi senza proprietario (restano fuori dai cataloghi): ${[...unownedGroups].join(', ')}`);
}
console.log('\nCataloghi e file TypeScript rigenerati.');
