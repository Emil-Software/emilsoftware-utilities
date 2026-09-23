import {
  assignPermissionsToUser,
  assignRolesToUser,
  createFederatedUser,
  createFederatedProvider,
  createManagedUser,
  createMenu,
  createMenuGroup,
  createMenuType,
  createRole,
  createServiceToken,
  createTipoFiltro,
  deleteFederatedIdentityPermanently,
  deleteFederatedProvider,
  deleteMenu,
  deleteMenuGroup,
  deleteMenuType,
  deleteRole,
  deleteTipoFiltro,
  deleteUser,
  getFederatedIdentities,
  getFederatedProviders,
  getFiltriUtente,
  getGroupsWithMenus,
  getMenuTypes,
  getRoles,
  getServiceTokens,
  getTipiFiltro,
  getUserByToken,
  getUserRolesAndGrants,
  getUsers,
  linkFederatedIdentity,
  login,
  verifyTwoFactor,
  resendTwoFactor,
  revokeServiceToken,
  rotateServiceToken,
  saveFiltriUtente,
  setGroupEnabled,
  setMenuEnabled,
  setStatoRegistrazione,
  updateFederatedIdentity,
  updateFederatedProvider,
  updateMenu,
  updateMenuGroup,
  updateMenuType,
  updateRole,
  updateTipoFiltro,
  updateUtente,
} from './generated/accessiApi';
import { setAccessiConsoleToken } from './accessiFetch';
import { WIKI_SECTIONS, wikiGroups, buildAiDigest } from './wiki';
import type { WikiBlock } from './wiki';
import type {
  CreateFederatedUserRequest,
  CreateFederatedProviderRequest,
  AuthenticatedTokenPayloadDto,
  FiltriUtente,
  FederatedProviderResponseDto,
  GroupWithMenusEntity,
  LoginResult,
  MenuEntity,
  MenuTypeEntity,
  Permission,
  RegisterRequest,
  Role,
  ServiceTokenDto,
  IssuedServiceTokenDto,
  TipoFiltro,
  UserDto,
  UpdateFederatedProviderRequest,
} from './generated/model';

type UserRow = { utente: UserDto; userGrants?: { ruoli?: Array<{ codiceRuolo?: number; descrizioneRuolo?: string }> } };
type ConsoleUser = { codiceUtente: number; email?: string; flagSuper: boolean; flagAdminConfigurator: boolean };
type FederatedProvider = FederatedProviderResponseDto;
type ConsoleFederatedIdentity = { identityKey: string; provider: string; subject: string; active: boolean; note?: string };
type UserDetailTab = 'sso' | 'profile' | 'roles' | 'grants';
type ConsoleView =
  | 'users'
  | 'roles'
  | 'menuGroups'
  | 'menuItems'
  | 'menuTypes'
  | 'filterUser'
  | 'filterTypes'
  | 'ssoProviders'
  | 'ssoUsers'
  | 'tokens'
  | 'wiki';

const routeSegment: Record<ConsoleView, string> = {
  users: 'utenti',
  roles: 'ruoli-e-grant',
  menuGroups: 'menu-e-gruppi/gruppi',
  menuItems: 'menu-e-gruppi/menu',
  menuTypes: 'menu-e-gruppi/tipi-menu',
  filterUser: 'filtri/utente',
  filterTypes: 'filtri/tipi',
  ssoProviders: 'sso/provider',
  ssoUsers: 'sso/utenti',
  tokens: 'token-di-servizio',
  wiki: 'wiki',
};
const routeView = Object.fromEntries(Object.entries(routeSegment).map(([view, segment]) => [segment, view])) as Record<string, ConsoleView>;
// I padri dei sottomenu hanno un URL proprio: senza figlio selezionato si apre la prima voce.
const parentDefaultView: Record<string, ConsoleView> = {
  'menu-e-gruppi': 'menuGroups',
  filtri: 'filterUser',
  sso: 'ssoProviders',
};
const consoleMarker = '/accessi/console';
const consoleMarkerIndex = window.location.pathname.indexOf(consoleMarker);
const consoleBasePath = consoleMarkerIndex >= 0
  ? window.location.pathname.slice(0, consoleMarkerIndex + consoleMarker.length)
  : `${window.location.pathname.replace(/\/$/, '')}`;

const USERS_PAGE_SIZE = 25;

let token = sessionStorage.getItem('accessi-console-token');
let currentUser: ConsoleUser | null = null;
let federatedAuthenticationAvailable = false;
let usersPage = 0;
let usersTotal = 0;
let booting = true;
let pendingNetworkRequests = 0;
let loadingRevealTimer: number | undefined;
let loadingHideTimer: number | undefined;
let loaderVisibleSince = 0;

const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[char] as string));
function result<T>(response: { data: object }): T {
  const body = response.data as { Result?: T; message?: string };
  if (body.Result === undefined) throw new Error(body.message ?? 'Risposta Accessi priva di dati.');
  return body.Result;
}

function showNotice(message: string, isError = false): void {
  // Un messaggio vuoto deve azzerare il contenitore, altrimenti resta visibile la barra di avviso.
  byId('notice').innerHTML = message ? `<span class="${isError ? 'error' : ''}">${escapeHtml(message)}</span>` : '';
}

/** Renders operational menu metadata shared by the permissions and role views. */
function menuMetadata(menu: MenuEntity): string {
  const details = [
    ['Codice', menu.codiceMenu],
    ['Ordine', String(menu.ordineMenu)],
    ['Tipo', menu.tipo],
    ['Pagina', menu.pagina],
    ['Icona', menu.icona],
    ['Stato', menu.enabled === false ? 'Disabilitato' : 'Abilitato'],
  ].filter(([, value]) => value);
  return `<dl class="entity-metadata">${details.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl>${menu.note ? `<p class="entity-note"><strong>Nota</strong>${escapeHtml(menu.note)}</p>` : ''}`;
}

/** Exposes only supported permission levels while preserving historical value 30 without data loss. */
function permissionSelectOptions(currentLevel: number | undefined): string {
  return `<option value="10" ${currentLevel === 10 ? 'selected' : ''}>Lettura</option><option value="20" ${currentLevel === 20 ? 'selected' : ''}>Scrittura</option>${currentLevel === 30 ? '<option value="30" selected>Valore legacy (30)</option>' : ''}`;
}

/** Renders the metadata that describes a menu group independently of its menus. */
function groupMetadata(group: GroupWithMenusEntity): string {
  return `<dl class="entity-metadata"><div><dt>Codice</dt><dd>${escapeHtml(group.codiceGruppo)}</dd></div><div><dt>Ordine</dt><dd>${escapeHtml(group.ordineGruppo)}</dd></div><div><dt>Stato</dt><dd>${group.enabled === false ? 'Disabilitato' : 'Abilitato'}</dd></div><div><dt>Menu</dt><dd>${group.menus.length}</dd></div></dl>`;
}

/** Builds the full-width, grouped direct-grant editor for an individual user. */
function directGrantEditor(groups: GroupWithMenusEntity[], grants: Permission[] | undefined): string {
  return `<form id="grants" class="user-editor-section grants-editor" data-user-panel="grants" role="tabpanel" aria-labelledby="user-tab-grants"><h3>Grant diretti</h3><p class="form-help">Grant diretti, indipendenti dai ruoli. Seleziona <strong>nessuno</strong> per rimuoverli.</p><div class="grant-menu-groups">${groups.map((group) => `<fieldset class="grant-menu-group"><legend>${escapeHtml(group.descrizioneGruppo)}</legend>${groupMetadata(group)}<div class="grant-menu-options">${group.menus.map((menu) => { const grant = (grants ?? []).find((item) => item.codiceMenu === menu.codiceMenu); return `<div class="grant-menu-option ${menu.enabled === false ? 'is-disabled' : ''}"><div class="grant-menu-info"><strong>${escapeHtml(menu.descrizioneMenu)}</strong>${menuMetadata(menu)}</div><label class="grant-level">Livello di grant<select name="grant:${escapeHtml(menu.codiceMenu)}"><option value="">nessuno</option>${permissionSelectOptions(grant?.tipoAbilitazione)}</select></label></div>`; }).join('') || '<p class="form-help">Nessun menu configurato in questo gruppo.</p>'}</div></fieldset>`).join('')}</div><button>Salva grant</button></form>`;
}

/** Converts Accessi's persisted permission value into its documented label. */
function permissionLevelLabel(value: number | undefined): string {
  return value === 10 ? 'Lettura' : value === 20 ? 'Scrittura' : value === 30 ? 'Valore legacy (30)' : `Livello ${value ?? 'non definito'}`;
}

/** Preserves incomplete legacy role data without rendering an invalid numeric label. */
function rolePermissionLevel(value: unknown): string {
  return value === undefined || value === null || value === '' ? permissionLevelLabel(undefined) : permissionLevelLabel(Number(value));
}

/** Renders selectable roles together with their effective groups, menus and permission levels. */
function roleAssignmentEditor(roles: Role[], assignedRoles: Array<{ codiceRuolo?: number }> | undefined, groups: GroupWithMenusEntity[]): string {
  const catalogMenus = new Map(groups.flatMap((group) => group.menus.map((menu) => [menu.codiceMenu, menu])));
  return `<form id="roles" class="user-editor-section roles-editor" data-user-panel="roles" role="tabpanel" aria-labelledby="user-tab-roles"><h3>Ruoli</h3><p class="form-help">Salvare sostituisce i ruoli dell'utente (non i grant diretti).</p><div class="role-assignment-list">${roles.map((role) => { const roleMenus = role.menu ?? []; const assigned = (assignedRoles ?? []).some((current) => current.codiceRuolo === role.codiceRuolo); const groupedMenus = groups.map((group) => ({ group, entries: group.menus.map((menu) => ({ menu, assignment: roleMenus.find((item) => item.codiceMenu === menu.codiceMenu) })).filter((entry) => entry.assignment) })).filter((entry) => entry.entries.length > 0); const missingMenus = roleMenus.filter((item) => !catalogMenus.has(item.codiceMenu)); return `<article class="role-assignment-card"><div class="role-assignment-heading"><label class="check"><input type="checkbox" name="role" value="${escapeHtml(role.codiceRuolo)}" ${assigned ? 'checked' : ''}><span><strong>${escapeHtml(role.descrizioneRuolo)}</strong><small>Codice ruolo: ${escapeHtml(role.codiceRuolo)}</small></span></label><span class="role-menu-count">${roleMenus.length} menu</span></div><div class="role-permission-groups">${groupedMenus.map(({ group, entries }) => `<section class="role-permission-group"><div class="role-permission-group-heading"><strong>${escapeHtml(group.descrizioneGruppo)}</strong>${groupMetadata(group)}</div>${entries.map(({ menu, assignment }) => `<div class="role-permission-entry ${menu.enabled === false ? 'is-disabled' : ''}"><div><strong>${escapeHtml(menu.descrizioneMenu)}</strong>${menuMetadata(menu)}</div><span class="permission-level">${escapeHtml(rolePermissionLevel(assignment?.tipoAbilitazione))}</span></div>`).join('')}</section>`).join('') || '<p class="form-help">Questo ruolo non contiene menu attivi nel catalogo.</p>'}${missingMenus.length ? `<section class="role-permission-group missing-role-menus"><strong>Menu non più presenti nel catalogo</strong>${missingMenus.map((menu) => `<div class="role-permission-entry"><div><strong>${escapeHtml(menu.codiceMenu)}</strong><p class="entity-note">Il menu è ancora associato al ruolo ma non è disponibile nel catalogo corrente.</p></div><span class="permission-level">${escapeHtml(rolePermissionLevel(menu.tipoAbilitazione))}</span></div>`).join('')}</section>` : ''}</div></article>`; }).join('')}</div><button>Salva ruoli</button></form>`;
}

/** Vista compatta di un ruolo: identità, azioni e albero delle abilitazioni su richiesta. */
function roleOverview(role: Role, groups: GroupWithMenusEntity[]): string {
  const roleMenus = role.menu ?? [];
  const assignments = new Map(roleMenus.map((item) => [item.codiceMenu, item]));
  const knownMenus = new Set(groups.flatMap((group) => group.menus.map((menu) => menu.codiceMenu)));
  const tree = groups
    .map((group) => ({ group, entries: group.menus.filter((menu) => assignments.has(menu.codiceMenu)) }))
    .filter((node) => node.entries.length > 0);
  const orphans = roleMenus.filter((item) => !knownMenus.has(item.codiceMenu));

  const groupNodes = tree.map(({ group, entries }) => `<li class="role-tree-group ${group.enabled === false ? 'is-disabled' : ''}"><div class="role-tree-group-head"><strong>${escapeHtml(group.descrizioneGruppo)}</strong><span class="role-tree-count">${entries.length}</span></div><ul class="role-tree-menus">${entries.map((menu) => `<li class="role-tree-menu ${menu.enabled === false ? 'is-disabled' : ''}"><span class="role-tree-menu-name">${escapeHtml(menu.descrizioneMenu)}</span><span class="permission-level">${escapeHtml(rolePermissionLevel(assignments.get(menu.codiceMenu)?.tipoAbilitazione))}</span></li>`).join('')}</ul></li>`).join('');
  const orphanNode = orphans.length
    ? `<li class="role-tree-group is-orphan"><div class="role-tree-group-head"><strong>Menu non più nel catalogo</strong><span class="role-tree-count">${orphans.length}</span></div><ul class="role-tree-menus">${orphans.map((item) => `<li class="role-tree-menu"><span class="role-tree-menu-name"><code>${escapeHtml(item.codiceMenu)}</code></span><span class="permission-level">${escapeHtml(rolePermissionLevel(item.tipoAbilitazione))}</span></li>`).join('')}</ul></li>`
    : '';

  return `<article class="role-card">
    <div class="role-card-head">
      <div class="role-card-title">
        <strong>${escapeHtml(role.descrizioneRuolo)}</strong>
        <span class="role-card-meta">Codice ${escapeHtml(role.codiceRuolo)} &middot; ${roleMenus.length} menu</span>
      </div>
      <div class="role-card-actions">
        <button type="button" class="secondary" data-role="${escapeHtml(role.codiceRuolo)}">Modifica</button>
        <button type="button" class="danger-button" data-role-delete="${escapeHtml(role.codiceRuolo)}">Elimina</button>
      </div>
    </div>
    ${roleMenus.length ? `<details class="role-card-menus"><summary>Abilitazioni per menu (${roleMenus.length})</summary><ul class="role-tree">${groupNodes}${orphanNode}</ul></details>` : '<p class="role-card-empty">Nessun menu assegnato.</p>'}
  </article>`;
}

/** Editor compatto dei menu di un ruolo: inclusione e livello, raggruppati per gruppo. */
function roleMenuEditorTable(group: GroupWithMenusEntity, role?: Role): string {
  const roleMenus = role?.menu ?? [];
  const options = group.menus.map((menu) => {
    const assignment = roleMenus.find((item) => item.codiceMenu === menu.codiceMenu);
    const level = assignment?.tipoAbilitazione ?? 10;
    return `<li class="role-menu-option ${menu.enabled === false ? 'is-disabled' : ''}"><label class="check"><input type="checkbox" name="menu" value="${escapeHtml(menu.codiceMenu)}" ${assignment ? 'checked' : ''}><span>${escapeHtml(menu.descrizioneMenu)}</span></label><label class="role-menu-level"><span class="sr-only">Livello per ${escapeHtml(menu.descrizioneMenu)}</span><select name="menu-level:${escapeHtml(menu.codiceMenu)}" ${assignment ? '' : 'disabled'}>${permissionSelectOptions(level)}</select></label></li>`;
  }).join('');
  return `<section class="role-menu-group ${group.enabled === false ? 'is-disabled' : ''}">
    <div class="role-menu-group-head"><strong>${escapeHtml(group.descrizioneGruppo)}</strong>${group.enabled === false ? '<span class="muted">Gruppo disabilitato</span>' : ''}</div>
    <ul class="role-menu-options">${options || '<li class="role-menu-empty muted">Nessun menu in questo gruppo.</li>'}</ul>
  </section>`;
}

/**
 * Shows a delayed, concurrency-safe application loader for all Orval requests.
 * The delay avoids a distracting flash for fast operations; the minimum display
 * time makes visible operations feel intentional instead of flickering.
 */
function updateLoadingState(active: boolean): void {
  pendingNetworkRequests = Math.max(0, pendingNetworkRequests + (active ? 1 : -1));
  // Durante il boot l'overlay è gestito manualmente (verifica sessione), non dalle richieste di rete.
  if (booting) {
    return;
  }
  const overlay = byId('loading-overlay');

  if (pendingNetworkRequests > 0) {
    if (loadingHideTimer !== undefined) {
      window.clearTimeout(loadingHideTimer);
      loadingHideTimer = undefined;
    }
    if (loadingRevealTimer === undefined && overlay.hidden) {
      loadingRevealTimer = window.setTimeout(() => {
        loadingRevealTimer = undefined;
        if (pendingNetworkRequests > 0) {
          overlay.hidden = false;
          loaderVisibleSince = Date.now();
          byId('app').setAttribute('aria-busy', 'true');
        }
      }, 140);
    }
    return;
  }

  if (loadingRevealTimer !== undefined) {
    window.clearTimeout(loadingRevealTimer);
    loadingRevealTimer = undefined;
  }

  const hide = () => {
    loadingHideTimer = undefined;
    overlay.hidden = true;
    byId('app').removeAttribute('aria-busy');
  };
  const remainingVisibleMs = 280 - (Date.now() - loaderVisibleSince);
  if (!overlay.hidden && remainingVisibleMs > 0) {
    loadingHideTimer = window.setTimeout(hide, remainingVisibleMs);
  } else {
    hide();
  }
}

/** Chiude la fase di boot e mostra login o console: evita il lampeggio del login a ogni reload. */
function finishBoot(view: 'login' | 'console'): void {
  booting = false;
  const overlay = byId('loading-overlay');
  overlay.hidden = true;
  byId('app').removeAttribute('aria-busy');
  byId('login').hidden = view !== 'login';
  byId('console').hidden = view !== 'console';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Operazione non riuscita.';
}

/** Evita rejection non gestite dagli eventi del browser e conserva la vista corrente. */
function handleAction(action: () => Promise<void>): void {
  void action().catch((error) => showNotice(errorMessage(error), true));
}

function render(markup: string): void {
  byId('view').innerHTML = markup;
}

/** Keeps the selected console area visible to sighted and assistive-technology users. */
function setActiveNavigation(view: ConsoleView): void {
  document.querySelectorAll<HTMLElement>('#nav [data-view]').forEach((link) => {
    if (link.dataset.view === view) {
      link.setAttribute('aria-current', 'page');
    } else {
      link.removeAttribute('aria-current');
    }
  });
  // Apre il ramo dell'albero che contiene la voce attiva.
  document.querySelectorAll<HTMLDetailsElement>('#nav details[data-nav-group]').forEach((branch) => {
    if (branch.querySelector(`[data-view="${view}"]`)) branch.open = true;
  });
}

/** Returns the canonical browser path for a top-level console section. */
function routePath(view: ConsoleView): string {
  return `${consoleBasePath}/${routeSegment[view]}`;
}

/** Resolves a console section from the current pathname, defaulting to users. */
function viewFromLocation(): ConsoleView {
  const relativePath = window.location.pathname.slice(consoleBasePath.length).replace(/^\/+|\/+$/g, '');
  const decoded = decodeURIComponent(relativePath);
  return routeView[decoded] ?? parentDefaultView[decoded] ?? 'users';
}

/** Navigates through the browser history and renders the requested SPA section. */
async function navigate(view: ConsoleView, replace = false): Promise<void> {
  const destination = routePath(view);
  if (window.location.pathname !== destination) {
    window.history[replace ? 'replaceState' : 'pushState']({ view }, '', destination);
  }
  // Tornando alla sezione utenti dal menu si riparte dalla prima pagina.
  if (view === 'users') usersPage = 0;
  await show(view);
}

function requireAdmin(): void {
  if (!currentUser?.flagSuper) throw new Error('La console richiede un superutente Accessi.');
}

function formValues(form: HTMLFormElement): Record<string, string> {
  return Object.fromEntries(new FormData(form).entries()) as Record<string, string>;
}

function eventForm(event: Event): HTMLFormElement {
  return event.currentTarget as HTMLFormElement;
}

/** Shared identity fields: values are verified by the hosting backend, never by this console. */
function federatedIdentityFields(providers: FederatedProvider[]): string {
  return `<label>Provider<select name="provider" required><option value="">Seleziona un provider</option>${providers.filter((provider) => provider.active).map((provider) => `<option value="${escapeHtml(provider.provider)}">${escapeHtml(provider.description)} (${escapeHtml(provider.provider)})</option>`).join('')}</select><span class="form-help">Deve corrispondere alla configurazione backend (per Azure: tenant e ambiente).</span></label>
    <label>ID utente del provider (subject)<input name="subject" required><span class="form-help">Identificatore stabile della persona nel provider, es. <code>oid</code> Azure, <code>sub</code> OIDC, <code>NameID</code> SAML. Non usare l'email.</span></label>
    <label>Nota<input name="note"><span class="form-help">Nota interna, non inviata al provider.</span></label>`;
}

/** Renders high-priority SSO identity management for one Accessi user. */
function federatedIdentitySection(identities: ConsoleFederatedIdentity[], providers: FederatedProvider[]): string {
  return `<section class="user-editor-section sso-identity-section" data-user-panel="sso" role="tabpanel" aria-labelledby="user-tab-sso"><div class="section-heading"><div><p class="eyebrow">Autenticazione esterna</p><h3>Identità SSO</h3></div><span class="muted">Collegamenti verificati dal backend</span></div><p class="form-help">Disabilita conserva lo storico; elimina rimuove il collegamento (l'utente resta).</p><div class="sso-identity-list">${identities.map((identity) => `<article class="sso-identity-item ${identity.active ? '' : 'is-disabled'}"><div class="sso-identity-data"><strong>${escapeHtml(identity.provider)}</strong><dl class="entity-metadata"><div><dt>Subject</dt><dd>${escapeHtml(identity.subject)}</dd></div><div><dt>Stato</dt><dd>${identity.active ? 'Abilitata' : 'Disabilitata'}</dd></div></dl>${identity.note ? `<p class="entity-note"><strong>Nota</strong>${escapeHtml(identity.note)}</p>` : ''}</div><div class="sso-identity-actions"><button type="button" class="secondary" data-identity-toggle="${escapeHtml(identity.identityKey)}" data-active="${String(!identity.active)}">${identity.active ? 'Disabilita' : 'Abilita'}</button><button type="button" class="icon-button danger-button" data-identity-delete="${escapeHtml(identity.identityKey)}" aria-label="Elimina definitivamente il collegamento SSO ${escapeHtml(identity.provider)}" title="Elimina definitivamente il collegamento SSO"><span aria-hidden="true">&#128465;</span></button></div></article>`).join('') || '<p class="muted">Nessun collegamento SSO.</p>'}</div>${providers.some((provider) => provider.active) ? `<form id="link-sso" class="sso-link-form">${federatedIdentityFields(providers)}<button>Collega SSO verificato</button></form>` : '<p class="form-help">Non ci sono provider SSO attivi. Censiscine uno nella sezione SSO prima di creare collegamenti.</p>'}</section>`;
}

/** Builds the tab list for user administration without coupling it to a framework router. */
function userDetailTabs(hasSso: boolean): string {
  const tabs: Array<{ id: UserDetailTab; label: string }> = [
    ...(hasSso ? [{ id: 'sso' as const, label: 'Identità SSO' }] : []),
    { id: 'profile', label: 'Profilo e accesso' },
    { id: 'roles', label: 'Ruoli' },
    { id: 'grants', label: 'Grant diretti' },
  ];
  return `<div class="user-tabs" role="tablist" aria-label="Sezioni utente">${tabs.map((tab) => `<button id="user-tab-${tab.id}" type="button" role="tab" aria-controls="user-panel-${tab.id}" data-user-tab="${tab.id}">${tab.label}</button>`).join('')}</div>`;
}

/** Activates one user-management panel while keeping ARIA state in sync with the visible tab. */
function activateUserTab(tab: UserDetailTab): void {
  document.querySelectorAll<HTMLButtonElement>('[data-user-tab]').forEach((button) => {
    const selected = button.dataset.userTab === tab;
    button.setAttribute('aria-selected', String(selected));
    button.tabIndex = selected ? 0 : -1;
  });
  document.querySelectorAll<HTMLElement>('[data-user-panel]').forEach((panel) => {
    const selected = panel.dataset.userPanel === tab;
    panel.hidden = !selected;
      // Keep form IDs stable: the save handlers bind to profile/roles/grants.
      if (!panel.id) panel.id = `user-panel-${panel.dataset.userPanel}`;
      document.querySelector(`[data-user-tab="${panel.dataset.userPanel}"]`)?.setAttribute('aria-controls', panel.id);
  });
}

function selectedNumbers(form: HTMLFormElement, name: string): number[] {
  return Array.from(new FormData(form).getAll(name), (value) => Number(value));
}

/** Carica tutti gli utenti (usato da SSO e filtri, che popolano selettori completi). */
async function loadUsers(): Promise<UserRow[]> {
  return result(await getUsers({ includeGrants: true })) as UserRow[];
}

/** Carica la pagina corrente della lista utenti e il totale (header X-Total-Count). */
async function loadUsersPage(): Promise<{ users: UserRow[]; total: number }> {
  const response = await getUsers({
    includeGrants: true,
    limit: USERS_PAGE_SIZE,
    offset: usersPage * USERS_PAGE_SIZE,
  });
  const users = result<UserRow[]>(response);
  const headers = (response as unknown as { headers?: Headers }).headers;
  const totalHeader = headers?.get?.('X-Total-Count') ?? null;
  const parsed = totalHeader !== null && totalHeader !== '' ? Number(totalHeader) : Number.NaN;
  const total = Number.isFinite(parsed) ? parsed : usersPage * USERS_PAGE_SIZE + users.length;
  return { users, total };
}

/** Numeri di pagina da mostrare, con ellissi quando le pagine sono molte. */
function pageNumbers(current: number, total: number): Array<number | 'gap'> {
  if (total <= 7) {
    return Array.from({ length: total }, (_, index) => index + 1);
  }
  const wanted = new Set<number>([1, total, current, current - 1, current + 1]);
  const sorted = Array.from(wanted).filter((page) => page >= 1 && page <= total).sort((a, b) => a - b);
  const result: Array<number | 'gap'> = [];
  let previous = 0;
  for (const page of sorted) {
    if (previous !== 0 && page - previous > 1) {
      result.push('gap');
    }
    result.push(page);
    previous = page;
  }
  return result;
}

/** Paginatore orizzontale con numeri di pagina (troncati) e riepilogo del contesto. */
function pagerMarkup(totalPages: number): string {
  const context = `<span class="pager-context">${usersTotal} utent${usersTotal === 1 ? 'e' : 'i'}${totalPages > 1 ? ` · pagina ${usersPage + 1} di ${totalPages}` : ''}</span>`;
  if (totalPages <= 1) {
    return `<nav class="pager" aria-label="Paginazione utenti">${context}</nav>`;
  }

  const numbers = pageNumbers(usersPage + 1, totalPages).map((page) => page === 'gap'
    ? '<span class="pager-gap" aria-hidden="true">&hellip;</span>'
    : `<button type="button" class="pager-item" data-goto="${page}"${page === usersPage + 1 ? ' aria-current="page"' : ''}>${page}</button>`).join('');

  const controls = `<span class="pager-controls">`
    + `<button type="button" class="pager-item pager-nav" data-goto="prev"${usersPage === 0 ? ' disabled' : ''} aria-label="Pagina precedente">&lsaquo;</button>`
    + numbers
    + `<button type="button" class="pager-item pager-nav" data-goto="next"${usersPage >= totalPages - 1 ? ' disabled' : ''} aria-label="Pagina successiva">&rsaquo;</button>`
    + '</span>';

  return `<nav class="pager" aria-label="Paginazione utenti">${controls}${context}</nav>`;
}

/** Cella ruoli con etichette; se sono molte mostra "altre N" che espande la riga chiudendo le altre. */
function rolesCell(codiceUtente: number, userGrants?: UserRow['userGrants']): string {
  const labels = (userGrants?.ruoli ?? [])
    .map((role) => role.descrizioneRuolo?.trim() || (role.codiceRuolo ? `#${role.codiceRuolo}` : ''))
    .filter((label): label is string => label.length > 0);
  if (labels.length === 0) {
    return '<span class="muted">&mdash;</span>';
  }

  const limit = 2;
  if (labels.length <= limit) {
    return `<span class="roles-list">${labels.map(escapeHtml).join(', ')}</span>`;
  }

  const hiddenCount = labels.length - limit;
  return `<span class="roles-cell" data-roles-cell="${codiceUtente}">`
    + `<span class="roles-list" data-roles-collapsed>${labels.slice(0, limit).map(escapeHtml).join(', ')}</span>`
    + `<span class="roles-list" data-roles-full hidden>${labels.map(escapeHtml).join(', ')}</span>`
    + `<button type="button" class="link-button" data-roles-toggle="${codiceUtente}" data-roles-more="${hiddenCount}" aria-expanded="false">altre ${hiddenCount}</button>`
    + '</span>';
}

function setRolesExpanded(cell: HTMLElement, expanded: boolean): void {
  cell.querySelector<HTMLElement>('[data-roles-collapsed]')?.toggleAttribute('hidden', expanded);
  cell.querySelector<HTMLElement>('[data-roles-full]')?.toggleAttribute('hidden', !expanded);
  const button = cell.querySelector<HTMLButtonElement>('[data-roles-toggle]');
  if (button) {
    button.setAttribute('aria-expanded', String(expanded));
    button.textContent = expanded ? 'mostra meno' : `altre ${button.dataset.rolesMore ?? ''}`;
  }
}

/** Espande una riga alla volta, chiudendo le altre. */
function bindRolesToggles(): void {
  document.querySelectorAll<HTMLButtonElement>('[data-roles-toggle]').forEach((button) => {
    button.onclick = () => {
      const cell = button.closest<HTMLElement>('[data-roles-cell]');
      if (!cell) return;
      const willExpand = button.getAttribute('aria-expanded') !== 'true';
      document.querySelectorAll<HTMLElement>('[data-roles-cell]').forEach((other) => {
        if (other !== cell) setRolesExpanded(other, false);
      });
      setRolesExpanded(cell, willExpand);
    };
  });
}

async function detectFederatedAuthentication(): Promise<void> {
  if (!currentUser) return;
  try {
    await getFederatedIdentities(currentUser.codiceUtente);
    federatedAuthenticationAvailable = true;
  } catch {
    federatedAuthenticationAvailable = false;
  }
}

async function loginView(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  try {
    const values = formValues(event.currentTarget as HTMLFormElement);
    byId('login-error').textContent = '';
    const response = result<LoginResult>(await login({ email: values.email ?? '', password: values.password || undefined }));
    await completeLoginStep(response);
  } catch (error) {
    byId('login-error').textContent = error instanceof Error ? error.message : 'Login non riuscito.';
  }
}

let pendingChallenge: string | null = null;
let resendTimer: ReturnType<typeof setInterval> | undefined;

function resetLogin(): void {
  pendingChallenge = null;
  if (resendTimer) clearInterval(resendTimer);
  byId<HTMLFormElement>('login-form').reset();
  byId<HTMLFormElement>('two-factor-form').reset();
  byId('login-form').hidden = false;
  byId('two-factor-form').hidden = true;
  byId('password-field').hidden = true;
  byId('password-field').querySelector('input')!.disabled = true;
  byId('restart-login').hidden = true;
  byId('login-submit').textContent = 'Continua';
  byId('login-error').textContent = '';
}

function showTwoFactor(challenge: { challengeId: string; expiresAt?: string; resendAfterSeconds: number }): void {
  pendingChallenge = challenge.challengeId;
  byId('login-form').hidden = true;
  const password = byId('password-field').querySelector('input')!;
  password.value = '';
  password.disabled = true;
  byId('two-factor-form').hidden = false;
  byId('restart-login').hidden = false;
  byId<HTMLFormElement>('two-factor-form').reset();
  byId('two-factor-form').querySelector<HTMLInputElement>('input')!.focus();
  const expires = challenge.expiresAt ? new Date(challenge.expiresAt).toLocaleTimeString() : '';
  byId('two-factor-status').textContent = expires ? `Codice inviato. Scade alle ${expires}.` : 'Codice inviato. Controlla la tua email.';
  if (resendTimer) clearInterval(resendTimer);
  const availableAt = Date.now() + challenge.resendAfterSeconds * 1000;
  const update = () => {
    const seconds = Math.max(0, Math.ceil((availableAt - Date.now()) / 1000));
    const button = byId<HTMLButtonElement>('resend-code');
    button.disabled = seconds > 0;
    button.textContent = seconds ? `Reinvia tra ${seconds}s` : 'Invia un nuovo codice';
    if (!seconds && resendTimer) clearInterval(resendTimer);
  };
  update();
  resendTimer = setInterval(update, 1000);
}

async function completeLoginStep(response: LoginResult): Promise<void> {
  if (response.challenge) {
    showTwoFactor(response.challenge);
    return;
  }
  if (response.passwordRequired) {
    byId('password-field').hidden = false;
    const input = byId('password-field').querySelector('input')!;
    input.disabled = false;
    input.required = true;
    input.focus();
    byId('restart-login').hidden = false;
    byId('login-submit').textContent = 'Accedi';
    return;
  }
  if (!response.token?.value) throw new Error('Risposta di autenticazione incompleta.');
  token = response.token.value;
  sessionStorage.setItem('accessi-console-token', token);
  setAccessiConsoleToken(token);
  resetLogin();
  await bootstrap();
}

async function bootstrap(): Promise<void> {
  try {
    setAccessiConsoleToken(token);
    if (!token) throw new Error('Inserisci le credenziali amministrative.');
    const payload = result<AuthenticatedTokenPayloadDto>(await getUserByToken({ token }));
    currentUser = payload.userData;
    requireAdmin();
    await detectFederatedAuthentication();
    byId('who').textContent = `${currentUser.email} - superutente`;
    byId<HTMLButtonElement>('sso-navigation').hidden = !federatedAuthenticationAvailable;
    finishBoot('console');
    await navigate(viewFromLocation(), window.location.pathname === consoleBasePath);
  } catch (error) {
    token = null;
    currentUser = null;
    setAccessiConsoleToken(null);
    federatedAuthenticationAvailable = false;
    sessionStorage.removeItem('accessi-console-token');
    finishBoot('login');
    byId('login-error').textContent = error instanceof Error ? error.message : 'Sessione non valida.';
  }
}

async function showUsers(): Promise<void> {
  const { users, total } = await loadUsersPage();
  usersTotal = total;
  const totalPages = Math.max(1, Math.ceil(total / USERS_PAGE_SIZE));
  if (usersPage >= totalPages) usersPage = totalPages - 1;

  render(`<div class="toolbar"><button id="new-local">Nuovo utente locale</button>${federatedAuthenticationAvailable ? '<button id="new-sso">Nuovo utente SSO</button>' : ''}<button id="reload-users" class="secondary">Aggiorna</button></div>
    <div class="pager-row pager-row-top">${pagerMarkup(totalPages)}</div>
    <table><thead><tr><th>Utente</th><th>Stato</th><th>Accesso</th><th>2FA</th><th>Ruoli</th><th></th></tr></thead><tbody>
    ${users.map(({ utente, userGrants }) => `<tr><td>${escapeHtml(utente.email)}<br><span class="muted">${escapeHtml(utente.nome)} ${escapeHtml(utente.cognome)}</span></td><td>${escapeHtml(utente.statoRegistrazione)}</td><td>${utente.passwordlessLoginEnabled ? 'codice email' : utente.passwordLoginEnabled === false ? 'solo SSO' : 'password'}</td><td>${utente.flagDueFattori ? 'Attiva' : 'Disattiva'}</td><td class="roles-col">${rolesCell(utente.codiceUtente, userGrants)}</td><td><button data-user="${utente.codiceUtente}">Gestisci</button></td></tr>`).join('') || '<tr><td colspan="6" class="muted">Nessun utente.</td></tr>'}
    </tbody></table><div class="pager-row pager-row-bottom">${pagerMarkup(totalPages)}</div>`);

  byId('new-local').onclick = () => showLocalUserForm();
  if (federatedAuthenticationAvailable) byId('new-sso').onclick = () => handleAction(showSsoUserForm);
  byId('reload-users').onclick = () => handleAction(() => show('users'));
  document.querySelectorAll<HTMLButtonElement>('[data-goto]').forEach((button) => {
    button.onclick = () => handleAction(async () => {
      const target = button.dataset.goto;
      const nextPage = target === 'prev' ? usersPage - 1 : target === 'next' ? usersPage + 1 : Number(target) - 1;
      if (!Number.isInteger(nextPage) || nextPage < 0 || nextPage >= totalPages || nextPage === usersPage) return;
      usersPage = nextPage;
      await show('users');
    });
  });
  document.querySelectorAll<HTMLButtonElement>('[data-user]').forEach((button) => {
    button.onclick = () => handleAction(() => showUser(button.dataset.user ?? ''));
  });
  bindRolesToggles();
}

function authenticationPolicyFields(user: UserDto): string {
  return `<fieldset><legend>Verifica dell'accesso (opzionale)</legend>
    <label class="check"><input name="flagDueFattori" type="checkbox" ${user.flagDueFattori ? 'checked' : ''}> Richiedi un codice via email (2FA)</label>
    <p class="form-help">Se attiva, il codice è richiesto dopo password o SSO.</p>
    <label class="check"><input name="passwordlessLoginEnabled" type="checkbox" ${user.passwordlessLoginEnabled ? 'checked' : ''} ${user.flagDueFattori ? '' : 'disabled'}> Consenti accesso con il solo codice email</label>
    <p class="form-help">Accesso senza password (richiede il codice email).</p>
    </fieldset>`;
}

function showLocalUserForm(): void {
  render(`<button id="back">Indietro</button><h2>Nuovo utente locale</h2><p class="muted">Viene inviata l'e-mail per impostare la password.</p>
    <form id="local-user"><label>Email<input name="email" type="email" required><span class="form-help">Identificativo di accesso; riceverà l'email per la password.</span></label><label>Nome<input name="nome"></label><label>Cognome<input name="cognome"></label><button>Crea utente</button></form>`);
  byId('back').onclick = () => show('users');
  const localUserForm = document.getElementById('local-user') as HTMLFormElement | null;
  if (localUserForm) localUserForm.onsubmit = (event) => {
    event.preventDefault();
    handleAction(async () => {
      await createManagedUser(formValues(eventForm(event)) as unknown as RegisterRequest);
      showNotice('Utente creato; inviata la procedura di impostazione password.');
      await show('users');
    });
  };
}

async function showSsoUserForm(): Promise<void> {
  const providers = result<FederatedProvider[]>(await getFederatedProviders());
  if (!providers.some((provider) => provider.active)) {
    throw new Error('Prima di creare un utente SSO, censisci e abilita almeno un provider SSO.');
  }
  render(`<button id="back">Indietro</button><h2>Nuovo utente SSO</h2><p class="muted">Salva solo collegamenti già verificati dal backend.</p>
    <form id="sso-user"><label>Email<input name="email" type="email" required><span class="form-help">Email di contatto e identificativo Accessi dell'utente.</span></label><label>Nome<input name="nome"></label><label>Cognome<input name="cognome"></label>${federatedIdentityFields(providers)}<label class="check"><input name="passwordLoginEnabled" type="checkbox"> Abilita anche la password locale</label><span class="form-help">Se disattivato, l'utente accede solo via SSO.</span><button>Crea utente SSO</button></form>`);
  byId('back').onclick = () => show('ssoUsers');
  const ssoUserForm = document.getElementById('sso-user') as HTMLFormElement | null;
  if (ssoUserForm) ssoUserForm.onsubmit = (event) => {
    event.preventDefault();
    handleAction(async () => {
      const form = eventForm(event);
      const values = formValues(form);
      const request: CreateFederatedUserRequest = {
        provider: values.provider ?? '',
        subject: values.subject ?? '',
        note: values.note || undefined,
        passwordLoginEnabled: new FormData(form).has('passwordLoginEnabled'),
        user: { email: values.email ?? '', nome: values.nome || undefined, cognome: values.cognome || undefined },
      };
      await createFederatedUser(request);
      showNotice('Utente SSO creato e collegamento registrato.');
      await show('ssoUsers');
    });
  };
}

/** Catalogo dei provider SSO: elenco, censimento, modifica ed eliminazione. */
async function showSsoProviders(): Promise<void> {
  if (!federatedAuthenticationAvailable) throw new Error('SSO non è abilitato in questa istanza Accessi.');
  const providerList = result<FederatedProvider[]>(await getFederatedProviders());
  render(`<div class="toolbar"><button id="new-provider">Nuovo provider</button><button id="reload-providers" class="secondary">Aggiorna</button></div>
    <h2>Provider SSO</h2><p class="muted">La validazione di token, issuer e segreti resta nel backend. Un provider si elimina solo se nessuna identità è collegata.</p>
    <div class="menu-table-wrap"><table><thead><tr><th>Provider</th><th>Descrizione</th><th>Stato</th><th></th></tr></thead><tbody>${providerList.map((provider) => `<tr class="${provider.active ? '' : 'is-disabled'}"><td><code>${escapeHtml(provider.provider)}</code></td><td>${escapeHtml(provider.description)}</td><td>${provider.active ? 'Attivo' : 'Disabilitato'}</td><td class="row-actions"><button data-provider="${escapeHtml(provider.provider)}">Gestisci</button></td></tr>`).join('') || '<tr><td colspan="4" class="muted">Nessun provider censito.</td></tr>'}</tbody></table></div>`);
  byId('new-provider').onclick = () => showProviderForm();
  byId('reload-providers').onclick = () => handleAction(showSsoProviders);
  document.querySelectorAll<HTMLButtonElement>('[data-provider]').forEach((button) => {
    button.onclick = () => showProviderForm(providerList.find((provider) => provider.provider === button.dataset.provider));
  });
}

/** Utenti e identità SSO: elenco e collegamento delle identità. */
async function showSsoUsers(): Promise<void> {
  if (!federatedAuthenticationAvailable) throw new Error('SSO non è abilitato in questa istanza Accessi.');
  const users = await loadUsers();
  render(`<div class="toolbar"><button id="new-sso">Nuovo utente SSO</button><button id="reload-sso-users" class="secondary">Aggiorna</button></div>
    <h2>Utenti e identità SSO</h2><p class="muted">Gestisci i collegamenti provider/subject già verificati dal backend.</p>
    <div class="menu-table-wrap"><table><thead><tr><th>Utente</th><th>Accesso</th><th></th></tr></thead><tbody>${users.map(({ utente }) => `<tr><td>${escapeHtml(utente.email)}</td><td>${utente.passwordLoginEnabled === false ? 'solo SSO' : 'password e SSO'}</td><td class="row-actions"><button data-sso-user="${utente.codiceUtente}">Gestisci identità</button></td></tr>`).join('') || '<tr><td colspan="3" class="muted">Nessun utente.</td></tr>'}</tbody></table></div>`);
  byId('new-sso').onclick = () => handleAction(showSsoUserForm);
  byId('reload-sso-users').onclick = () => handleAction(showSsoUsers);
  document.querySelectorAll<HTMLButtonElement>('[data-sso-user]').forEach((button) => {
    button.onclick = () => handleAction(() => showUser(button.dataset.ssoUser ?? ''));
  });
}

/** Creates or updates catalog metadata; the provider key is immutable once identities reference it. */
function showProviderForm(provider?: FederatedProvider): void {
  const isExisting = provider !== undefined;
  render(`<button id="back" type="button">Indietro</button><div class="page-header"><div><p class="eyebrow">Catalogo SSO</p><h2>${isExisting ? 'Gestisci provider' : 'Nuovo provider'}</h2></div><span class="muted">Le configurazioni tecniche restano nel backend</span></div><form id="provider-form"><label>Chiave provider<input name="provider" value="${escapeHtml(provider?.provider)}" ${isExisting ? 'readonly' : ''} required><span class="form-help">Chiave usata dal backend nel payload SSO (es. <code>azure-ad-acme-prod</code>). Non modificabile dopo il censimento.</span></label><label>Descrizione<input name="description" value="${escapeHtml(provider?.description)}" required><span class="form-help">Nome leggibile per gli amministratori.</span></label><label>Nota<input name="note" value="${escapeHtml(provider?.note)}"><span class="form-help">Non inserire segreti o dati personali.</span></label>${isExisting ? `<label class="check"><input name="active" type="checkbox" ${provider.active ? 'checked' : ''}> Provider attivo</label><span class="form-help">Blocca nuovi login e collegamenti; lo storico resta.</span>` : ''}<button>${isExisting ? 'Salva provider' : 'Censisci provider'}</button>${isExisting ? '<button type="button" id="delete-provider" class="danger-button">Elimina provider</button>' : ''}</form>`);
  byId('back').onclick = () => show('ssoProviders');
  const deleteProviderButton = document.getElementById('delete-provider') as HTMLButtonElement | null;
  if (deleteProviderButton && provider) {
    deleteProviderButton.onclick = () => handleAction(async () => {
      if (!window.confirm(`Eliminare il provider ${provider.provider}? Operazione possibile solo se nessuna identita e collegata.`)) return;
      await deleteFederatedProvider(provider.provider);
      showNotice('Provider SSO eliminato.');
      await show('ssoProviders');
    });
  }
  const providerForm = document.getElementById('provider-form') as HTMLFormElement | null;
  if (providerForm) providerForm.onsubmit = (event) => {
    event.preventDefault();
    handleAction(async () => {
      const form = eventForm(event);
      const values = formValues(form);
      if (provider) {
        const request: UpdateFederatedProviderRequest = {
          description: values.description,
          note: values.note || undefined,
          active: new FormData(form).has('active'),
        };
        await updateFederatedProvider(provider.provider, request);
      } else {
        const request: CreateFederatedProviderRequest = {
          provider: values.provider ?? '',
          description: values.description ?? '',
          note: values.note || undefined,
        };
        await createFederatedProvider(request);
      }
      showNotice(isExisting ? 'Provider SSO aggiornato.' : 'Provider SSO censito.');
      await show('ssoProviders');
    });
  };
}

/** Opzioni dello stato di registrazione Accessi (UTENTI.STAREG). */
function registrationStateOptions(current: unknown): string {
  const states: Array<[number, string]> = [
    [0, 'Non definito'], [5, 'Inserito'], [10, 'Invitato'], [20, 'Confermato'], [50, 'Eliminato'], [99, 'Bloccato'],
  ];
  const currentValue = Number(current);
  return states.map(([value, label]) => `<option value="${value}" ${currentValue === value ? 'selected' : ''}>${label} (${value})</option>`).join('');
}

async function showUser(rawCode: string): Promise<void> {
  const codiceUtente = Number(rawCode);
  const [users, roles, grants, groups, providers] = await Promise.all([
    getUsers({ codiceUtente, includeGrants: true }),
    getRoles(),
    getUserRolesAndGrants(codiceUtente),
    getGroupsWithMenus({ includeDisabled: true }),
    federatedAuthenticationAvailable ? getFederatedProviders() : Promise.resolve(null),
  ]);
  const userRow = (result(users) as UserRow[])[0];
  if (!userRow?.utente) throw new Error('Utente non trovato.');
  const user = userRow.utente;
  const allRoles = result(roles) as Role[];
  const userGrants = result(grants) as { ruoli?: Array<{ codiceRuolo?: number }>; abilitazioni?: Permission[] };
  const menuGroups = result(groups) as GroupWithMenusEntity[];
  const providerList = providers ? result<FederatedProvider[]>(providers) : [];
  const linked = federatedAuthenticationAvailable
    ? result<ConsoleFederatedIdentity[]>(await getFederatedIdentities(codiceUtente))
    : [];
  const identitySection = federatedAuthenticationAvailable ? federatedIdentitySection(linked, providerList) : '';
  const defaultUserTab: UserDetailTab = federatedAuthenticationAvailable ? 'sso' : 'profile';
  render(`<div class="user-action-bar"><button id="back" type="button" class="secondary">Indietro</button><label class="inline-field">Stato registrazione<select id="user-state">${registrationStateOptions(user.statoRegistrazione)}</select></label><button id="save-state" type="button" class="secondary">Aggiorna stato</button><button id="disable-user" type="button" class="danger-button">Imposta stato eliminato</button></div><div class="page-header"><div><p class="eyebrow">Utente ${codiceUtente}</p><h2>${escapeHtml(user.email)}</h2></div><span class="muted">Gestione profilo, ruoli e autorizzazioni</span></div>${userDetailTabs(federatedAuthenticationAvailable)}<div class="user-editor">
    ${identitySection}
    <form id="profile" data-user-panel="profile" role="tabpanel" aria-labelledby="user-tab-profile"><h3>Profilo e accesso</h3><label>Nome<input name="nome" value="${escapeHtml(user.nome)}"></label><label>Cognome<input name="cognome" value="${escapeHtml(user.cognome)}"></label><label>Email<input name="email" type="email" value="${escapeHtml(user.email)}" required><span class="form-help">Identificativo di accesso e recapito.</span></label>${federatedAuthenticationAvailable ? `<label class="check"><input name="passwordLoginEnabled" type="checkbox" ${user.passwordLoginEnabled !== false ? 'checked' : ''}> Login con password</label><span class="form-help">Se disabilitato, il login con email e password restituisce un errore esplicito; restano valide le identità SSO attive.</span>` : ''}${authenticationPolicyFields(user)}<button>Salva</button></form>
    ${roleAssignmentEditor(allRoles, userGrants.ruoli, menuGroups)}
    ${directGrantEditor(menuGroups, userGrants.abilitazioni)}
    </div>`);
  byId('back').onclick = () => show('users');
  const userTabButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-user-tab]'));
  userTabButtons.forEach((button, index) => {
    button.onclick = () => activateUserTab(button.dataset.userTab as UserDetailTab);
    button.onkeydown = (event) => {
      const targetIndex = event.key === 'ArrowRight' ? (index + 1) % userTabButtons.length
        : event.key === 'ArrowLeft' ? (index - 1 + userTabButtons.length) % userTabButtons.length
          : event.key === 'Home' ? 0 : event.key === 'End' ? userTabButtons.length - 1 : -1;
      if (targetIndex < 0) return;
      event.preventDefault();
      const targetTab = userTabButtons[targetIndex];
      if (!targetTab) return;
      targetTab.focus();
      activateUserTab(targetTab.dataset.userTab as UserDetailTab);
    };
  });
  activateUserTab(defaultUserTab);
  const profileForm = document.getElementById('profile') as HTMLFormElement | null;
  if (profileForm) {
    const twoFactor = profileForm.elements.namedItem('flagDueFattori') as HTMLInputElement;
    const passwordless = profileForm.elements.namedItem('passwordlessLoginEnabled') as HTMLInputElement;
    twoFactor.onchange = () => {
      passwordless.disabled = !twoFactor.checked;
      if (!twoFactor.checked) passwordless.checked = false;
    };
    profileForm.onsubmit = event => {
      event.preventDefault();
      handleAction(async () => {
        const values = formValues(eventForm(event));
        const fields = new FormData(eventForm(event));
        await updateUtente(codiceUtente, {
          codiceUtente, email: values.email ?? '', nome: values.nome || undefined, cognome: values.cognome || undefined,
          flagDueFattori: fields.has('flagDueFattori'),
          passwordlessLoginEnabled: fields.has('passwordlessLoginEnabled'),
          ...(federatedAuthenticationAvailable ? { passwordLoginEnabled: fields.has('passwordLoginEnabled') } : {}),
        });
        if (codiceUtente === currentUser?.codiceUtente && (
          fields.has('flagDueFattori') !== Boolean(user.flagDueFattori) ||
          fields.has('passwordlessLoginEnabled') !== Boolean(user.passwordlessLoginEnabled)
        )) {
          token = null;
          sessionStorage.removeItem('accessi-console-token');
          setAccessiConsoleToken(null);
          resetLogin();
          await bootstrap();
          byId('login-error').textContent = 'Policy aggiornata. Accedi di nuovo con la nuova configurazione.';
          return;
        }
        await showUser(String(codiceUtente));
        activateUserTab('profile');
        showNotice('Profilo e policy aggiornati.');
      });
    };
  }

  const rolesForm = document.getElementById('roles') as HTMLFormElement | null;
  if (rolesForm) rolesForm.onsubmit = (event) => { event.preventDefault(); handleAction(async () => { await assignRolesToUser(codiceUtente, { roles: selectedNumbers(eventForm(event), 'role') }); showNotice('Ruoli aggiornati.'); }); };
  const grantsForm = document.getElementById('grants') as HTMLFormElement | null;
  if (grantsForm) grantsForm.onsubmit = (event) => { event.preventDefault(); handleAction(async () => { const permissions: Permission[] = []; new FormData(eventForm(event)).forEach((value, key) => { if (key.startsWith('grant:') && value) permissions.push({ codiceMenu: key.slice(6), tipoAbilitazione: Number(value) }); }); await assignPermissionsToUser(codiceUtente, { permissions }); showNotice('Grant aggiornati.'); }); };
  if (federatedAuthenticationAvailable) {
    const linkForm = document.getElementById('link-sso') as HTMLFormElement | null;
    if (linkForm) linkForm.onsubmit = (event) => { event.preventDefault(); handleAction(async () => { const values = formValues(eventForm(event)); await linkFederatedIdentity(codiceUtente, { provider: values.provider ?? '', subject: values.subject ?? '', note: values.note || undefined }); await showUser(String(codiceUtente)); }); };
    document.querySelectorAll<HTMLButtonElement>('[data-identity-toggle]').forEach((button) => { button.onclick = () => handleAction(async () => { await updateFederatedIdentity(button.dataset.identityToggle ?? '', { active: button.dataset.active === 'true' }); await showUser(String(codiceUtente)); }); });
    document.querySelectorAll<HTMLButtonElement>('[data-identity-delete]').forEach((button) => { button.onclick = () => handleAction(async () => { if (!window.confirm('Eliminare definitivamente questo collegamento SSO? L’utente Accessi non verrà eliminato.')) return; await deleteFederatedIdentityPermanently(codiceUtente, button.dataset.identityDelete ?? ''); showNotice('Collegamento SSO eliminato definitivamente.'); await showUser(String(codiceUtente)); }); });
  }
  byId('save-state').onclick = () => handleAction(async () => {
    const stateSelect = document.getElementById('user-state') as HTMLSelectElement | null;
    const statoRegistrazione = Number(stateSelect?.value ?? 0) as 0 | 5 | 10 | 20 | 50 | 99;
    await setStatoRegistrazione({ codiceUtente, statoRegistrazione });
    showNotice('Stato registrazione aggiornato.');
    await showUser(String(codiceUtente));
  });
  byId('disable-user').onclick = () => handleAction(async () => { await deleteUser(codiceUtente); showNotice('Utente impostato come eliminato.'); await show('users'); });
}

async function showRoles(): Promise<void> {
  const [rolesResponse, groupsResponse] = await Promise.all([getRoles(), getGroupsWithMenus({ includeDisabled: true })]);
  const roles = result(rolesResponse) as Role[];
  const groups = result(groupsResponse) as GroupWithMenusEntity[];
  render(`<div class="toolbar"><button id="new-role">Nuovo ruolo</button></div><h2>Ruoli</h2><p class="form-help">Definisci i ruoli e i menu che concedono. L'assegnazione agli utenti si gestisce dalla scheda utente.</p><div class="role-overview-list">${roles.map((role) => roleOverview(role, groups)).join('') || '<p class="muted">Nessun ruolo configurato.</p>'}</div>`);
  const roleForm = (role?: Role) => {
    render(`<button id="back" type="button">Indietro</button><h2>${role ? 'Modifica' : 'Nuovo'} ruolo</h2><form id="role-form"><label>Descrizione<input name="descrizione" value="${escapeHtml(role?.descrizioneRuolo)}" required><span class="form-help">Nome del ruolo.</span></label><p class="form-help">Seleziona i menu e il livello; il salvataggio sostituisce la configurazione del ruolo.</p><div class="role-menu-groups">${groups.map((group) => roleMenuEditorTable(group, role)).join('')}</div><button>Salva ruolo</button></form>`);
    byId('back').onclick = () => show('roles');
    document.querySelectorAll<HTMLInputElement>('#role-form input[name="menu"]').forEach((checkbox) => {
      checkbox.onchange = () => {
        const option = checkbox.closest('li');
        const level = option?.querySelector<HTMLSelectElement>('select[name^="menu-level:"]');
        if (level) level.disabled = !checkbox.checked;
      };
    });
    const roleFormElement = document.getElementById('role-form') as HTMLFormElement | null;
    if (roleFormElement) roleFormElement.onsubmit = async (event) => { event.preventDefault(); const form = eventForm(event); const data = new FormData(form); const request: Role = { descrizioneRuolo: formValues(form).descrizione ?? '', menu: Array.from(data.getAll('menu'), (codiceMenu) => ({ codiceMenu: String(codiceMenu), tipoAbilitazione: Number(data.get(`menu-level:${codiceMenu}`) ?? 10) as Role['menu'][number]['tipoAbilitazione'] })) }; if (role?.codiceRuolo) await updateRole(role.codiceRuolo, request); else await createRole(request); await show('roles'); };
  };
  byId('new-role').onclick = () => roleForm();
  document.querySelectorAll<HTMLButtonElement>('[data-role]').forEach((button) => button.onclick = () => roleForm(roles.find((role) => role.codiceRuolo === Number(button.dataset.role))));
  document.querySelectorAll<HTMLButtonElement>('[data-role-delete]').forEach((button) => button.onclick = () => handleAction(async () => {
    if (!window.confirm('Eliminare definitivamente questo ruolo? Le assegnazioni agli utenti verranno rimosse.')) return;
    await deleteRole(Number(button.dataset.roleDelete));
    showNotice('Ruolo eliminato.');
    await show('roles');
  }));
}

/** Tabella dei gruppi menu con toggle, conteggio menu e azioni. */
function menuGroupsTable(groups: GroupWithMenusEntity[]): string {
  return `<div class="menu-table-wrap"><table><thead><tr><th>Codice</th><th>Descrizione</th><th>Ordine</th><th>Menu</th><th>Stato</th><th></th></tr></thead><tbody>${groups.map((group) => `<tr class="${group.enabled === false ? 'is-disabled' : ''}"><td><code>${escapeHtml(group.codiceGruppo)}</code></td><td><strong>${escapeHtml(group.descrizioneGruppo)}</strong></td><td>${escapeHtml(group.ordineGruppo)}</td><td>${group.menus.length}</td><td><label class="table-toggle"><input type="checkbox" data-group="${escapeHtml(group.codiceGruppo)}" ${group.enabled !== false ? 'checked' : ''}><span>${group.enabled === false ? 'Disabilitato' : 'Abilitato'}</span></label></td><td class="row-actions"><button type="button" data-group-edit="${escapeHtml(group.codiceGruppo)}">Modifica</button><button type="button" class="danger-button" data-group-delete="${escapeHtml(group.codiceGruppo)}">Elimina</button></td></tr>`).join('') || '<tr><td colspan="6" class="muted">Nessun gruppo configurato.</td></tr>'}</tbody></table></div>`;
}

/** Tabella piatta di tutti i menu con gruppo, tipo e azioni; filtrabile per gruppo. */
function menusTable(entries: Array<{ menu: MenuEntity; group: GroupWithMenusEntity }>, menuTypes: MenuTypeEntity[]): string {
  const typeLabel = (codice?: string) => {
    if (!codice) return 'Non indicato';
    return menuTypes.find((type) => type.codiceTipo === codice)?.descrizioneTipo || codice;
  };
  return `<div class="menu-table-wrap"><table><thead><tr><th>Stato</th><th>Menu</th><th>Codice</th><th>Gruppo</th><th>Ordine</th><th>Tipo</th><th>Pagina</th><th></th></tr></thead><tbody>${entries.map(({ menu, group }) => `<tr class="${menu.enabled === false ? 'is-disabled' : ''}" data-menu-group="${escapeHtml(group.codiceGruppo)}"><td><label class="table-toggle"><input type="checkbox" data-menu="${escapeHtml(menu.codiceMenu)}" ${menu.enabled !== false ? 'checked' : ''}><span>${menu.enabled === false ? 'Disabilitato' : 'Abilitato'}</span></label></td><td><strong>${escapeHtml(menu.descrizioneMenu)}</strong>${menu.note ? `<br><span class="muted">${escapeHtml(menu.note)}</span>` : ''}</td><td><code>${escapeHtml(menu.codiceMenu)}</code></td><td>${escapeHtml(group.descrizioneGruppo)}</td><td>${escapeHtml(menu.ordineMenu)}</td><td>${escapeHtml(typeLabel(menu.tipo))}</td><td>${menu.pagina ? `<code>${escapeHtml(menu.pagina)}</code>` : '<span class="muted">Non indicata</span>'}</td><td class="row-actions"><button type="button" data-menu-edit="${escapeHtml(menu.codiceMenu)}">Modifica</button><button type="button" class="danger-button" data-menu-delete="${escapeHtml(menu.codiceMenu)}">Elimina</button></td></tr>`).join('') || '<tr><td colspan="8" class="muted">Nessun menu configurato.</td></tr>'}</tbody></table></div>`;
}

/** Tabella del catalogo tipi menu con azioni di modifica ed eliminazione. */
function menuTypeTable(types: MenuTypeEntity[]): string {
  return `<div class="menu-table-wrap"><table><thead><tr><th>Codice</th><th>Descrizione</th><th></th></tr></thead><tbody>${types.map((type) => `<tr><td><code>${escapeHtml(type.codiceTipo)}</code></td><td>${escapeHtml(type.descrizioneTipo || '\u2014')}</td><td class="row-actions"><button type="button" data-type-edit="${escapeHtml(type.codiceTipo)}">Modifica</button><button type="button" class="danger-button" data-type-delete="${escapeHtml(type.codiceTipo)}">Elimina</button></td></tr>`).join('') || '<tr><td colspan="3" class="muted">Nessun tipo menu.</td></tr>'}</tbody></table></div>`;
}

/** Gestione dei gruppi: elenco, creazione, modifica, eliminazione e toggle. */
async function showMenuGroups(): Promise<void> {
  const groups = result(await getGroupsWithMenus({ includeDisabled: true })) as GroupWithMenusEntity[];
  render(`<div class="toolbar"><button id="new-group">Nuovo gruppo</button><button id="reload-groups" class="secondary">Aggiorna</button></div>
    <h2>Gruppi di menu</h2><p class="form-help">Raggruppano i menu nella navigazione e ne definiscono l'ordine. Un gruppo si elimina solo se non contiene menu.</p>
    ${menuGroupsTable(groups)}`);
  byId('new-group').onclick = () => showMenuGroupForm();
  byId('reload-groups').onclick = () => handleAction(showMenuGroups);
  document.querySelectorAll<HTMLInputElement>('[data-group]').forEach((input) => {
    input.onchange = () => handleAction(async () => {
      await setGroupEnabled(input.dataset.group ?? '', { enabled: input.checked });
      showNotice('Gruppo aggiornato.');
    });
  });
  document.querySelectorAll<HTMLButtonElement>('[data-group-edit]').forEach((button) => {
    button.onclick = () => showMenuGroupForm(groups.find((group) => group.codiceGruppo === button.dataset.groupEdit));
  });
  document.querySelectorAll<HTMLButtonElement>('[data-group-delete]').forEach((button) => {
    button.onclick = () => handleAction(async () => {
      if (!window.confirm(`Eliminare il gruppo ${button.dataset.groupDelete}? Operazione possibile solo se non contiene menu.`)) return;
      await deleteMenuGroup(button.dataset.groupDelete ?? '');
      showNotice('Gruppo eliminato.');
      await showMenuGroups();
    });
  });
}

/** Gestione dei menu: elenco piatto filtrabile, creazione, modifica, eliminazione e toggle. */
async function showMenuItems(): Promise<void> {
  const [groupsResponse, typesResponse] = await Promise.all([
    getGroupsWithMenus({ includeDisabled: true }),
    getMenuTypes(),
  ]);
  const groups = result(groupsResponse) as GroupWithMenusEntity[];
  const menuTypes = result(typesResponse) as MenuTypeEntity[];
  const entries = groups.flatMap((group) => group.menus.map((menu) => ({ menu, group })));
  render(`<div class="toolbar"><button id="new-menu">Nuovo menu</button><button id="reload-menus" class="secondary">Aggiorna</button><label class="inline-field">Filtra per gruppo<select id="menu-group-filter"><option value="">Tutti i gruppi</option>${groups.map((group) => `<option value="${escapeHtml(group.codiceGruppo)}">${escapeHtml(group.descrizioneGruppo)}</option>`).join('')}</select></label></div>
    <h2>Menu</h2><p class="form-help">Voci di navigazione. L'eliminazione rimuove anche i grant utente e le associazioni ai ruoli.</p>
    ${menusTable(entries, menuTypes)}`);
  byId('new-menu').onclick = () => showMenuForm(undefined, groups, menuTypes);
  byId('reload-menus').onclick = () => handleAction(showMenuItems);
  const groupFilter = document.getElementById('menu-group-filter') as HTMLSelectElement | null;
  if (groupFilter) {
    groupFilter.onchange = () => {
      const selected = groupFilter.value;
      document.querySelectorAll<HTMLTableRowElement>('[data-menu-group]').forEach((row) => {
        row.hidden = selected !== '' && row.dataset.menuGroup !== selected;
      });
    };
  }
  document.querySelectorAll<HTMLInputElement>('[data-menu]').forEach((input) => {
    input.onchange = () => handleAction(async () => {
      await setMenuEnabled(input.dataset.menu ?? '', { enabled: input.checked });
      showNotice('Menu aggiornato.');
    });
  });
  document.querySelectorAll<HTMLButtonElement>('[data-menu-edit]').forEach((button) => {
    button.onclick = () => showMenuForm(entries.find((entry) => entry.menu.codiceMenu === button.dataset.menuEdit)?.menu, groups, menuTypes);
  });
  document.querySelectorAll<HTMLButtonElement>('[data-menu-delete]').forEach((button) => {
    button.onclick = () => handleAction(async () => {
      if (!window.confirm(`Eliminare il menu ${button.dataset.menuDelete}? Verranno rimossi anche i grant utente e le associazioni ai ruoli.`)) return;
      await deleteMenu(button.dataset.menuDelete ?? '');
      showNotice('Menu eliminato.');
      await showMenuItems();
    });
  });
}

/** Gestione dei tipi menu: elenco, creazione, modifica ed eliminazione. */
async function showMenuTypes(): Promise<void> {
  const menuTypes = result(await getMenuTypes()) as MenuTypeEntity[];
  render(`<div class="toolbar"><button id="new-menu-type">Nuovo tipo menu</button><button id="reload-menu-types" class="secondary">Aggiorna</button></div>
    <h2>Tipi menu</h2><p class="form-help">Classificano i menu (es. amministrazione, operatività). Un tipo si elimina solo se non è usato da alcun menu.</p>
    ${menuTypeTable(menuTypes)}`);
  byId('new-menu-type').onclick = () => showMenuTypeForm();
  byId('reload-menu-types').onclick = () => handleAction(showMenuTypes);
  document.querySelectorAll<HTMLButtonElement>('[data-type-edit]').forEach((button) => {
    button.onclick = () => showMenuTypeForm(menuTypes.find((type) => type.codiceTipo === button.dataset.typeEdit));
  });
  document.querySelectorAll<HTMLButtonElement>('[data-type-delete]').forEach((button) => {
    button.onclick = () => handleAction(async () => {
      if (!window.confirm(`Eliminare il tipo menu ${button.dataset.typeDelete}? Operazione possibile solo se nessun menu lo utilizza.`)) return;
      await deleteMenuType(button.dataset.typeDelete ?? '');
      showNotice('Tipo menu eliminato.');
      await showMenuTypes();
    });
  });
}

/** Form di creazione/modifica di un gruppo menu. */
function showMenuGroupForm(group?: GroupWithMenusEntity): void {
  const isExisting = group !== undefined;
  render(`<button id="back" type="button">Indietro</button><h2>${isExisting ? 'Modifica' : 'Nuovo'} gruppo menu</h2>
    <form id="group-form">
      <label>Codice gruppo<input name="codiceGruppo" maxlength="1" value="${escapeHtml(group?.codiceGruppo)}" ${isExisting ? 'readonly' : ''} required><span class="form-help">Un solo carattere, es. <code>A</code>. Immutabile dopo la creazione.</span></label>
      <label>Descrizione<input name="descrizioneGruppo" maxlength="100" value="${escapeHtml(group?.descrizioneGruppo)}" required></label>
      <label>Ordine<input name="ordineGruppo" type="number" value="${group?.ordineGruppo ?? ''}"><span class="form-help">Usato per ordinare i gruppi nella navigazione.</span></label>
      <label class="check"><input name="enabled" type="checkbox" ${group?.enabled !== false ? 'checked' : ''}> Gruppo abilitato</label>
      <button>${isExisting ? 'Salva gruppo' : 'Crea gruppo'}</button>
    </form>`);
  byId('back').onclick = () => handleAction(showMenuGroups);
  const form = document.getElementById('group-form') as HTMLFormElement | null;
  if (form) {
    form.onsubmit = (event) => {
      event.preventDefault();
      handleAction(async () => {
        const values = formValues(eventForm(event));
        const payload = {
          descrizioneGruppo: values.descrizioneGruppo || undefined,
          ordineGruppo: values.ordineGruppo ? Number(values.ordineGruppo) : undefined,
          enabled: new FormData(eventForm(event)).has('enabled'),
        };
        if (isExisting) await updateMenuGroup(group!.codiceGruppo, payload);
        else await createMenuGroup({ codiceGruppo: values.codiceGruppo ?? '', ...payload });
        showNotice(isExisting ? 'Gruppo aggiornato.' : 'Gruppo creato.');
        await showMenuGroups();
      });
    };
  }
}

/** Form di creazione/modifica di un menu, con selettori di gruppo e tipo. */
function showMenuForm(menu: MenuEntity | undefined, groups: GroupWithMenusEntity[], menuTypes: MenuTypeEntity[]): void {
  const isExisting = menu !== undefined;
  const groupOptions = groups.map((group) => `<option value="${escapeHtml(group.codiceGruppo)}" ${menu?.codiceGruppo === group.codiceGruppo ? 'selected' : ''}>${escapeHtml(group.codiceGruppo)} \u2013 ${escapeHtml(group.descrizioneGruppo)}</option>`).join('');
  const typeOptions = `<option value="">Nessun tipo</option>${menuTypes.map((type) => `<option value="${escapeHtml(type.codiceTipo)}" ${menu?.tipo === type.codiceTipo ? 'selected' : ''}>${escapeHtml(type.codiceTipo)} \u2013 ${escapeHtml(type.descrizioneTipo || '')}</option>`).join('')}`;
  render(`<button id="back" type="button">Indietro</button><h2>${isExisting ? 'Modifica' : 'Nuovo'} menu</h2>
    <form id="menu-form">
      <label>Codice menu<input name="codiceMenu" maxlength="20" value="${escapeHtml(menu?.codiceMenu)}" ${isExisting ? 'readonly' : ''} required><span class="form-help">Chiave tecnica, es. <code>MNU001</code>. Immutabile dopo la creazione.</span></label>
      <label>Descrizione<input name="descrizioneMenu" maxlength="100" value="${escapeHtml(menu?.descrizioneMenu)}" required></label>
      <label>Gruppo<select name="codiceGruppo" required>${groupOptions}</select><span class="form-help">Crea prima un gruppo se non ne esistono.</span></label>
      <label>Tipo menu<select name="tipo">${typeOptions}</select></label>
      <label>Icona<input name="icona" maxlength="50" value="${escapeHtml(menu?.icona)}"><span class="form-help">Identificatore icona usato dalla UI host.</span></label>
      <label>Pagina<input name="pagina" maxlength="50" value="${escapeHtml(menu?.pagina)}"><span class="form-help">Percorso o pagina associata al menu.</span></label>
      <label>Ordine<input name="ordineMenu" type="number" value="${menu?.ordineMenu ?? ''}"></label>
      <label>Menu di riferimento<input name="rifMenu" maxlength="20" value="${escapeHtml((menu as (MenuEntity & { rifMenu?: string }) | undefined)?.rifMenu)}"><span class="form-help">Codice di un menu padre, opzionale.</span></label>
      <label>Nota<textarea name="note" rows="3" maxlength="1000">${escapeHtml(menu?.note)}</textarea></label>
      <label class="check"><input name="enabled" type="checkbox" ${menu?.enabled !== false ? 'checked' : ''}> Menu abilitato</label>
      <button>${isExisting ? 'Salva menu' : 'Crea menu'}</button>
    </form>`);
  byId('back').onclick = () => handleAction(showMenuItems);
  const form = document.getElementById('menu-form') as HTMLFormElement | null;
  if (form) {
    form.onsubmit = (event) => {
      event.preventDefault();
      handleAction(async () => {
        const values = formValues(eventForm(event));
        const payload = {
          descrizioneMenu: values.descrizioneMenu || undefined,
          codiceGruppo: values.codiceGruppo ?? '',
          tipo: values.tipo || undefined,
          icona: values.icona || undefined,
          pagina: values.pagina || undefined,
          ordineMenu: values.ordineMenu ? Number(values.ordineMenu) : undefined,
          rifMenu: values.rifMenu || undefined,
          note: values.note || undefined,
          enabled: new FormData(eventForm(event)).has('enabled'),
        };
        if (isExisting) await updateMenu(menu!.codiceMenu, payload);
        else await createMenu({ codiceMenu: values.codiceMenu ?? '', ...payload });
        showNotice(isExisting ? 'Menu aggiornato.' : 'Menu creato.');
        await showMenuItems();
      });
    };
  }
}

/** Form di creazione/modifica di un tipo menu. */
function showMenuTypeForm(type?: MenuTypeEntity): void {
  const isExisting = type !== undefined;
  render(`<button id="back" type="button">Indietro</button><h2>${isExisting ? 'Modifica' : 'Nuovo'} tipo menu</h2>
    <form id="menu-type-form">
      <label>Codice tipo<input name="codiceTipo" maxlength="1" value="${escapeHtml(type?.codiceTipo)}" ${isExisting ? 'readonly' : ''} required><span class="form-help">Un solo carattere, es. <code>A</code>. Immutabile dopo la creazione.</span></label>
      <label>Descrizione<input name="descrizioneTipo" maxlength="20" value="${escapeHtml(type?.descrizioneTipo)}"></label>
      <button>${isExisting ? 'Salva tipo' : 'Crea tipo'}</button>
    </form>`);
  byId('back').onclick = () => handleAction(showMenuTypes);
  const form = document.getElementById('menu-type-form') as HTMLFormElement | null;
  if (form) {
    form.onsubmit = (event) => {
      event.preventDefault();
      handleAction(async () => {
        const values = formValues(eventForm(event));
        if (isExisting) await updateMenuType(type!.codiceTipo, { descrizioneTipo: values.descrizioneTipo || undefined });
        else await createMenuType({ codiceTipo: values.codiceTipo ?? '', descrizioneTipo: values.descrizioneTipo || undefined });
        showNotice(isExisting ? 'Tipo menu aggiornato.' : 'Tipo menu creato.');
        await showMenuTypes();
      });
    };
  }
}

/** Tabella del catalogo tipi filtro con azioni di modifica ed eliminazione. */
function filterTypeRows(types: TipoFiltro[]): string {
  return `<div class="menu-table-wrap"><table><thead><tr><th>Codice</th><th>Descrizione</th><th>Campo</th><th>Abilitato</th><th></th></tr></thead><tbody>${types.map((type) => `<tr class="${type.flgEnabled === 0 ? 'is-disabled' : ''}"><td><code>${escapeHtml(type.tipFil)}</code></td><td>${escapeHtml(type.desFil || '\u2014')}</td><td>${escapeHtml(type.fldFil || '\u2014')}</td><td>${type.flgEnabled === 0 ? 'No' : 'Si'}</td><td class="row-actions"><button type="button" data-filter-type-edit="${escapeHtml(type.tipFil)}">Modifica</button><button type="button" class="danger-button" data-filter-type-delete="${escapeHtml(type.tipFil)}">Elimina</button></td></tr>`).join('') || '<tr><td colspan="5" class="muted">Nessun tipo filtro.</td></tr>'}</tbody></table></div>`;
}

/** Filtri utente: lettura e salvataggio dei filtri applicativi per singolo utente. */
async function showFilters(): Promise<void> {
  const users = await loadUsers();
  render(`<h2>Filtri utente</h2><p class="form-help">Filtri applicativi salvati per singolo utente.</p><form id="filters"><label>Utente<select name="codUte">${users.map(({ utente }) => `<option value="${utente.codiceUtente}">${escapeHtml(utente.email)}</option>`).join('')}</select><span class="form-help">Salvati per l'utente selezionato.</span></label><label>Filtro JSON<textarea name="json" rows="12">{}</textarea><span class="form-help">Usa Carica per partire dalla struttura esistente.</span></label><button name="action" value="load">Carica</button><button name="action" value="save">Salva</button></form>`);
  const filtersForm = document.getElementById('filters') as HTMLFormElement | null;
  if (filtersForm) filtersForm.onsubmit = async (event) => { event.preventDefault(); const form = eventForm(event); const action = (event.submitter as HTMLButtonElement | null)?.value; const code = Number(formValues(form).codUte); if (action === 'load') { const filters = result<FiltriUtente[]>(await getFiltriUtente({ codUte: code })); (form.elements.namedItem('json') as HTMLTextAreaElement).value = JSON.stringify(filters[0] ?? { codUte: code }, null, 2); } else { const parsed = JSON.parse(formValues(form).json ?? '{}') as Omit<FiltriUtente, 'codUte'>; await saveFiltriUtente({ ...parsed, codUte: code }); showNotice('Filtri salvati.'); } };
}

/** Tipi filtro: catalogo dei tipi con creazione, modifica ed eliminazione. */
async function showFilterTypes(): Promise<void> {
  const filterTypes = result(await getTipiFiltro()) as TipoFiltro[];
  render(`<div class="toolbar"><button id="new-filter-type">Nuovo tipo filtro</button><button id="reload-filter-types" class="secondary">Aggiorna</button></div>
    <h2>Tipi filtro</h2><p class="form-help">Catalogo dei tipi usati dai filtri utente. Un tipo si elimina solo se nessun filtro lo utilizza.</p>
    ${filterTypeRows(filterTypes)}`);
  byId('new-filter-type').onclick = () => showFilterTypeForm();
  byId('reload-filter-types').onclick = () => handleAction(showFilterTypes);
  document.querySelectorAll<HTMLButtonElement>('[data-filter-type-edit]').forEach((button) => button.onclick = () => showFilterTypeForm(filterTypes.find((type) => String(type.tipFil) === button.dataset.filterTypeEdit)));
  document.querySelectorAll<HTMLButtonElement>('[data-filter-type-delete]').forEach((button) => button.onclick = () => handleAction(async () => {
    if (!window.confirm(`Eliminare il tipo filtro ${button.dataset.filterTypeDelete}? Operazione possibile solo se nessun filtro lo utilizza.`)) return;
    await deleteTipoFiltro(Number(button.dataset.filterTypeDelete));
    showNotice('Tipo filtro eliminato.');
    await showFilterTypes();
  }));
}

/** Form di creazione/modifica di un tipo filtro. */
function showFilterTypeForm(type?: TipoFiltro): void {
  const isExisting = type !== undefined;
  render(`<button id="back" type="button">Indietro</button><h2>${isExisting ? 'Modifica' : 'Nuovo'} tipo filtro</h2>
    <form id="filter-type-form">
      <label>Codice<input name="tipFil" type="number" value="${escapeHtml(type?.tipFil)}" ${isExisting ? 'readonly' : ''} required><span class="form-help">Identificativo numerico. Immutabile dopo la creazione.</span></label>
      <label>Descrizione<input name="desFil" maxlength="20" value="${escapeHtml(type?.desFil)}"></label>
      <label>Campo<input name="fldFil" maxlength="20" value="${escapeHtml(type?.fldFil)}"><span class="form-help">Nome del campo applicativo associato al filtro.</span></label>
      <label class="check"><input name="flgEnabled" type="checkbox" ${type?.flgEnabled !== 0 ? 'checked' : ''}> Abilitato</label>
      <button>${isExisting ? 'Salva tipo' : 'Crea tipo'}</button>
    </form>`);
  byId('back').onclick = () => handleAction(showFilterTypes);
  const form = document.getElementById('filter-type-form') as HTMLFormElement | null;
  if (form) {
    form.onsubmit = (event) => {
      event.preventDefault();
      handleAction(async () => {
        const values = formValues(eventForm(event));
        const payload = {
          desFil: values.desFil || undefined,
          fldFil: values.fldFil || undefined,
          flgEnabled: (new FormData(eventForm(event)).has('flgEnabled') ? 1 : 0) as 0 | 1,
        };
        if (isExisting) await updateTipoFiltro(type!.tipFil, payload);
        else await createTipoFiltro({ tipFil: Number(values.tipFil), ...payload });
        showNotice(isExisting ? 'Tipo filtro aggiornato.' : 'Tipo filtro creato.');
        await showFilterTypes();
      });
    };
  }
}

function scopeList(scopes: string[] | undefined): string {
  return (scopes ?? []).join(', ') || 'nessuno';
}

function serviceTokenExpiry(token: ServiceTokenDto): string {
  if (!token.expiresAt) return 'nessuna';
  const date = new Date(token.expiresAt);
  const days = Math.ceil((date.getTime() - Date.now()) / 86_400_000);
  const label = escapeHtml(date.toLocaleString());
  if (days < 0) return `${label}<br><span class="error">scaduto</span>`;
  if (days <= 7) return `${label}<br><span class="error">scade tra ${days} g</span>`;
  return label;
}

function serviceTokenRows(tokens: ServiceTokenDto[], includeRevoked: boolean): string {
  const lastUsed = (token: ServiceTokenDto) => token.lastUsedAt
    ? `<span title="${escapeHtml(token.lastUsedIp ?? '')}">${escapeHtml(new Date(token.lastUsedAt).toLocaleString())}</span>${token.lastUsedIp ? `<br><span class="muted">${escapeHtml(token.lastUsedIp)}</span>` : ''}`
    : 'mai';
  const status = (token: ServiceTokenDto) => token.revoked
    ? `Revocato${token.revokedBy ? ` da #${escapeHtml(token.revokedBy)}` : ''}${token.revokedAt ? `<br><span class="muted">${escapeHtml(new Date(token.revokedAt).toLocaleString())}</span>` : ''}`
    : 'Attivo';
  return tokens.map((token) => `<tr class="${token.revoked ? 'is-disabled' : ''}"><td><strong>${escapeHtml(token.label)}</strong><br><code>${escapeHtml(token.tokenId)}</code></td><td>${escapeHtml(scopeList(token.scopes))}</td><td>${escapeHtml(token.createdAt ? new Date(token.createdAt).toLocaleString() : '')}</td><td>${serviceTokenExpiry(token)}</td><td>${lastUsed(token)}</td><td>${status(token)}</td><td>${token.revoked ? '' : `<button type="button" data-rotate="${escapeHtml(token.tokenId)}">Ruota</button> <button type="button" class="danger-button" data-revoke="${escapeHtml(token.tokenId)}">Revoca</button>`}</td></tr>`).join('') || `<tr><td colspan="7">Nessun token ${includeRevoked ? '' : 'attivo'}.</td></tr>`;
}

/** Gestione dei token di servizio: elenco, creazione, rotazione e revoca. */
async function showServiceTokens(includeRevoked = false): Promise<void> {
  const tokens = result<ServiceTokenDto[]>(await getServiceTokens({ includeRevoked }));
  render(`<div class="toolbar"><button id="new-token">Nuovo token</button><button id="toggle-revoked" class="secondary">${includeRevoked ? 'Nascondi revocati' : 'Mostra revocati'}</button></div><h2>Token di servizio</h2><p class="form-help">Credenziali macchina-a-macchina per chiamate tecniche, non legate a un utente. Il segreto e mostrato <strong>una sola volta</strong> alla creazione: conservalo come variabile d'ambiente/secret. Autenticazione: <code>Authorization: Bearer &lt;token&gt;</code>.</p><table><thead><tr><th>Token</th><th>Scope</th><th>Creato</th><th>Scade</th><th>Ultimo uso</th><th>Stato</th><th></th></tr></thead><tbody>${serviceTokenRows(tokens, includeRevoked)}</tbody></table>`);
  byId('new-token').onclick = () => showServiceTokenForm();
  byId('toggle-revoked').onclick = () => handleAction(() => showServiceTokens(!includeRevoked));
  document.querySelectorAll<HTMLButtonElement>('[data-revoke]').forEach((button) => {
    button.onclick = () => handleAction(async () => {
      if (!window.confirm('Revocare definitivamente questo token? Le integrazioni che lo usano smetteranno di funzionare.')) return;
      await revokeServiceToken(button.dataset.revoke ?? '');
      showNotice('Token di servizio revocato.');
      await showServiceTokens(includeRevoked);
    });
  });
  document.querySelectorAll<HTMLButtonElement>('[data-rotate]').forEach((button) => {
    button.onclick = () => handleAction(async () => {
      const issued = result<IssuedServiceTokenDto>(await rotateServiceToken(button.dataset.rotate ?? ''));
      showIssuedServiceToken(issued);
    });
  });
}

function showServiceTokenForm(): void {
  render(`<button id="back" type="button" class="secondary">Indietro</button><h2>Nuovo token di servizio</h2><form id="token-form"><label>Descrizione<input name="label" required maxlength="100"><span class="form-help">Identifica l'integrazione, ad esempio "IA - produzione".</span></label><label>Scope<input name="scopes" placeholder="ia, chat"><span class="form-help">Separati da virgola (lettere, numeri, ':', '_', '-'). Definiscono cosa puo fare il token.</span></label><label>Durata in giorni<input name="ttlDays" type="number" min="1" step="1"><span class="form-help">Opzionale. Lascia vuoto per un token senza scadenza.</span></label><button>Crea token</button></form>`);
  byId('back').onclick = () => void show('tokens');
  const form = document.getElementById('token-form') as HTMLFormElement | null;
  if (form) form.onsubmit = (event) => {
    event.preventDefault();
    handleAction(async () => {
      const values = formValues(eventForm(event));
      const scopes = (values.scopes ?? '').split(',').map((scope) => scope.trim()).filter(Boolean);
      const ttlDays = values.ttlDays ? Number(values.ttlDays) : undefined;
      const issued = result<IssuedServiceTokenDto>(await createServiceToken({
        label: values.label ?? '',
        scopes: scopes.length ? scopes : undefined,
        ttlDays: Number.isFinite(ttlDays) ? ttlDays : undefined,
      }));
      showIssuedServiceToken(issued);
    });
  };
}

function showIssuedServiceToken(issued: IssuedServiceTokenDto): void {
  render(`<h2>Token creato</h2><p class="form-help">Copia ora il token: <strong>non sara piu mostrato</strong>. Salvalo come variabile d'ambiente/secret del servizio chiamante e non inserirlo nel body delle richieste.</p><div class="token-reveal"><code id="issued-token">${escapeHtml(issued.token)}</code><button id="copy-token" type="button">Copia</button></div><dl class="entity-metadata"><div><dt>Descrizione</dt><dd>${escapeHtml(issued.label)}</dd></div><div><dt>Scope</dt><dd>${escapeHtml(scopeList(issued.scopes))}</dd></div><div><dt>Scade</dt><dd>${issued.expiresAt ? escapeHtml(new Date(issued.expiresAt).toLocaleString()) : 'nessuna'}</dd></div></dl><button id="done-token">Ho copiato, chiudi</button>`);
  byId('copy-token').onclick = () => handleAction(async () => { await navigator.clipboard.writeText(issued.token); showNotice('Token copiato negli appunti.'); });
  byId('done-token').onclick = () => void show('tokens');
}

/** Rende un singolo blocco della wiki in HTML sicuro. */
function renderWikiBlock(block: WikiBlock): string {
  switch (block.kind) {
    case 'p':
      return `<p>${escapeHtml(block.text)}</p>`;
    case 'h':
      return `<h3>${escapeHtml(block.text)}</h3>`;
    case 'list': {
      const tag = block.ordered ? 'ol' : 'ul';
      return `<${tag}>${block.items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</${tag}>`;
    }
    case 'code': {
      const variant = block.variant ? ` is-${block.variant}` : '';
      const title = block.title ? `<span class="wiki-code-title">${escapeHtml(block.title)}</span>` : '';
      return `<figure class="wiki-code${variant}"><figcaption class="wiki-code-head">${title}<span class="wiki-code-lang">${escapeHtml(block.language)}</span><button type="button" class="wiki-copy" data-wiki-copy aria-label="Copia il codice">Copia</button></figcaption><pre><code>${escapeHtml(block.code)}</code></pre></figure>`;
    }
    case 'callout':
      return `<div class="wiki-callout is-${block.tone}">${block.title ? `<strong>${escapeHtml(block.title)}</strong>` : ''}<p>${escapeHtml(block.text)}</p></div>`;
    case 'table':
      return `<div class="wiki-table-wrap"><table><thead><tr>${block.head.map((cell) => `<th>${escapeHtml(cell)}</th>`).join('')}</tr></thead><tbody>${block.rows.map((row) => `<tr>${row.map((cell) => `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    default:
      return '';
  }
}

/** Indice laterale della wiki, raggruppato per area. */
function wikiIndexMarkup(selectedId: string): string {
  return wikiGroups().map(({ group, sections }) => `<div class="wiki-index-group"><span class="wiki-index-group-title">${escapeHtml(group)}</span><ul>${sections.map((section) => `<li><a href="#wiki-${escapeHtml(section.id)}" data-wiki="${escapeHtml(section.id)}"${section.id === selectedId ? ' aria-current="page"' : ''}>${escapeHtml(section.title)}</a></li>`).join('')}</ul></div>`).join('');
}

/** Wiki integrata: indice, contenuti e copia del digest per l'IA. */
async function showWiki(sectionId?: string): Promise<void> {
  const hashId = /^#wiki-([a-z0-9-]+)$/.exec(window.location.hash)?.[1];
  const requested = sectionId ?? hashId;
  const selected = WIKI_SECTIONS.find((section) => section.id === requested) ?? WIKI_SECTIONS[0];
  if (!selected) return;

  render(`<div class="wiki">
    <aside class="wiki-index">
      <div class="wiki-index-head"><strong>Indice</strong><button type="button" id="wiki-copy-ai">Copia per AI</button></div>
      ${wikiIndexMarkup(selected.id)}
    </aside>
    <article class="wiki-content">
      <header class="wiki-section-head"><h2>${escapeHtml(selected.title)}</h2><p>${escapeHtml(selected.summary)}</p></header>
      ${selected.blocks.map(renderWikiBlock).join('')}
    </article>
  </div>`);

  document.querySelectorAll<HTMLAnchorElement>('[data-wiki]').forEach((link) => {
    link.onclick = (event) => {
      event.preventDefault();
      const id = link.dataset.wiki ?? '';
      window.history.replaceState(null, '', `${routePath('wiki')}#wiki-${id}`);
      showWiki(id);
    };
  });
  document.querySelectorAll<HTMLButtonElement>('[data-wiki-copy]').forEach((button) => {
    button.onclick = () => handleAction(async () => {
      const codeEl = button.closest('.wiki-code')?.querySelector('code');
      await navigator.clipboard.writeText(codeEl?.textContent ?? '');
      showNotice('Codice copiato negli appunti.');
    });
  });
  byId('wiki-copy-ai').onclick = () => handleAction(async () => {
    await navigator.clipboard.writeText(buildAiDigest());
    showNotice('Documentazione per AI copiata negli appunti.');
  });
}

async function show(view: ConsoleView): Promise<void> {
  try {
    showNotice('');
    const views: Record<string, () => Promise<void>> = {
      users: showUsers,
      roles: showRoles,
      menuGroups: showMenuGroups,
      menuItems: showMenuItems,
      menuTypes: showMenuTypes,
      filterUser: showFilters,
      filterTypes: showFilterTypes,
      ssoProviders: showSsoProviders,
      ssoUsers: showSsoUsers,
      tokens: showServiceTokens,
      wiki: showWiki,
    };
    setActiveNavigation(view);
    const renderView = views[view];
    if (!renderView) throw new Error('Sezione console non valida.');
    await renderView();
  } catch (error) {
    render('');
    showNotice(error instanceof Error ? error.message : 'Operazione non riuscita.', true);
  }
}

const loginForm = document.getElementById('login-form') as HTMLFormElement | null;
if (loginForm) loginForm.onsubmit = loginView;
byId('restart-login').onclick = resetLogin;
byId<HTMLFormElement>('two-factor-form').onsubmit = async event => {
  event.preventDefault();
  if (!pendingChallenge) return;
  try {
    byId('login-error').textContent = '';
    const values = formValues(event.currentTarget as HTMLFormElement);
    await completeLoginStep(result<LoginResult>(await verifyTwoFactor({ challengeId: pendingChallenge, code: values.code ?? '' })));
  } catch (error) {
    byId('login-error').textContent = error instanceof Error ? error.message : 'Verifica non riuscita.';
  }
};
byId('resend-code').onclick = async () => {
  if (!pendingChallenge) return;
  try {
    byId('login-error').textContent = '';
    await completeLoginStep(result<LoginResult>(await resendTwoFactor({ challengeId: pendingChallenge })));
  } catch (error) {
    byId('login-error').textContent = error instanceof Error ? error.message : 'Reinvio non riuscito.';
  }
};
byId('logout').onclick = () => {
  resetLogin();
  token = null;
  currentUser = null;
  setAccessiConsoleToken(null);
  sessionStorage.removeItem('accessi-console-token');
  window.history.replaceState(null, '', consoleBasePath);
  void bootstrap();
};
byId('nav').onclick = (event) => {
  const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[data-view]');
  if (!link) return;
  event.preventDefault();
  handleAction(() => navigate(link.dataset.view as ConsoleView));
};
window.addEventListener('popstate', () => {
  if (token && currentUser) handleAction(() => show(viewFromLocation()));
});
window.addEventListener('accessi-console-network', (event: Event) => {
  updateLoadingState((event as CustomEvent<{ active: boolean }>).detail.active);
});
// Optional handoff from the hosting backend after its SSO callback. The fragment
// contains only an opaque challenge id, never an access token or provider token.
const ssoChallenge = /^#two-factor=([a-f0-9]{64})$/.exec(window.location.hash)?.[1];
if (ssoChallenge) {
  token = null;
  setAccessiConsoleToken(null);
  sessionStorage.removeItem('accessi-console-token');
  window.history.replaceState(null, '', window.location.pathname);
  finishBoot('login');
  showTwoFactor({ challengeId: ssoChallenge, resendAfterSeconds: 60 });
} else if (token) {
  void bootstrap();
} else {
  finishBoot('login');
}

