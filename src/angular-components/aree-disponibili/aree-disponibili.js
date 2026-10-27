/*!
 * Emil Software - <es-aree-disponibili>
 *
 * Web Component frameworkless per mostrare le aree abilitate di un utente.
 * Non dipende da Angular, React, Ionic o Bootstrap: basta includere questo file
 * e usare il tag <es-aree-disponibili>.
 *
 * API pubblica:
 *   element.groups = [{ name, order, areas: [...] }]
 *   element.heading / subtitle / note / eyebrow / emptyText
 *   element.hrefMode = 'hash' | 'path' | 'none'
 *   element.theme = 'auto' | 'light' | 'dark'
 *   eventi: 'es-area-select' (area disponibile), 'es-area-blocked'
 *
 * I colori sono token CSS (--es-*) e, se presenti, ereditano i token
 * Bootstrap 5.3 (--bs-*). Vedi README.md.
 */
(function () {
  'use strict';

  if (typeof window === 'undefined' || typeof customElements === 'undefined') {
    return;
  }

  const TAG = 'es-aree-disponibili';
  const DEFAULT_UNAVAILABLE =
    "La pagina {page} non esiste nell'app al momento.";

  const ICONS = {
    'home-outline':
      '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9 21v-6h6v6"/>',
    'people-outline':
      '<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M16 5.5a3 3 0 0 1 0 5.8"/><path d="M17.5 14.4c2.1.8 3.5 2.8 3.5 5.6"/>',
    'albums-outline':
      '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 9h10M7 13h10M7 17h6"/>',
    'bulb-outline':
      '<path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3Z"/>',
    'checkmark-circle-outline':
      '<circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
    'checkmark-done-outline':
      '<path d="m2 13 4 4 8-9"/><path d="m10 15 2 2 10-11"/>',
    'document-outline':
      '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M14 3v6h6"/><path d="M8 13h8M8 17h5"/>',
    'eye-outline':
      '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    'information-circle-outline':
      '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>',
    'lock-closed-outline':
      '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    'play-outline': '<path d="M8 5v14l11-7Z"/>',
    'book-outline':
      '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/>',
    'camera-outline':
      '<path d="M4 7h3l2-3h6l2 3h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z"/><circle cx="12" cy="13" r="4"/>',
    'analytics-outline': '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    'cash-outline':
      '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/><path d="M6 10v4M18 10v4"/>',
    'chatbubbles-outline':
      '<path d="M21 12a8 8 0 0 1-8 8H7l-4 3v-6.5A8 8 0 1 1 21 12Z"/>',
    'folder-outline':
      '<path d="M3 7a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
    'megaphone-outline':
      '<path d="M3 11v2a1 1 0 0 0 1 1h2l5 3V7L6 10H4a1 1 0 0 0-1 1Z"/><path d="M14 8a5 5 0 0 1 0 8"/>',
    'shield-checkmark-outline':
      '<path d="M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6Z"/><path d="m9 12 2 2 4-4"/>',
    'arrow-forward-outline': '<path d="M5 12h14M13 6l6 6-6 6"/>',
    'compass-outline':
      '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5 5-2Z"/>',
    'grid-outline':
      '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  };

  const ESCAPES = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(
      /[&<>"']/g,
      (character) => ESCAPES[character],
    );
  }

  function icon(name, className) {
    const markup = ICONS[String(name || '').trim()] || ICONS['grid-outline'];
    return (
      '<svg class="' +
      escapeHtml(className || 'icon') +
      '" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" ' +
      'aria-hidden="true" focusable="false">' +
      markup +
      '</svg>'
    );
  }

  function normalizePage(value) {
    const page = String(value == null ? '' : value).trim();
    if (!page) return '';
    return page.startsWith('/') ? page : '/' + page;
  }

  function normalizeArea(area) {
    const route = String(area && area.route ? area.route : '').trim();
    const page = normalizePage(area && area.page);
    const available =
      typeof (area && area.available) === 'boolean'
        ? area.available
        : Boolean(route);
    return {
      code: String((area && area.code) || page || route || ''),
      label: String(
        (area && (area.label || area.name || area.description)) ||
          (area && area.code) ||
          page ||
          route ||
          '',
      ),
      group: String((area && area.group) || ''),
      icon: String((area && (area.icon || area.icona)) || 'grid-outline'),
      route: available ? route : '',
      page,
      url: String((area && area.url) || ''),
      available,
      reason: String((area && area.reason) || ''),
      order: Number((area && area.order) || 0),
    };
  }

  /**
   * Accetta sia una lista di gruppi gia pronta sia una lista piatta di aree.
   * In quest'ultimo caso raggruppa per `group`.
   */
  function normalizeGroups(input) {
    if (!Array.isArray(input)) return [];
    const groups = [];
    const hasExplicitGroups = input.some(
      (item) => item && Array.isArray(item.areas),
    );

    if (hasExplicitGroups) {
      input.forEach((group, index) => {
        if (!group || !Array.isArray(group.areas)) return;
        const areas = group.areas.map(normalizeArea);
        if (areas.length === 0) return;
        groups.push({
          name: String(group.name || group.label || 'Altre aree'),
          order: Number(group.order == null ? index : group.order),
          areas,
        });
      });
    } else {
      const byName = new Map();
      input.map(normalizeArea).forEach((area, index) => {
        const name = area.group || 'Altre aree';
        let group = byName.get(name);
        if (!group) {
          group = { name, order: 999, areas: [] };
          byName.set(name, group);
        }
        area.order = area.order || index;
        group.areas.push(area);
      });
      byName.forEach((group) => groups.push(group));
    }

    groups.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
    groups.forEach((group) =>
      group.areas.sort(
        (a, b) => a.order - b.order || a.label.localeCompare(b.label),
      ),
    );
    return groups;
  }

  const STYLES = `
    :host {
      --es-font: var(--bs-body-font-family, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif);
      --es-radius: 14px;
      --es-radius-lg: 20px;
      --es-bg: var(--bs-body-bg, #f4f6fb);
      --es-surface: var(--bs-card-bg, #ffffff);
      --es-surface-soft: var(--bs-tertiary-bg, #f8fafc);
      --es-text: var(--bs-body-color, #0f172a);
      --es-muted: var(--bs-secondary-color, #64748b);
      --es-primary: var(--bs-primary, #2563eb);
      --es-on-primary: var(--bs-primary-text-emphasis, #1d4ed8);
      --es-primary-soft: var(--bs-primary-bg-subtle, rgba(37, 99, 235, 0.12));
      --es-border: var(--bs-border-color, rgba(15, 23, 42, 0.08));
      --es-disabled-bg: #eef2f7;
      --es-disabled-text: #8a94a6;
      --es-shadow: 0 10px 30px rgba(15, 23, 42, 0.08);
      --es-shadow-hover: 0 16px 36px rgba(15, 23, 42, 0.14);
      --es-success: #15803d;

      display: block;
      min-height: 100%;
      color-scheme: light;
      background: var(--es-bg);
      color: var(--es-text);
      font-family: var(--es-font);
      font-size: 15px;
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
    }

    :host([data-resolved-theme="dark"]) {
      color-scheme: dark;
      --es-bg: var(--bs-dark-bg-subtle, #0b1220);
      --es-surface: #111c2e;
      --es-surface-soft: #0e1728;
      --es-text: #e2e8f0;
      --es-muted: #94a3b8;
      --es-primary: #60a5fa;
      --es-on-primary: #bfdbfe;
      --es-primary-soft: rgba(96, 165, 250, 0.16);
      --es-border: rgba(148, 163, 184, 0.16);
      --es-disabled-bg: #0e1829;
      --es-disabled-text: #7b8aa0;
      --es-shadow: 0 12px 34px rgba(0, 0, 0, 0.35);
      --es-shadow-hover: 0 18px 42px rgba(0, 0, 0, 0.45);
      --es-success: #4ade80;
    }

    *,
    *::before,
    *::after {
      box-sizing: border-box;
    }

    .shell {
      width: min(960px, 100%);
      margin: 0 auto;
      padding: clamp(16px, 4vw, 40px) clamp(12px, 3vw, 28px) 48px;
    }

    .hero {
      display: flex;
      gap: 18px;
      align-items: flex-start;
      padding: clamp(18px, 3vw, 28px);
      border: 1px solid var(--es-border);
      border-radius: var(--es-radius-lg);
      background: var(--es-surface);
      box-shadow: var(--es-shadow);
    }

    .hero__icon {
      display: grid;
      place-items: center;
      flex: 0 0 auto;
      width: 52px;
      height: 52px;
      border-radius: 14px;
      background: var(--es-primary-soft);
      color: var(--es-primary);
    }

    .hero__icon svg {
      width: 26px;
      height: 26px;
    }

    .hero__copy {
      min-width: 0;
    }

    .hero__eyebrow {
      margin: 0 0 6px;
      color: var(--es-muted);
      font-size: 12px;
      font-weight: 600;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    .hero h1 {
      margin: 0 0 10px;
      color: var(--es-text);
      font-size: clamp(20px, 2.6vw, 26px);
      font-weight: 700;
      line-height: 1.2;
    }

    .hero p {
      margin: 0 0 8px;
      color: var(--es-text);
    }

    .hero p:last-child {
      margin-bottom: 0;
    }

    .hero__note {
      color: var(--es-muted) !important;
      font-size: 13px;
    }

    .groups {
      display: grid;
      gap: 26px;
      margin-top: 22px;
    }

    .group__title {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 0 4px 10px;
      color: var(--es-muted);
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }

    .group__count {
      display: inline-grid;
      place-items: center;
      min-width: 22px;
      height: 20px;
      padding: 0 6px;
      border-radius: 999px;
      background: var(--es-primary-soft);
      color: var(--es-primary);
      font-size: 11px;
      letter-spacing: 0;
    }

    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(min(100%, 300px), 1fr));
      gap: 12px;
    }

    .card {
      display: flex;
      align-items: center;
      gap: 14px;
      min-width: 0;
      padding: 14px 16px;
      border: 1px solid var(--es-border);
      border-radius: var(--es-radius);
      background: var(--es-surface);
      box-shadow: 0 4px 14px rgba(15, 23, 42, 0.06);
      color: inherit;
      text-decoration: none;
      transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
    }

    .card:hover,
    .card:focus-visible {
      border-color: var(--es-primary);
      box-shadow: var(--es-shadow-hover);
      transform: translateY(-1px);
    }

    .card:focus-visible {
      outline: 2px solid var(--es-primary);
      outline-offset: 2px;
    }

    .card__icon {
      display: grid;
      place-items: center;
      flex: 0 0 auto;
      width: 44px;
      height: 44px;
      border-radius: 12px;
      background: var(--es-primary-soft);
      color: var(--es-primary);
    }

    .card__icon svg {
      width: 22px;
      height: 22px;
    }

    .card__body {
      display: flex;
      flex: 1 1 auto;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }

    .card__label {
      color: var(--es-text);
      font-size: 15px;
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .card__url {
      overflow: hidden;
      color: var(--es-muted);
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 11px;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .card__reason {
      color: var(--es-muted);
      font-size: 12px;
      font-style: italic;
      line-height: 1.35;
    }

    .card__action {
      flex: 0 0 auto;
      color: var(--es-muted);
    }

    .card__action svg {
      width: 18px;
      height: 18px;
    }

    .card--blocked {
      border-style: dashed;
      background: var(--es-disabled-bg);
      box-shadow: none;
      cursor: not-allowed;
      opacity: 0.78;
    }

    .card--blocked:hover,
    .card--blocked:focus-visible {
      border-color: var(--es-border);
      box-shadow: none;
      transform: none;
    }

    .card--blocked .card__icon {
      background: transparent;
      color: var(--es-disabled-text);
    }

    .card--blocked .card__label {
      color: var(--es-disabled-text);
    }

    .card--blocked .card__reason,
    .card--blocked .card__action {
      color: var(--es-disabled-text);
    }

    .empty {
      display: grid;
      place-items: center;
      gap: 10px;
      margin-top: 24px;
      padding: 32px 20px;
      border: 1px solid var(--es-border);
      border-radius: 16px;
      background: var(--es-surface);
      color: var(--es-muted);
      text-align: center;
    }

    .empty svg {
      width: 32px;
      height: 32px;
    }

    .legend {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 18px 4px 0;
      color: var(--es-muted);
      font-size: 13px;
      line-height: 1.45;
    }

    .legend svg {
      flex: 0 0 auto;
      width: 18px;
      height: 18px;
    }

    @media (max-width: 560px) {
      .hero {
        flex-direction: column;
      }

      .cards {
        grid-template-columns: 1fr;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .card {
        transition: none;
      }

      .card:hover,
      .card:focus-visible {
        transform: none;
      }
    }
  `;

  class AreeDisponibiliElement extends HTMLElement {
    static get observedAttributes() {
      return [
        'theme',
        'heading',
        'subtitle',
        'note',
        'eyebrow',
        'empty-text',
        'unavailable-template',
        'href-mode',
      ];
    }

    #groups = [];
    #root;
    #media;
    #observer;
    #onThemeChange = () => this.#applyTheme();
    #onClick = (event) => this.#handleClick(event);

    constructor() {
      super();
      const shadow = this.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = STYLES;
      shadow.appendChild(style);
      this.#root = document.createElement('div');
      shadow.appendChild(this.#root);
      this.#root.addEventListener('click', this.#onClick);
    }

    connectedCallback() {
      this.#watchTheme();
      this.#applyTheme();
      this.render();
    }

    disconnectedCallback() {
      if (this.#media) {
        this.#media.removeEventListener('change', this.#onThemeChange);
        this.#media = undefined;
      }
      if (this.#observer) {
        this.#observer.disconnect();
        this.#observer = undefined;
      }
    }

    attributeChangedCallback(name) {
      if (name === 'theme') {
        this.#applyTheme();
        return;
      }
      this.render();
    }

    get groups() {
      return this.#groups;
    }

    set groups(value) {
      this.#groups = normalizeGroups(value);
      this.render();
    }

    get heading() {
      return this.getAttribute('heading') || 'Aree disponibili';
    }

    set heading(value) {
      this.#setOptionalAttribute('heading', value);
    }

    get subtitle() {
      return this.getAttribute('subtitle') || '';
    }

    set subtitle(value) {
      this.#setOptionalAttribute('subtitle', value);
    }

    get note() {
      return this.getAttribute('note') || '';
    }

    set note(value) {
      this.#setOptionalAttribute('note', value);
    }

    get eyebrow() {
      return this.getAttribute('eyebrow') || 'Accesso personalizzato';
    }

    set eyebrow(value) {
      this.#setOptionalAttribute('eyebrow', value);
    }

    get emptyText() {
      return (
        this.getAttribute('empty-text') ||
        "Nessuna area abilitata per il tuo utente. Contatta l'amministratore."
      );
    }

    set emptyText(value) {
      this.#setOptionalAttribute('empty-text', value);
    }

    get unavailableTemplate() {
      return this.getAttribute('unavailable-template') || DEFAULT_UNAVAILABLE;
    }

    set unavailableTemplate(value) {
      this.#setOptionalAttribute('unavailable-template', value);
    }

    get hrefMode() {
      const value = (this.getAttribute('href-mode') || 'hash').toLowerCase();
      return value === 'path' || value === 'none' ? value : 'hash';
    }

    set hrefMode(value) {
      this.#setOptionalAttribute('href-mode', value);
    }

    get theme() {
      return this.getAttribute('theme') || 'auto';
    }

    set theme(value) {
      this.#setOptionalAttribute('theme', value);
    }

    setGroups(value) {
      this.groups = value;
      return this;
    }

    refresh() {
      this.render();
      return this;
    }

    #setOptionalAttribute(name, value) {
      if (value == null || value === '') {
        this.removeAttribute(name);
      } else {
        this.setAttribute(name, String(value));
      }
    }

    #watchTheme() {
      if (this.#media) return;
      this.#media = window.matchMedia('(prefers-color-scheme: dark)');
      this.#media.addEventListener('change', this.#onThemeChange);
      this.#observer = new MutationObserver(this.#onThemeChange);
      this.#observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class', 'data-bs-theme'],
      });
    }

    #resolveTheme() {
      const explicit = String(this.getAttribute('theme') || 'auto').toLowerCase();
      if (explicit === 'light' || explicit === 'dark') return explicit;

      const root = document.documentElement;
      if (
        root.getAttribute('data-bs-theme') === 'dark' ||
        root.classList.contains('dark') ||
        root.classList.contains('ion-palette-dark')
      ) {
        return 'dark';
      }
      return this.#media && this.#media.matches ? 'dark' : 'light';
    }

    #applyTheme() {
      const resolved = this.#resolveTheme();
      if (this.getAttribute('data-resolved-theme') !== resolved) {
        this.setAttribute('data-resolved-theme', resolved);
      }
    }

    #handleClick(event) {
      const card = event.target && event.target.closest
        ? event.target.closest('[data-area]')
        : null;
      if (!card) return;

      const groupIndex = Number(card.getAttribute('data-group'));
      const areaIndex = Number(card.getAttribute('data-area'));
      const group = this.#groups[groupIndex];
      const area = group && group.areas[areaIndex];
      if (!area) return;

      const detail = {
        area: { ...area },
        group: group.name,
      };

      if (area.available) {
        this.dispatchEvent(
          new CustomEvent('es-area-select', {
            detail,
            bubbles: true,
            composed: true,
          }),
        );
        if (this.hrefMode === 'none') event.preventDefault();
      } else {
        event.preventDefault();
        this.dispatchEvent(
          new CustomEvent('es-area-blocked', {
            detail: {
              ...detail,
              reason: area.reason || this.#defaultReason(area),
            },
            bubbles: true,
            composed: true,
          }),
        );
      }
    }

    #defaultReason(area) {
      return this.unavailableTemplate.replace('{page}', area.page || '');
    }

    #hrefFor(area) {
      if (!area.available || !area.route) return '';
      if (this.hrefMode === 'none') return '';
      if (this.hrefMode === 'path') return area.route;
      const route = area.route.startsWith('/') ? area.route : '/' + area.route;
      return '#' + route;
    }

    render() {
      if (!this.isConnected) return;

      const groups = this.#groups;
      const totalAreas = groups.reduce(
        (total, group) => total + group.areas.length,
        0,
      );
      const unavailable = groups.reduce(
        (total, group) =>
          total + group.areas.filter((area) => !area.available).length,
        0,
      );

      const header =
        '<header class="hero">' +
        '<span class="hero__icon">' +
        icon('compass-outline') +
        '</span>' +
        '<div class="hero__copy">' +
        (this.eyebrow
          ? '<p class="hero__eyebrow">' + escapeHtml(this.eyebrow) + '</p>'
          : '') +
        '<h1>' +
        escapeHtml(this.heading) +
        '</h1>' +
        (this.subtitle ? '<p>' + escapeHtml(this.subtitle) + '</p>' : '') +
        (this.note ? '<p class="hero__note">' + escapeHtml(this.note) + '</p>' : '') +
        '</div>' +
        '</header>';

      const body =
        totalAreas === 0
          ? '<section class="empty">' +
            icon('lock-closed-outline') +
            '<p>' +
            escapeHtml(this.emptyText) +
            '</p></section>'
          : '<div class="groups">' +
            groups.map((group, groupIndex) => this.#renderGroup(group, groupIndex)).join('') +
            '</div>';

      const legend =
        unavailable > 0
          ? '<p class="legend">' +
            icon('information-circle-outline') +
            '<span>Le aree in grigio non sono ancora disponibili in questa ' +
            'applicazione (' +
            unavailable +
            ').</span></p>'
          : '';

      this.#root.innerHTML =
        '<main class="shell">' + header + body + legend + '</main>';
    }

    #renderGroup(group, groupIndex) {
      const cards = group.areas
        .map((area, areaIndex) => this.#renderArea(area, groupIndex, areaIndex))
        .join('');
      return (
        '<section class="group">' +
        '<h2 class="group__title">' +
        escapeHtml(group.name) +
        '<span class="group__count">' +
        group.areas.length +
        '</span>' +
        '</h2>' +
        '<div class="cards">' +
        cards +
        '</div>' +
        '</section>'
      );
    }

    #renderArea(area, groupIndex, areaIndex) {
      const href = this.#hrefFor(area);
      const reason =
        area.reason || this.#defaultReason(area);
      const attributes =
        'data-area data-group="' +
        groupIndex +
        '" data-area="' +
        areaIndex +
        '"';
      const className = 'card' + (area.available ? '' : ' card--blocked');
      const url = area.url || href;
      const content =
        '<span class="card__icon">' +
        icon(area.icon) +
        '</span>' +
        '<span class="card__body">' +
        '<span class="card__label" title="' +
        escapeHtml(area.label) +
        '">' +
        escapeHtml(area.label) +
        '</span>' +
        (area.available
          ? url
            ? '<span class="card__url" title="' +
              escapeHtml(url) +
              '">' +
              escapeHtml(url) +
              '</span>'
            : ''
          : '<span class="card__reason">' +
            escapeHtml(reason) +
            '</span>') +
        '</span>' +
        '<span class="card__action">' +
        icon(
          area.available ? 'arrow-forward-outline' : 'lock-closed-outline',
        ) +
        '</span>';

      if (area.available) {
        return (
          '<a class="' +
          className +
          '" ' +
          attributes +
          (href ? ' href="' + escapeHtml(href) + '"' : '') +
          '>' +
          content +
          '</a>'
        );
      }

      return (
        '<div class="' +
        className +
        '" ' +
        attributes +
        ' role="link" aria-disabled="true" tabindex="0" title="' +
        escapeHtml(reason) +
        '">' +
        content +
        '</div>'
      );
    }
  }

  if (!customElements.get(TAG)) {
    customElements.define(TAG, AreeDisponibiliElement);
  }

  // Esposto per integrazioni che preferiscono costruire l'elemento da codice.
  window.EmilSoftware = window.EmilSoftware || {};
  window.EmilSoftware.AreeDisponibiliElement = AreeDisponibiliElement;
})();
