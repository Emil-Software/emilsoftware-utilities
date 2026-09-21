import {
  assignPermissionsToUser,
  assignRolesToUser,
  createFederatedUser,
  createFederatedProvider,
  createManagedUser,
  createRole,
  createServiceToken,
  deleteFederatedIdentityPermanently,
  deleteUser,
  getFederatedIdentities,
  getFederatedProviders,
  getFiltriUtente,
  getGroupsWithMenus,
  getRoles,
  getServiceTokens,
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
  updateFederatedIdentity,
  updateFederatedProvider,
  updateRole,
  updateUtente,
} from './generated/accessiApi';
import { setAccessiConsoleToken } from './accessiFetch';
import type {
  CreateFederatedUserRequest,
  CreateFederatedProviderRequest,
  AuthenticatedTokenPayloadDto,
  FiltriUtente,
  FederatedProviderResponseDto,
  GroupWithMenusEntity,
  LoginResult,
  MenuEntity,
  Permission,
  RegisterRequest,
  Role,
  ServiceTokenDto,
  IssuedServiceTokenDto,
  UserDto,
  UpdateFederatedProviderRequest,
} from './generated/model';

type UserRow = { utente: UserDto; userGrants?: { ruoli?: Array<{ codiceRuolo?: number }> } };
type ConsoleUser = { codiceUtente: number; email?: string; flagSuper: boolean; flagAdminConfigurator: boolean };
type FederatedProvider = FederatedProviderResponseDto;
type ConsoleFederatedIdentity = { identityKey: string; provider: string; subject: string; active: boolean; note?: string };
type UserDetailTab = 'sso' | 'profile' | 'roles' | 'grants';
type ConsoleView = 'users' | 'roles' | 'menus' | 'filters' | 'sso' | 'tokens';

const routeSegment: Record<ConsoleView, string> = {
  users: 'utenti',
  roles: 'ruoli-e-grant',
  menus: 'menu-e-gruppi',
  filters: 'filtri',
  sso: 'sso',
  tokens: 'token-di-servizio',
};
const routeView = Object.fromEntries(Object.entries(routeSegment).map(([view, segment]) => [segment, view])) as Record<string, ConsoleView>;
const consoleMarker = '/accessi/console';
const consoleMarkerIndex = window.location.pathname.indexOf(consoleMarker);
const consoleBasePath = consoleMarkerIndex >= 0
  ? window.location.pathname.slice(0, consoleMarkerIndex + consoleMarker.length)
  : `${window.location.pathname.replace(/\/$/, '')}`;

let token = sessionStorage.getItem('accessi-console-token');
let currentUser: ConsoleUser | null = null;
let federatedAuthenticationAvailable = false;
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
  byId('notice').innerHTML = `<span class="${isError ? 'error' : ''}">${escapeHtml(message)}</span>`;
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
  return `<form id="grants" class="user-editor-section grants-editor" data-user-panel="grants" role="tabpanel" aria-labelledby="user-tab-grants"><h3>Grant diretti</h3><p class="form-help">Abilitazioni assegnate direttamente all'utente, indipendenti dai ruoli. Seleziona <strong>nessuno</strong> per rimuoverle. Le voci disabilitate restano visibili per non perdere grant esistenti al salvataggio.</p><div class="grant-menu-groups">${groups.map((group) => `<fieldset class="grant-menu-group"><legend>${escapeHtml(group.descrizioneGruppo)}</legend>${groupMetadata(group)}<div class="grant-menu-options">${group.menus.map((menu) => { const grant = (grants ?? []).find((item) => item.codiceMenu === menu.codiceMenu); return `<div class="grant-menu-option ${menu.enabled === false ? 'is-disabled' : ''}"><div class="grant-menu-info"><strong>${escapeHtml(menu.descrizioneMenu)}</strong>${menuMetadata(menu)}</div><label class="grant-level">Livello di grant<select name="grant:${escapeHtml(menu.codiceMenu)}"><option value="">nessuno</option>${permissionSelectOptions(grant?.tipoAbilitazione)}</select></label></div>`; }).join('') || '<p class="form-help">Nessun menu configurato in questo gruppo.</p>'}</div></fieldset>`).join('')}</div><button>Salva grant</button></form>`;
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
  return `<form id="roles" class="user-editor-section roles-editor" data-user-panel="roles" role="tabpanel" aria-labelledby="user-tab-roles"><h3>Ruoli</h3><p class="form-help">Ogni ruolo assegna i menu elencati sotto con il relativo livello. Salvare sostituisce la selezione dei ruoli dell'utente, non i grant diretti.</p><div class="role-assignment-list">${roles.map((role) => { const roleMenus = role.menu ?? []; const assigned = (assignedRoles ?? []).some((current) => current.codiceRuolo === role.codiceRuolo); const groupedMenus = groups.map((group) => ({ group, entries: group.menus.map((menu) => ({ menu, assignment: roleMenus.find((item) => item.codiceMenu === menu.codiceMenu) })).filter((entry) => entry.assignment) })).filter((entry) => entry.entries.length > 0); const missingMenus = roleMenus.filter((item) => !catalogMenus.has(item.codiceMenu)); return `<article class="role-assignment-card"><div class="role-assignment-heading"><label class="check"><input type="checkbox" name="role" value="${escapeHtml(role.codiceRuolo)}" ${assigned ? 'checked' : ''}><span><strong>${escapeHtml(role.descrizioneRuolo)}</strong><small>Codice ruolo: ${escapeHtml(role.codiceRuolo)}</small></span></label><span class="role-menu-count">${roleMenus.length} menu</span></div><div class="role-permission-groups">${groupedMenus.map(({ group, entries }) => `<section class="role-permission-group"><div class="role-permission-group-heading"><strong>${escapeHtml(group.descrizioneGruppo)}</strong>${groupMetadata(group)}</div>${entries.map(({ menu, assignment }) => `<div class="role-permission-entry ${menu.enabled === false ? 'is-disabled' : ''}"><div><strong>${escapeHtml(menu.descrizioneMenu)}</strong>${menuMetadata(menu)}</div><span class="permission-level">${escapeHtml(rolePermissionLevel(assignment?.tipoAbilitazione))}</span></div>`).join('')}</section>`).join('') || '<p class="form-help">Questo ruolo non contiene menu attivi nel catalogo.</p>'}${missingMenus.length ? `<section class="role-permission-group missing-role-menus"><strong>Menu non più presenti nel catalogo</strong>${missingMenus.map((menu) => `<div class="role-permission-entry"><div><strong>${escapeHtml(menu.codiceMenu)}</strong><p class="entity-note">Il menu è ancora associato al ruolo ma non è disponibile nel catalogo corrente.</p></div><span class="permission-level">${escapeHtml(rolePermissionLevel(menu.tipoAbilitazione))}</span></div>`).join('')}</section>` : ''}</div></article>`; }).join('')}</div><button>Salva ruoli</button></form>`;
}

/** Renders a read-first role overview with all groups, menus and permission levels. */
function roleOverview(role: Role, groups: GroupWithMenusEntity[]): string {
  const roleMenus = role.menu ?? [];
  const catalogMenus = new Map(groups.flatMap((group) => group.menus.map((menu) => [menu.codiceMenu, menu])));
  const groupedMenus = groups.map((group) => ({ group, entries: group.menus.map((menu) => ({ menu, assignment: roleMenus.find((item) => item.codiceMenu === menu.codiceMenu) })).filter((entry) => entry.assignment) })).filter((entry) => entry.entries.length > 0);
  const missingMenus = roleMenus.filter((item) => !catalogMenus.has(item.codiceMenu));
  return `<article class="role-assignment-card role-overview-card"><details class="role-overview-details"><summary class="role-assignment-heading"><div class="role-identity"><span class="role-kind">Ruolo</span><strong>${escapeHtml(role.descrizioneRuolo)}</strong><span class="role-code">Codice ruolo: ${escapeHtml(role.codiceRuolo)}</span></div><div class="role-overview-actions"><span class="role-menu-count">${roleMenus.length} menu</span><span class="role-expand-hint"><span class="when-closed">Mostra menu</span><span class="when-open">Nascondi menu</span></span></div></summary><div class="role-permission-groups">${groupedMenus.map(({ group, entries }) => `<section class="role-permission-group"><div class="role-permission-group-heading"><div><span class="group-kind">Gruppo</span><strong>${escapeHtml(group.descrizioneGruppo)}</strong></div>${groupMetadata(group)}</div>${entries.map(({ menu, assignment }) => `<div class="role-permission-entry ${menu.enabled === false ? 'is-disabled' : ''}"><div><span class="menu-kind">Menu</span><strong>${escapeHtml(menu.descrizioneMenu)}</strong>${menuMetadata(menu)}</div><span class="permission-level">${escapeHtml(rolePermissionLevel(assignment?.tipoAbilitazione))}</span></div>`).join('')}</section>`).join('') || '<p class="form-help">Questo ruolo non contiene menu attivi nel catalogo.</p>'}${missingMenus.length ? `<section class="role-permission-group missing-role-menus"><strong>Menu non più presenti nel catalogo</strong>${missingMenus.map((menu) => `<div class="role-permission-entry"><div><strong>${escapeHtml(menu.codiceMenu)}</strong><p class="entity-note">Il menu è ancora associato al ruolo ma non è disponibile nel catalogo corrente.</p></div><span class="permission-level">${escapeHtml(rolePermissionLevel(menu.tipoAbilitazione))}</span></div>`).join('')}</section>` : ''}</div></details><button type="button" class="role-edit-button" data-role="${escapeHtml(role.codiceRuolo)}">Modifica</button></article>`;
}

/** Builds a compact tabular inventory of the menus belonging to one group. */
function menuGroupTable(group: GroupWithMenusEntity): string {
  return `<article class="menu-group-card ${group.enabled === false ? 'is-disabled' : ''}"><div class="menu-group-header"><label class="check"><input type="checkbox" data-group="${escapeHtml(group.codiceGruppo)}" ${group.enabled !== false ? 'checked' : ''}><span><strong>${escapeHtml(group.descrizioneGruppo)}</strong><small>Gruppo di menu</small></span></label>${groupMetadata(group)}</div><div class="menu-table-wrap"><table class="menu-table"><thead><tr><th>Stato</th><th>Menu</th><th>Codice</th><th>Ordine</th><th>Tipo</th><th>Pagina</th><th>Icona</th><th>Nota</th></tr></thead><tbody>${group.menus.map((menu) => `<tr class="${menu.enabled === false ? 'is-disabled' : ''}"><td><label class="table-toggle"><input type="checkbox" data-menu="${escapeHtml(menu.codiceMenu)}" ${menu.enabled !== false ? 'checked' : ''}><span>${menu.enabled === false ? 'Disabilitato' : 'Abilitato'}</span></label></td><td><strong>${escapeHtml(menu.descrizioneMenu)}</strong></td><td><code>${escapeHtml(menu.codiceMenu)}</code></td><td>${escapeHtml(menu.ordineMenu)}</td><td>${escapeHtml(menu.tipo || 'Non indicato')}</td><td>${menu.pagina ? `<code>${escapeHtml(menu.pagina)}</code>` : '<span class="muted">Non indicata</span>'}</td><td>${menu.icona ? `<code>${escapeHtml(menu.icona)}</code>` : '<span class="muted">Non indicata</span>'}</td><td>${escapeHtml(menu.note || 'Nessuna nota')}</td></tr>`).join('') || '<tr><td colspan="8" class="muted">Nessun menu configurato in questo gruppo.</td></tr>'}</tbody></table></div></article>`;
}

/** Builds one grouped, row-oriented permission table for the role editor. */
function roleMenuEditorTable(group: GroupWithMenusEntity, role?: Role): string {
  const roleMenus = role?.menu ?? [];
  return `<article class="role-menu-group ${group.enabled === false ? 'is-disabled' : ''}"><div class="menu-group-header"><div><strong>${escapeHtml(group.descrizioneGruppo)}</strong><small>Gruppo di menu</small></div>${groupMetadata(group)}</div><div class="menu-table-wrap"><table class="menu-table role-menu-table"><thead><tr><th scope="col">Incluso</th><th scope="col">Menu</th><th scope="col">Codice</th><th scope="col">Ordine</th><th scope="col">Tipo</th><th scope="col">Pagina</th><th scope="col">Icona</th><th scope="col">Stato</th><th scope="col">Abilitazione</th><th scope="col">Nota</th></tr></thead><tbody>${group.menus.map((menu) => { const assignment = roleMenus.find((item) => item.codiceMenu === menu.codiceMenu); const level = assignment?.tipoAbilitazione ?? 10; return `<tr class="${menu.enabled === false ? 'is-disabled' : ''}"><td><label class="table-toggle"><input type="checkbox" name="menu" value="${escapeHtml(menu.codiceMenu)}" ${assignment ? 'checked' : ''} aria-label="Includi ${escapeHtml(menu.descrizioneMenu)}"><span>${assignment ? 'Incluso' : 'Escluso'}</span></label></td><td><strong>${escapeHtml(menu.descrizioneMenu)}</strong></td><td><code>${escapeHtml(menu.codiceMenu)}</code></td><td>${escapeHtml(menu.ordineMenu)}</td><td>${escapeHtml(menu.tipo || 'Non indicato')}</td><td>${menu.pagina ? `<code>${escapeHtml(menu.pagina)}</code>` : '<span class="muted">Non indicata</span>'}</td><td>${menu.icona ? `<code>${escapeHtml(menu.icona)}</code>` : '<span class="muted">Non indicata</span>'}</td><td><span class="status-label ${menu.enabled === false ? 'status-disabled' : 'status-enabled'}">${menu.enabled === false ? 'Disabilitato' : 'Abilitato'}</span></td><td><label class="table-select"><span class="sr-only">Abilitazione per ${escapeHtml(menu.descrizioneMenu)}</span><select name="menu-level:${escapeHtml(menu.codiceMenu)}" ${assignment ? '' : 'disabled'}>${permissionSelectOptions(level)}</select></label></td><td>${escapeHtml(menu.note || 'Nessuna nota')}</td></tr>`; }).join('') || '<tr><td colspan="10" class="muted">Nessun menu configurato in questo gruppo.</td></tr>'}</tbody></table></div></article>`;
}

/**
 * Shows a delayed, concurrency-safe application loader for all Orval requests.
 * The delay avoids a distracting flash for fast operations; the minimum display
 * time makes visible operations feel intentional instead of flickering.
 */
function updateLoadingState(active: boolean): void {
  pendingNetworkRequests = Math.max(0, pendingNetworkRequests + (active ? 1 : -1));
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
}

/** Returns the canonical browser path for a top-level console section. */
function routePath(view: ConsoleView): string {
  return `${consoleBasePath}/${routeSegment[view]}`;
}

/** Resolves a console section from the current pathname, defaulting to users. */
function viewFromLocation(): ConsoleView {
  const relativePath = window.location.pathname.slice(consoleBasePath.length).replace(/^\/+|\/+$/g, '');
  return routeView[decodeURIComponent(relativePath)] ?? 'users';
}

/** Navigates through the browser history and renders the requested SPA section. */
async function navigate(view: ConsoleView, replace = false): Promise<void> {
  const destination = routePath(view);
  if (window.location.pathname !== destination) {
    window.history[replace ? 'replaceState' : 'pushState']({ view }, '', destination);
  }
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
  return `<label>Provider<select name="provider" required><option value="">Seleziona un provider</option>${providers.filter((provider) => provider.active).map((provider) => `<option value="${escapeHtml(provider.provider)}">${escapeHtml(provider.description)} (${escapeHtml(provider.provider)})</option>`).join('')}</select><span class="form-help">Catalogo Accessi dei sistemi SSO disponibili. La chiave selezionata deve corrispondere alla configurazione del backend; per Azure deve distinguere tenant e ambiente.</span></label>
    <label>ID utente del provider (subject)<input name="subject" required><span class="form-help">Identifica in modo stabile la singola persona nel provider. Il backend lo estrae dopo la verifica: per esempio <code>oid</code> Azure, <code>sub</code> OpenID Connect/Google/Apple o <code>NameID</code> SAML persistente. È necessario perché il provider da solo non identifica l'utente. Non usare l'email: può cambiare.</span></label>
    <label>Nota<input name="note"><span class="form-help">Annotazione interna per gli amministratori. Non viene inviata al provider e non assegna autorizzazioni.</span></label>`;
}

/** Renders high-priority SSO identity management for one Accessi user. */
function federatedIdentitySection(identities: ConsoleFederatedIdentity[], providers: FederatedProvider[]): string {
  return `<section class="user-editor-section sso-identity-section" data-user-panel="sso" role="tabpanel" aria-labelledby="user-tab-sso"><div class="section-heading"><div><p class="eyebrow">Autenticazione esterna</p><h3>Identità SSO</h3></div><span class="muted">Collegamenti verificati dal backend</span></div><p class="form-help">Ogni collegamento riconosce l'utente presso un provider. Disabilita conserva lo storico e blocca il login; elimina rimuove definitivamente il collegamento, senza eliminare l'utente Accessi.</p><div class="sso-identity-list">${identities.map((identity) => `<article class="sso-identity-item ${identity.active ? '' : 'is-disabled'}"><div class="sso-identity-data"><strong>${escapeHtml(identity.provider)}</strong><dl class="entity-metadata"><div><dt>Subject</dt><dd>${escapeHtml(identity.subject)}</dd></div><div><dt>Stato</dt><dd>${identity.active ? 'Abilitata' : 'Disabilitata'}</dd></div></dl>${identity.note ? `<p class="entity-note"><strong>Nota</strong>${escapeHtml(identity.note)}</p>` : ''}</div><div class="sso-identity-actions"><button type="button" class="secondary" data-identity-toggle="${escapeHtml(identity.identityKey)}" data-active="${String(!identity.active)}">${identity.active ? 'Disabilita' : 'Abilita'}</button><button type="button" class="icon-button danger-button" data-identity-delete="${escapeHtml(identity.identityKey)}" aria-label="Elimina definitivamente il collegamento SSO ${escapeHtml(identity.provider)}" title="Elimina definitivamente il collegamento SSO"><span aria-hidden="true">&#128465;</span></button></div></article>`).join('') || '<p class="muted">Nessun collegamento SSO.</p>'}</div>${providers.some((provider) => provider.active) ? `<form id="link-sso" class="sso-link-form">${federatedIdentityFields(providers)}<button>Collega SSO verificato</button></form>` : '<p class="form-help">Non ci sono provider SSO attivi. Censiscine uno nella sezione SSO prima di creare collegamenti.</p>'}</section>`;
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

async function loadUsers(): Promise<UserRow[]> {
  return result(await getUsers({ includeGrants: true })) as UserRow[];
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
    const response = result<LoginResult>(await login({ email: values.email, password: values.password || undefined }));
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
    byId('login').hidden = true;
    byId('console').hidden = false;
    byId('who').textContent = `${currentUser.email} - superutente`;
    byId<HTMLButtonElement>('sso-navigation').hidden = !federatedAuthenticationAvailable;
    await navigate(viewFromLocation(), window.location.pathname === consoleBasePath);
  } catch (error) {
    token = null;
    currentUser = null;
    setAccessiConsoleToken(null);
    federatedAuthenticationAvailable = false;
    sessionStorage.removeItem('accessi-console-token');
    byId('login').hidden = false;
    byId('console').hidden = true;
    byId('login-error').textContent = error instanceof Error ? error.message : 'Sessione non valida.';
  }
}

async function showUsers(): Promise<void> {
  const users = await loadUsers();
  render(`<div class="toolbar"><button id="new-local">Nuovo utente locale</button>${federatedAuthenticationAvailable ? '<button id="new-sso">Nuovo utente SSO</button>' : ''}<button id="reload-users" class="secondary">Aggiorna</button></div>
    <h2>Utenti</h2><table><thead><tr><th>Utente</th><th>Stato</th><th>Accesso</th><th>2FA</th><th>Ruoli</th><th></th></tr></thead><tbody>
    ${users.map(({ utente, userGrants }) => `<tr><td>${escapeHtml(utente.email)}<br><span class="muted">${escapeHtml(utente.nome)} ${escapeHtml(utente.cognome)}</span></td><td>${escapeHtml(utente.statoRegistrazione)}</td><td>${utente.passwordlessLoginEnabled ? 'codice email' : utente.passwordLoginEnabled === false ? 'solo SSO' : 'password'}</td><td>${utente.flagDueFattori ? 'Attiva' : 'Disattiva'}</td><td>${(userGrants?.ruoli ?? []).map((role) => role.codiceRuolo).join(', ')}</td><td><button data-user="${utente.codiceUtente}">Gestisci</button></td></tr>`).join('')}
    </tbody></table>`);
  byId('new-local').onclick = () => showLocalUserForm();
  if (federatedAuthenticationAvailable) byId('new-sso').onclick = () => handleAction(showSsoUserForm);
  byId('reload-users').onclick = () => handleAction(() => show('users'));
  document.querySelectorAll<HTMLButtonElement>('[data-user]').forEach((button) => {
    button.onclick = () => handleAction(() => showUser(button.dataset.user ?? ''));
  });
}

function authenticationPolicyFields(user: UserDto): string {
  return `<fieldset><legend>Verifica dell'accesso (opzionale)</legend>
    <label class="check"><input name="flagDueFattori" type="checkbox" ${user.flagDueFattori ? 'checked' : ''}> Richiedi un codice via email (2FA)</label>
    <p class="form-help">Disattiva per impostazione predefinita. Se attiva, il codice viene richiesto dopo la password o dopo l'accesso SSO.</p>
    <label class="check"><input name="passwordlessLoginEnabled" type="checkbox" ${user.passwordlessLoginEnabled ? 'checked' : ''} ${user.flagDueFattori ? '' : 'disabled'}> Consenti accesso con il solo codice email</label>
    <p class="form-help">Permette di accedere senza password. Richiede il codice email attivo; i collegamenti SSO restano disponibili. Questo accesso usa il solo possesso della casella email.</p>
    </fieldset>`;
}

function showLocalUserForm(): void {
  render(`<button id="back">Indietro</button><h2>Nuovo utente locale</h2><p class="muted">Viene inviata l'e-mail per impostare la password.</p>
    <form id="local-user"><label>Email<input name="email" type="email" required><span class="form-help">Sarà l'identificativo di accesso dell'utente e riceverà il messaggio per impostare la password.</span></label><label>Nome<input name="nome"></label><label>Cognome<input name="cognome"></label><button>Crea utente</button></form>`);
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
  render(`<button id="back">Indietro</button><h2>Nuovo utente SSO</h2><p class="muted">La console salva solo un collegamento già verificato dal backend; non accetta e non verifica token esterni.</p>
    <form id="sso-user"><label>Email<input name="email" type="email" required><span class="form-help">Email di contatto e identificativo Accessi dell'utente.</span></label><label>Nome<input name="nome"></label><label>Cognome<input name="cognome"></label>${federatedIdentityFields(providers)}<label class="check"><input name="passwordLoginEnabled" type="checkbox"> Abilita anche la password locale</label><span class="form-help">Se non selezionato, l'utente accederà esclusivamente con una delle identità SSO attive.</span><button>Crea utente SSO</button></form>`);
  byId('back').onclick = () => show('users');
  const ssoUserForm = document.getElementById('sso-user') as HTMLFormElement | null;
  if (ssoUserForm) ssoUserForm.onsubmit = (event) => {
    event.preventDefault();
    handleAction(async () => {
      const form = eventForm(event);
      const values = formValues(form);
      const request: CreateFederatedUserRequest = {
        provider: values.provider,
        subject: values.subject,
        note: values.note || undefined,
        passwordLoginEnabled: new FormData(form).has('passwordLoginEnabled'),
        user: { email: values.email, nome: values.nome || undefined, cognome: values.cognome || undefined },
      };
      await createFederatedUser(request);
      showNotice('Utente SSO creato e collegamento registrato.');
      await show('users');
    });
  };
}

async function showSso(): Promise<void> {
  if (!federatedAuthenticationAvailable) throw new Error('SSO non è abilitato in questa istanza Accessi.');
  const [users, providers] = await Promise.all([loadUsers(), getFederatedProviders()]);
  const providerList = result<FederatedProvider[]>(providers);
  render(`<div class="toolbar"><button id="new-sso">Nuovo utente SSO</button><button id="new-provider" class="secondary">Nuovo provider</button></div><h2>Configurazione SSO</h2><p class="muted">Il catalogo definisce le chiavi provider ammesse da Accessi. La validazione dei token, issuer, audience e segreti restano nel backend.</p><h3>Provider censiti</h3><table><thead><tr><th>Provider</th><th>Descrizione</th><th>Stato</th><th></th></tr></thead><tbody>${providerList.map((provider) => `<tr><td><code>${escapeHtml(provider.provider)}</code></td><td>${escapeHtml(provider.description)}</td><td>${provider.active ? 'Attivo' : 'Disabilitato'}</td><td><button data-provider="${escapeHtml(provider.provider)}">Gestisci</button></td></tr>`).join('') || '<tr><td colspan="4">Nessun provider censito.</td></tr>'}</tbody></table><h3>Utenti e identità</h3><table><thead><tr><th>Utente</th><th>Identità collegate</th><th></th></tr></thead><tbody>${users.map(({ utente }) => `<tr><td>${escapeHtml(utente.email)}</td><td>${utente.passwordLoginEnabled === false ? 'solo SSO' : 'password e SSO'}</td><td><button data-sso-user="${utente.codiceUtente}">Gestisci identità</button></td></tr>`).join('')}</tbody></table>`);
  byId('new-sso').onclick = () => handleAction(showSsoUserForm);
  byId('new-provider').onclick = () => showProviderForm();
  document.querySelectorAll<HTMLButtonElement>('[data-provider]').forEach((button) => {
    button.onclick = () => showProviderForm(providerList.find((provider) => provider.provider === button.dataset.provider));
  });
  document.querySelectorAll<HTMLButtonElement>('[data-sso-user]').forEach((button) => {
    button.onclick = () => handleAction(() => showUser(button.dataset.ssoUser ?? ''));
  });
}

/** Creates or updates catalog metadata; the provider key is immutable once identities reference it. */
function showProviderForm(provider?: FederatedProvider): void {
  const isExisting = provider !== undefined;
  render(`<button id="back" type="button">Indietro</button><div class="page-header"><div><p class="eyebrow">Catalogo SSO</p><h2>${isExisting ? 'Gestisci provider' : 'Nuovo provider'}</h2></div><span class="muted">Le configurazioni tecniche restano nel backend</span></div><form id="provider-form"><label>Chiave provider<input name="provider" value="${escapeHtml(provider?.provider)}" ${isExisting ? 'readonly' : ''} required><span class="form-help">Chiave stabile usata dal backend nel payload SSO. Per Azure includi tenant e ambiente, ad esempio <code>azure-ad-acme-produzione</code>. Non è modificabile dopo il censimento.</span></label><label>Descrizione<input name="description" value="${escapeHtml(provider?.description)}" required><span class="form-help">Nome leggibile per gli amministratori della console.</span></label><label>Nota<input name="note" value="${escapeHtml(provider?.note)}"><span class="form-help">Annotazione interna. Non inserire segreti, issuer, token o dati personali non necessari.</span></label>${isExisting ? `<label class="check"><input name="active" type="checkbox" ${provider.active ? 'checked' : ''}> Provider attivo</label><span class="form-help">Disabilitare il provider blocca nuovi login SSO e nuovi collegamenti, ma conserva lo storico delle identità.</span>` : ''}<button>${isExisting ? 'Salva provider' : 'Censisci provider'}</button></form>`);
  byId('back').onclick = () => show('sso');
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
          provider: values.provider,
          description: values.description,
          note: values.note || undefined,
        };
        await createFederatedProvider(request);
      }
      showNotice(isExisting ? 'Provider SSO aggiornato.' : 'Provider SSO censito.');
      await show('sso');
    });
  };
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
  const user = (result(users) as UserRow[])[0].utente;
  const allRoles = result(roles) as Role[];
  const userGrants = result(grants) as { ruoli?: Array<{ codiceRuolo?: number }>; abilitazioni?: Permission[] };
  const menuGroups = result(groups) as GroupWithMenusEntity[];
  const providerList = providers ? result<FederatedProvider[]>(providers) : [];
  const linked = federatedAuthenticationAvailable
    ? result<ConsoleFederatedIdentity[]>(await getFederatedIdentities(codiceUtente))
    : [];
  const identitySection = federatedAuthenticationAvailable ? federatedIdentitySection(linked, providerList) : '';
  const defaultUserTab: UserDetailTab = federatedAuthenticationAvailable ? 'sso' : 'profile';
  render(`<div class="user-action-bar"><button id="back" type="button" class="secondary">Indietro</button><button id="disable-user" type="button" class="danger-button">Imposta stato eliminato</button></div><div class="page-header"><div><p class="eyebrow">Utente ${codiceUtente}</p><h2>${escapeHtml(user.email)}</h2></div><span class="muted">Gestione profilo, ruoli e autorizzazioni</span></div>${userDetailTabs(federatedAuthenticationAvailable)}<div class="user-editor">
    ${identitySection}
    <form id="profile" data-user-panel="profile" role="tabpanel" aria-labelledby="user-tab-profile"><h3>Profilo e accesso</h3><label>Nome<input name="nome" value="${escapeHtml(user.nome)}"></label><label>Cognome<input name="cognome" value="${escapeHtml(user.cognome)}"></label><label>Email<input name="email" type="email" value="${escapeHtml(user.email)}" required><span class="form-help">Identificativo di accesso locale e recapito per le comunicazioni Accessi.</span></label>${federatedAuthenticationAvailable ? `<label class="check"><input name="passwordLoginEnabled" type="checkbox" ${user.passwordLoginEnabled !== false ? 'checked' : ''}> Login con password</label><span class="form-help">Se disabilitato, il login con email e password restituisce un errore esplicito; restano valide le identità SSO attive.</span>` : ''}${authenticationPolicyFields(user)}<button>Salva</button></form>
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
      userTabButtons[targetIndex].focus();
      activateUserTab(userTabButtons[targetIndex].dataset.userTab as UserDetailTab);
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
          codiceUtente, email: values.email, nome: values.nome || undefined, cognome: values.cognome || undefined,
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
    if (linkForm) linkForm.onsubmit = (event) => { event.preventDefault(); handleAction(async () => { const values = formValues(eventForm(event)); await linkFederatedIdentity(codiceUtente, { provider: values.provider, subject: values.subject, note: values.note || undefined }); await showUser(String(codiceUtente)); }); };
    document.querySelectorAll<HTMLButtonElement>('[data-identity-toggle]').forEach((button) => { button.onclick = () => handleAction(async () => { await updateFederatedIdentity(button.dataset.identityToggle ?? '', { active: button.dataset.active === 'true' }); await showUser(String(codiceUtente)); }); });
    document.querySelectorAll<HTMLButtonElement>('[data-identity-delete]').forEach((button) => { button.onclick = () => handleAction(async () => { if (!window.confirm('Eliminare definitivamente questo collegamento SSO? L’utente Accessi non verrà eliminato.')) return; await deleteFederatedIdentityPermanently(codiceUtente, button.dataset.identityDelete ?? ''); showNotice('Collegamento SSO eliminato definitivamente.'); await showUser(String(codiceUtente)); }); });
  }
  byId('disable-user').onclick = () => handleAction(async () => { await deleteUser(codiceUtente); showNotice('Utente impostato come eliminato.'); await show('users'); });
}

async function showRoles(): Promise<void> {
  const [rolesResponse, groupsResponse] = await Promise.all([getRoles(), getGroupsWithMenus({ includeDisabled: true })]);
  const roles = result(rolesResponse) as Role[];
  const groups = result(groupsResponse) as GroupWithMenusEntity[];
  render(`<div class="toolbar"><button id="new-role">Nuovo ruolo</button></div><h2>Ruoli e grant</h2><p class="form-help">Panoramica completa dei menu inclusi in ogni ruolo. Il livello indica l'abilitazione assegnata dal ruolo per quello specifico menu.</p><div class="role-overview-list">${roles.map((role) => roleOverview(role, groups)).join('') || '<p class="muted">Nessun ruolo configurato.</p>'}</div>`);
  const roleForm = (role?: Role) => {
    render(`<button id="back" type="button">Indietro</button><h2>${role ? 'Modifica' : 'Nuovo'} ruolo</h2><form id="role-form"><label>Descrizione<input name="descrizione" value="${escapeHtml(role?.descrizioneRuolo)}" required><span class="form-help">Nome mostrato agli amministratori per identificare questo insieme di autorizzazioni.</span></label><p class="form-help">Ogni gruppo presenta una riga per menu. Seleziona i menu da includere e imposta il livello di abilitazione. Il salvataggio sostituisce integralmente la configurazione corrente del ruolo.</p><div class="role-menu-groups">${groups.map((group) => roleMenuEditorTable(group, role)).join('')}</div><button>Salva ruolo</button></form>`);
    byId('back').onclick = () => show('roles');
    document.querySelectorAll<HTMLInputElement>('#role-form input[name="menu"]').forEach((checkbox) => {
      checkbox.onchange = () => {
        const row = checkbox.closest('tr');
        const status = checkbox.parentElement?.querySelector('span');
        const level = row?.querySelector<HTMLSelectElement>('select[name^="menu-level:"]');
        if (status) status.textContent = checkbox.checked ? 'Incluso' : 'Escluso';
        if (level) level.disabled = !checkbox.checked;
      };
    });
    const roleFormElement = document.getElementById('role-form') as HTMLFormElement | null;
    if (roleFormElement) roleFormElement.onsubmit = async (event) => { event.preventDefault(); const form = eventForm(event); const data = new FormData(form); const request: Role = { descrizioneRuolo: formValues(form).descrizione, menu: Array.from(data.getAll('menu'), (codiceMenu) => ({ codiceMenu: String(codiceMenu), tipoAbilitazione: Number(data.get(`menu-level:${codiceMenu}`) ?? 10) as Role['menu'][number]['tipoAbilitazione'] })) }; if (role?.codiceRuolo) await updateRole(role.codiceRuolo, request); else await createRole(request); await show('roles'); };
  };
  byId('new-role').onclick = () => roleForm();
  document.querySelectorAll<HTMLButtonElement>('[data-role]').forEach((button) => button.onclick = () => roleForm(roles.find((role) => role.codiceRuolo === Number(button.dataset.role))));
}

async function showMenus(): Promise<void> {
  const groups = result(await getGroupsWithMenus({ includeDisabled: true })) as GroupWithMenusEntity[];
  render(`<h2>Menu e gruppi</h2><p class="form-help">Attiva o disattiva gruppi e menu. Ogni riga riporta i dati necessari per individuare l'uso tecnico del menu.</p><div class="menu-group-list">${groups.map(menuGroupTable).join('')}</div>`);
  document.querySelectorAll<HTMLInputElement>('[data-group]').forEach((input) => input.onchange = async () => { await setGroupEnabled(input.dataset.group ?? '', { enabled: input.checked }); showNotice('Gruppo aggiornato.'); });
  document.querySelectorAll<HTMLInputElement>('[data-menu]').forEach((input) => input.onchange = async () => { await setMenuEnabled(input.dataset.menu ?? '', { enabled: input.checked }); showNotice('Menu aggiornato.'); });
}

async function showFilters(): Promise<void> {
  const users = await loadUsers();
  render(`<h2>Filtri utente</h2><form id="filters"><label>Utente<select name="codUte">${users.map(({ utente }) => `<option value="${utente.codiceUtente}">${escapeHtml(utente.email)}</option>`).join('')}</select><span class="form-help">I filtri vengono letti e salvati esclusivamente per l'utente selezionato.</span></label><label>Filtro JSON<textarea name="json" rows="12">{}</textarea><span class="form-help">Configurazione tecnica del filtro. Usa Carica per partire dalla struttura esistente e mantieni il JSON valido prima di salvare.</span></label><button name="action" value="load">Carica</button><button name="action" value="save">Salva</button></form>`);
  const filtersForm = document.getElementById('filters') as HTMLFormElement | null;
  if (filtersForm) filtersForm.onsubmit = async (event) => { event.preventDefault(); const form = eventForm(event); const action = (event.submitter as HTMLButtonElement | null)?.value; const code = Number(formValues(form).codUte); if (action === 'load') { const filters = result<FiltriUtente[]>(await getFiltriUtente({ codUte: code })); (form.elements.namedItem('json') as HTMLTextAreaElement).value = JSON.stringify(filters[0] ?? { codUte: code }, null, 2); } else { const parsed = JSON.parse(formValues(form).json) as Omit<FiltriUtente, 'codUte'>; await saveFiltriUtente({ ...parsed, codUte: code }); showNotice('Filtri salvati.'); } };
}

function scopeList(scopes: string[] | undefined): string {
  return (scopes ?? []).join(', ') || 'nessuno';
}

function serviceTokenRows(tokens: ServiceTokenDto[], includeRevoked: boolean): string {
  return tokens.map((token) => `<tr class="${token.revoked ? 'is-disabled' : ''}"><td><strong>${escapeHtml(token.label)}</strong><br><code>${escapeHtml(token.tokenId)}</code></td><td>${escapeHtml(scopeList(token.scopes))}</td><td>${escapeHtml(token.createdAt ? new Date(token.createdAt).toLocaleString() : '')}</td><td>${token.expiresAt ? escapeHtml(new Date(token.expiresAt).toLocaleString()) : 'nessuna'}</td><td>${token.lastUsedAt ? escapeHtml(new Date(token.lastUsedAt).toLocaleString()) : 'mai'}</td><td>${token.revoked ? 'Revocato' : 'Attivo'}</td><td>${token.revoked ? '' : `<button type="button" data-rotate="${escapeHtml(token.tokenId)}">Ruota</button> <button type="button" class="danger-button" data-revoke="${escapeHtml(token.tokenId)}">Revoca</button>`}</td></tr>`).join('') || `<tr><td colspan="7">Nessun token ${includeRevoked ? '' : 'attivo'}.</td></tr>`;
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
      const scopes = values.scopes.split(',').map((scope) => scope.trim()).filter(Boolean);
      const ttlDays = values.ttlDays ? Number(values.ttlDays) : undefined;
      const issued = result<IssuedServiceTokenDto>(await createServiceToken({
        label: values.label,
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

async function show(view: ConsoleView): Promise<void> {
  try {
    showNotice('');
    const views: Record<string, () => Promise<void>> = { users: showUsers, roles: showRoles, menus: showMenus, filters: showFilters, sso: showSso, tokens: showServiceTokens };
    setActiveNavigation(view);
    await views[view]();
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
    await completeLoginStep(result<LoginResult>(await verifyTwoFactor({ challengeId: pendingChallenge, code: values.code })));
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
  showTwoFactor({ challengeId: ssoChallenge, resendAfterSeconds: 60 });
} else if (token) void bootstrap();
