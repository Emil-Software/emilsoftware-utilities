/**
 * Contenuto della Wiki della console Accessi.
 *
 * I contenuti sono dati strutturati (non HTML) così da poter essere resi in modo
 * coerente dalla console e convertiti in un digest compatto per l'IA. Nessun
 * segreto o dato specifico di un ambiente deve finire qui.
 */

export type WikiTone = 'info' | 'ok' | 'warn' | 'danger';

export type WikiBlock =
  | { kind: 'p'; text: string }
  | { kind: 'h'; text: string }
  | { kind: 'list'; items: string[]; ordered?: boolean }
  | { kind: 'code'; language: string; title?: string; code: string; variant?: 'good' | 'bad' }
  | { kind: 'callout'; tone: WikiTone; title?: string; text: string }
  | { kind: 'table'; head: string[]; rows: string[][] };

export interface WikiSection {
  id: string;
  group: string;
  title: string;
  summary: string;
  blocks: WikiBlock[];
}

const p = (text: string): WikiBlock => ({ kind: 'p', text });
const h = (text: string): WikiBlock => ({ kind: 'h', text });
const list = (items: string[], ordered = false): WikiBlock => ({ kind: 'list', items, ordered });
const code = (language: string, codeText: string, title?: string, variant?: 'good' | 'bad'): WikiBlock => ({ kind: 'code', language, title, code: codeText, variant });
const good = (language: string, codeText: string, title?: string): WikiBlock => code(language, codeText, title, 'good');
const bad = (language: string, codeText: string, title?: string): WikiBlock => code(language, codeText, title, 'bad');
const note = (tone: WikiTone, title: string, text: string): WikiBlock => ({ kind: 'callout', tone, title, text });
const table = (head: string[], rows: string[][]): WikiBlock => ({ kind: 'table', head, rows });

export const WIKI_SECTIONS: WikiSection[] = [
  // -------------------------------------------------------------------------
  {
    id: 'panoramica',
    group: 'Per iniziare',
    title: 'Panoramica e architettura',
    summary: 'Che cosa fa Accessi, come si incastra nel backend e come scorre una richiesta.',
    blocks: [
      p(`Accessi è un modulo Node/NestJS che aggiunge a un backend già esistente: autenticazione JWT, autorizzazione per ruoli e menu, gestione utenti, reset password, codici email (2FA e passwordless), SSO generico, token macchina-a-macchina e una console amministrativa. Il database è Firebird/InterBase.`),
      h(`Che cosa possiede il modulo`),
      list([
        `Le rotte sotto /api/accessi/* (login, utenti, ruoli, menu, filtri, SSO, token, console).`,
        `Lo schema database del dominio Accessi, riconciliato automaticamente al bootstrap.`,
        `Il middleware di autorizzazione authorizeAccessi per le rotte della tua applicazione.`,
        `La console web su /api/accessi/console.`,
      ]),
      h(`Che cosa resta alla tua applicazione`),
      list([
        `Il proprio frontend e le proprie rotte di business.`,
        `La validazione dei token dei provider SSO esterni (Accessi non li vede).`,
        `I segreti: jwtOptions.secret, SMTP, database ed encryptionKey non raggiungono mai il browser.`,
      ]),
      h(`Flusso di una richiesta protetta`),
      list([
        `Il client chiama una rotta della tua app con header Authorization: Bearer <jwt>.`,
        `La tua rotta esegue authorizeAccessi, che verifica firma HS256, scadenza e stato utente corrente.`,
        `Se passi un requisito, il modulo carica ruoli e grant dell'utente e li valuta.`,
        `Su successo req.user, req.data e (se richiesto) req.userGrants sono popolati; altrimenti risponde con il contratto errore Accessi.`,
      ], true),
      note('info', `Due modalità di bootstrap`, `Express esistente: initializeAccessiModule(app, options). NestJS esistente: AccessiModule.forRoot(options) nei tuoi imports. Non usarle entrambe.`),
    ],
  },
  // -------------------------------------------------------------------------
  {
    id: 'installazione',
    group: 'Per iniziare',
    title: 'Installazione',
    summary: 'Dipendenze, peer e build.',
    blocks: [
      code('bash', `npm install emilsoftware-utilities`, 'Installazione'),
      p(`La libreria dipende da node-firebird per il database e da Express 5 come peer per il montaggio. È consigliato Node 18 o superiore.`),
      note('warn', `Un solo modulo per processo`, `AccessiModule è @Global(): inizializzalo una sola volta per processo. In caso di più istanze, usa un processo per istanza.`),
    ],
  },
  // -------------------------------------------------------------------------
  {
    id: 'bootstrap-express',
    group: 'Per iniziare',
    title: 'Bootstrap su Express esistente',
    summary: 'initializeAccessiModule: ordine corretto e attesa prima di listen.',
    blocks: [
      p(`Chiama initializeAccessiModule prima di aprire la porta HTTP. Durante il bootstrap, authorizeAccessi risponde 503 ACCESSI_AUTH_INITIALIZING invece di autorizzare richieste parziali.`),
      good('ts', [
        "import express from 'express';",
        "import { initializeAccessiModule, authorizeAccessi } from 'emilsoftware-utilities';",
        '',
        'const app = express();',
        'app.use(express.json());',
        '',
        'await initializeAccessiModule(app, options); // prima di app.listen',
        '',
        "app.get('/api/ordini', authorizeAccessi, (req, res) => {",
        '  res.json({ utente: req.user });',
        '});',
        '',
        "app.get('/api/ordini/scrivi', (req, res, next) =>",
        '  authorizeAccessi(req, res, next, {',
        "    requirements: [{ menuCode: 'ORDINI', minPermissionLevel: 20 }],",
        '  }),',
        '(req, res) => res.json({ ok: true }));',
        '',
        'app.listen(3000);',
      ].join('\n'), 'Express + Accessi'),
      bad('ts', [
        'const app = express();',
        'app.listen(3000); // porta aperta prima del bootstrap',
        'await initializeAccessiModule(app, options); // le richieste nel frattempo ricevono 503',
      ].join('\n'), 'Non aprire la porta prima del bootstrap'),
      h(`Rotte montate`),
      p(`Accessi intercetta solo /api/accessi/*, /accessi/swagger* e /accessi/swagger.json. Tutte le altre rotte passano intatte al tuo stack Express.`),
      note('ok', `req.user`, `authorizeAccessi popola req.user con il payload utente corrente (utente, codiceUtente, flag) e req.data come alias storico. req.userGrants è presente solo se hai richiesto dei requisiti.`),
    ],
  },
  // -------------------------------------------------------------------------
  {
    id: 'bootstrap-nest',
    group: 'Per iniziare',
    title: 'Bootstrap su NestJS esistente',
    summary: 'AccessiModule.forRoot e uso dei provider esportati.',
    blocks: [
      p(`Se la tua applicazione è già NestJS, importa AccessiModule.forRoot(options). Il modulo è @Global e riesporta i servizi (AuthService, UserService, PermissionService, FederatedAuthService, ServiceTokenService, ServiceTokenGuard, AuthenticateGenService).`),
      good('ts', [
        "import { Module } from '@nestjs/common';",
        "import { AccessiModule } from 'emilsoftware-utilities';",
        '',
        '@Module({',
        '  imports: [AccessiModule.forRoot(options)],',
        '})',
        'export class AppModule {}',
      ].join('\n'), 'app.module.ts'),
      p(`Il global prefix api e le rotte /api/accessi/* sono gestiti dal modulo. Le tue rotte Nest si proteggono con JwtSimpleGuard usando il JWT Accessi.`),
    ],
  },
  // -------------------------------------------------------------------------
  {
    id: 'opzioni',
    group: 'Configurazione',
    title: 'AccessiOptions (riferimento completo)',
    summary: 'Ogni campo di configurazione con tipo, obbligo e note.',
    blocks: [
      table(
        ['Campo', 'Tipo', 'Obbligo', 'Note'],
        [
          ['databaseOptions', 'Options (node-firebird)', 'sì', 'Connessione Firebird al database Accessi.'],
          ['confirmationEmailUrl', 'string', 'sì', 'Base URL usata per il reset password.'],
          ['confirmationEmailReturnUrl', 'string', 'sì', 'URL di ritorno dopo il reset.'],
          ['confirmationEmailPrefix', 'string', 'no', 'Prefisso passato alla pagina di reset.'],
          ['customResetPage', 'string', 'no', 'Sostituisce la pagina HTML di reset inclusa.'],
          ['encryptionKey', 'string', 'sì', 'Compatibilità e migrazione delle password legacy.'],
          ['mockDemoUser', 'boolean', 'sì', 'Utenti fittizi admin e demo solo fuori produzione.'],
          ['passwordExpiration', 'boolean', 'no', 'Attiva il controllo della scadenza password al login.'],
          ['passwordExpirationDays', 'number', 'no', 'Valore predefinito: 90 giorni.'],
          ['legacyPasswordMigrationOnStartup', 'boolean', 'no', 'Predefinito true: converte le password legacy.'],
          ['autoUpdateDatabase', 'boolean', 'no', 'Predefinito true: riconcilia lo schema al boot.'],
          ['jwtOptions', '{ secret, expiresIn }', 'sì', 'Firma HS256 e durata dei JWT Accessi.'],
          ['emailOptions', 'EmailOptions', 'sì', 'SMTP per reset e codici email.'],
          ['publicAuthRateLimit', 'PublicAuthRateLimitOptions', 'no', 'Limiti in-memory sugli endpoint pubblici.'],
          ['publicRegistration', '{ enabled }', 'no', 'Registrazione pubblica: disattivata per impostazione predefinita.'],
          ['federatedAuthentication', 'FederatedAuthenticationOptions', 'no', `Abilita l'SSO generico.`],
          ['extensionFieldsOptions', 'ExtensionFieldsOptions[]', 'no', 'Tabelle esterne allegate al profilo.'],
          ['serviceTokens', '{ enabled, defaultTtlDays }', 'no', 'Token macchina-a-macchina, abilitati per impostazione predefinita.'],
        ],
      ),
      good('ts', [
        "import type { AccessiOptions } from 'emilsoftware-utilities';",
        '',
        'export const options: AccessiOptions = {',
        '  databaseOptions: {',
        '    host: process.env.ACCESSI_DB_HOST!,',
        '    port: Number(process.env.ACCESSI_DB_PORT ?? 3050),',
        '    database: process.env.ACCESSI_DB_NAME!,',
        '    user: process.env.ACCESSI_DB_USER!,',
        '    password: process.env.ACCESSI_DB_PASSWORD!,',
        '  },',
        "  confirmationEmailUrl: 'https://app.example.com',",
        "  confirmationEmailReturnUrl: 'https://app.example.com/login',",
        '  encryptionKey: process.env.ACCESSI_ENCRYPTION_KEY!,',
        '  mockDemoUser: false,',
        '  passwordExpiration: true,',
        '  passwordExpirationDays: 90,',
        '  jwtOptions: {',
        "    secret: process.env.ACCESSI_JWT_SECRET!, // almeno 32 caratteri casuali, unico per ambiente",
        "    expiresIn: '24h',",
        '  },',
        '  emailOptions: {',
        '    host: process.env.SMTP_HOST!,',
        '    port: Number(process.env.SMTP_PORT ?? 587),',
        '    secure: false,',
        '    requireTLS: true,',
        '    tls: { rejectUnauthorized: true },',
        "    from: 'no-reply@example.com',",
        '    auth: { user: process.env.SMTP_USER!, pass: process.env.SMTP_PASS! },',
        '  },',
        '  publicRegistration: { enabled: false },',
        '  serviceTokens: { enabled: true, defaultTtlDays: 365 },',
        '};',
      ].join('\n'), 'Configurazione tipica'),
      bad('ts', [
        "jwtOptions: { secret: 'accessi', expiresIn: '24h' }, // segreto debole e condiviso",
        'mockDemoUser: true, // MAI in produzione',
      ].join('\n'), 'Errori comuni'),
      note('danger', `Segreti`, `Non versionare i segreti e non passarli al frontend. jwtOptions.secret deve essere identico tra le istanze del backend e diverso da quello dei provider SSO.`),
    ],
  },
  // -------------------------------------------------------------------------
  {
    id: 'database',
    group: 'Configurazione',
    title: 'Schema e aggiornamento del database',
    summary: 'Tabelle, riconciliazione automatica e CLI.',
    blocks: [
      p(`Accessi possiede lo schema del dominio. Con autoUpdateDatabase true (predefinito) lo riconcilia a ogni avvio; con false verifica comunque la compatibilità in sola lettura e blocca gli avvii incompatibili.`),
      h(`Tabelle principali`),
      list([
        `PARAMETRI, UTENTI, UTENTI_CONFIG, UTENTI_PWD, UTENTI_OLDPWD, UTENTI_GDPR`,
        `RUOLI, MENU_GRP, MENU_TIPI, MENU, ABILITAZIONI, RUOLI_MNU, UTENTI_RUOLI`,
        `FILTRI, FILTRI_TIPO`,
        `SSO_PROVIDER, UTENTI_IDENTITA_EXT`,
        `ACCESSI_2FA, ACCESSI_SERVICE_TOKEN`,
      ]),
      code('bash', `npm run db:update:accessi   # riconcilia lo schema\nnpm run db:check:accessi    # verifica senza modificare`, 'CLI schema'),
      note('warn', `Versioni`, `La libreria richiede uno schema compatibile con la versione corrente (ACCESSI_SCHEMA_VERSION). Se la verifica fallisce, leggi il codice errore ACCESSI_DATABASE_SCHEMA_OUTDATED ed esegui db:update:accessi.`),
    ],
  },
  // -------------------------------------------------------------------------
  {
    id: 'login',
    group: 'Autenticazione',
    title: 'Login locale e JWT',
    summary: 'Endpoint di login, risposta e gestione della password scaduta.',
    blocks: [
      code('http', `POST /api/accessi/auth/login\nContent-Type: application/json\n\n{ "email": "utente@example.com", "password": "Segreta123!" }`, 'Login con password'),
      p(`La risposta include Result.token (il JWT) e il profilo utente con ruoli, permessi e filtri. Se l'account è passwordless, ometti la password: il server risponde con un challenge via email (vedi la sezione su 2FA e passwordless).`),
      good('ts', [
        "const res = await fetch('/api/accessi/auth/login', {",
        "  method: 'POST',",
        "  headers: { 'Content-Type': 'application/json' },",
        '  body: JSON.stringify({ email, password }),',
        '});',
        'const body = await res.json();',
        'if (body.Result?.challenge) { /* richiedi il codice */ }',
        'const token = body.Result?.token;',
      ].join('\n'), 'Chiamata dal frontend'),
      note('warn', `Password scaduta`, `Con passwordExpiration attivo, una password scaduta produce una PasswordExpiredResponse con code PASSWORD_EXPIRED. Il client deve avviare il reset della password.`),
      h(`Verifica del token`),
      code('http', `POST /api/accessi/auth/get-user-by-token\nContent-Type: application/json\n\n{ "token": "<jwt>" }`, 'get-user-by-token'),
      p(`Usalo per verificare un JWT e ottenere il profilo corrente (utile al bootstrap di una SPA). Restituisce Result.userData.`),
    ],
  },
  // -------------------------------------------------------------------------
  {
    id: 'passwordless-2fa',
    group: 'Autenticazione',
    title: 'Codici email, 2FA e passwordless',
    summary: 'Verifica in due passi, challenge e policy per utente.',
    blocks: [
      p(`La verifica con codice email è per-utente (flagDueFattori / UTENTI_CONFIG.FLG2FATT) ed è disattivata per impostazione predefinita. Con passwordlessLoginEnabled (FLGPWDLESS, richiede la 2FA attiva) l'accesso avviene con il solo codice email.`),
      table(
        ['Configurazione', 'Accesso locale', 'Accesso SSO'],
        [
          ['2FA disattivata', 'Password', 'Provider'],
          ['2FA attiva', 'Password + codice email', 'Provider + codice email'],
          ['2FA + passwordless', 'Solo codice email', 'Provider + codice email'],
        ],
      ),
      code('json', `{\n  "Result": {\n    "challenge": {\n      "twoFactorRequired": true,\n      "challengeId": "64-caratteri-esadecimali",\n      "method": "email",\n      "expiresAt": "2026-09-11T14:00:00.000Z",\n      "resendAfterSeconds": 60\n    }\n  }\n}`, 'Risposta con challenge'),
      code('http', `POST /api/accessi/auth/two-factor/verify\n{ "challengeId": "...", "code": "012345" }\n\nPOST /api/accessi/auth/two-factor/resend\n{ "challengeId": "..." }`, 'Verifica e reinvio'),
      list([
        `Il codice ha 6 cifre, dura 10 minuti, consente 5 tentativi totali e al massimo 3 invii per challenge.`,
        `Fino alla verifica non sono presenti token, profilo o grant.`,
        `Il challenge non è un JWT e non va usato nell'header Authorization.`,
      ]),
      bad('ts', [
        '// Sbagliato: usare il challenge come token',
        "fetch('/api/ordini', { headers: { Authorization: 'Bearer ' + challengeId } }); // 401",
      ].join('\n'), 'Il challenge non è un token'),
    ],
  },
  // -------------------------------------------------------------------------
  {
    id: 'reset-password',
    group: 'Autenticazione',
    title: 'Reset password',
    summary: 'Invio email e conferma con token monouso.',
    blocks: [
      code('http', `POST /api/accessi/email/send-reset-password-email\n{ "email": "utente@example.com" }\n\nPOST /api/accessi/auth/confirm-reset-password/{token}\n{ "newPassword": "NuovaSegreta123!" }`, 'Reset in due passi'),
      p(`L'invio non rivela se l'email esiste (anti-enumerazione). Il token di reset è monouso ed è firmato con una chiave dedicata.`),
      note('info', `Pagina personalizzata`, `Imposta customResetPage per usare la tua pagina di reset invece di quella inclusa. confirmationEmailReturnUrl e confirmationEmailPrefix controllano il ritorno.`),
    ],
  },
  // -------------------------------------------------------------------------
  {
    id: 'middleware',
    group: 'Autorizzazione',
    title: 'authorizeAccessi (middleware)',
    summary: 'Proteggere le rotte della tua app con il JWT Accessi.',
    blocks: [
      p(`authorizeAccessi è un middleware Express che verifica il JWT, ricarica lo stato utente corrente e applica i requisiti. Su successo prosegue; su errore risponde direttamente con il contratto Accessi (non chiamare un tuo next(error)).`),
      good('ts', [
        "app.get('/api/report',",
        '  (req, res, next) => authorizeAccessi(req, res, next, {',
        "    requirements: [{ menuCode: 'REPORT', minPermissionLevel: 10 }],",
        '  }),',
        '  (req, res) => res.json({ user: req.user, grants: req.userGrants }),',
        ');',
      ].join('\n'), 'Rotta protetta'),
      h(`Che cosa trovi nella request`),
      list([
        `req.user e req.data: payload utente corrente (alias storici).`,
        `req.userGrants: grant effettivi, presente solo quando hai richiesto dei requisiti.`,
      ]),
      bad('ts', [
        "app.get('/api/report', authorizeAccessi, (req, res) => {",
        '  // Sbagliato: assumere che req.userGrants esista senza requisiti',
        '  const grants = req.userGrants.grants; // possibile TypeError',
        '});',
      ].join('\n'), 'Non dare per scontato req.userGrants'),
      note('danger', `Lo stato utente è sempre ricontrollato`, `Un JWT valido non basta: se l'utente è stato bloccato, eliminato o ha cambiato policy, il middleware risponde 401 AUTH_USER_DISABLED.`),
    ],
  },
  // -------------------------------------------------------------------------
  {
    id: 'requisiti',
    group: 'Autorizzazione',
    title: 'Requisiti e livelli di abilitazione',
    summary: 'DSL accessiRequirement: permission, and, or, not, custom.',
    blocks: [
      p(`I requisiti si compongono con accessiRequirement. La forma storica requirements è un AND di permessi. Il livello è TipoAbilitazione: NESSUNA=0, LETTURA=10, SCRITTURA=20, SPECIAL=30; il confronto è tipoAbilitazione >= soglia.`),
      good('ts', [
        "import { authorizeAccessi, accessiRequirement as r } from 'emilsoftware-utilities';",
        '',
        '// AND (entrambi i menu)',
        'const both = r.and(r.permission("ORDINI", 20), r.permission("CLIENTI", 10));',
        '',
        '// OR',
        'const either = r.or(r.permission("REPORT", 10), r.permission("EXPORT", 20));',
        '',
        '// NOT + custom',
        'const policy = r.and(',
        '  r.permission("AREA_RISERVATA", 10),',
        '  r.not(r.permission("BLOCCO_TOTALE", 0)),',
        ');',
        '',
        'app.get("/api/riservato", (req, res, next) => authorizeAccessi(req, res, next, {',
        '  requirementTree: policy,',
        '  customRequirementHandlers: {',
        '    stessoReparto: async (ctx) => ctx.userCode === Number(ctx.req.query.reparto),',
        '  },',
        '}), handler);',
      ].join('\n'), 'Policy composte'),
      bad('ts', [
        '// Sbagliato: AND/OR senza figli -> errore di configurazione (500 AUTH_REQUIREMENTS_MISCONFIGURED)',
        'const empty = r.and();',
      ].join('\n'), 'Configurazione non valida'),
      note('warn', `custom senza handler`, `Un requisito custom la cui chiave non ha un handler produce 500 AUTH_REQUIREMENTS_MISCONFIGURED: è un errore di programmazione, non un 403.`),
    ],
  },
  // -------------------------------------------------------------------------
  {
    id: 'utenti',
    group: 'Dominio',
    title: 'Utenti',
    summary: 'Creazione, aggiornamento, stati, GDPR e filtri.',
    blocks: [
      h(`Stati di registrazione (STAREG)`),
      table(
        ['Valore', 'Nome', 'Effetto sul login'],
        [
          ['0', 'NULL', 'Non confermato'],
          ['5', 'INSERT', 'Non confermato'],
          ['10', 'INVIO', 'Richiede il rinnovo della password'],
          ['20', 'CONF', 'Valido'],
          ['50', 'DELETE', 'Bloccato (soft delete)'],
          ['99', 'BLOCC', 'Bloccato'],
        ],
      ),
      h(`Endpoint principali (superutente salvo diversamente indicato)`),
      table(
        ['Metodo', 'Percorso', 'Descrizione'],
        [
          ['GET', '/api/accessi/user/get-users', 'Elenco con paginazione (limit e offset, header X-Total-Count).'],
          ['POST', '/api/accessi/user/create-managed-user', 'Crea un utente locale e invia il reset password.'],
          ['PUT', '/api/accessi/user/update-user/:codiceUtente', 'Aggiorna profilo e policy (campi privilegiati solo superutente).'],
          ['DELETE', '/api/accessi/user/delete-user/:codiceUtente', 'Soft delete: STAREG=DELETE.'],
          ['POST', '/api/accessi/user/set-stato', 'Imposta lo stato di registrazione.'],
          ['PATCH', '/api/accessi/user/set-gdpr/:codiceUtente', 'Registra il consenso GDPR.'],
          ['POST', '/api/accessi/user/register', 'Registrazione pubblica, solo se publicRegistration.enabled.'],
        ],
      ),
      good('ts', [
        "await fetch('/api/accessi/user/create-managed-user', {",
        "  method: 'POST',",
        "  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + adminToken },",
        '  body: JSON.stringify({',
        "    email: 'nuovo@example.com',",
        "    nome: 'Mario',",
        "    cognome: 'Rossi',",
        '    roles: [1, 2],',
        "    permissions: [{ codiceMenu: 'REPORT', tipoAbilitazione: 10 }],",
        '  }),',
        '});',
      ].join('\n'), 'Creazione di un utente gestito'),
      bad('ts', [
        '// Sbagliato: inviare flag privilegiati dal frontend pubblico',
        'fetch("/api/accessi/user/register", {',
        '  method: "POST",',
        '  body: JSON.stringify({ email, flagSuper: true }), // ignorato o negato',
        '});',
      ].join('\n'), 'Privilegi dal client'),
      note('info', `Campi estesi`, `extensionFieldsOptions allega colonne di tabelle applicative al profilo (per esempio la ragione sociale). Le colonne sono in whitelist: non costruirle mai da input HTTP.`),
    ],
  },
  // -------------------------------------------------------------------------
  {
    id: 'ruoli',
    group: 'Dominio',
    title: 'Ruoli e permessi',
    summary: 'Assegnazioni sostitutive e composizione dei grant.',
    blocks: [
      p(`I ruoli contengono una lista di menu con livello. Le assegnazioni (ruoli e permessi diretti) sono SOSTITUTIVE: invia sempre la lista completa desiderata. I grant diretti prevalgono su quelli dei ruoli; i superutenti vedono tutti i menu attivi.`),
      table(
        ['Metodo', 'Percorso', 'Descrizione'],
        [
          ['GET', '/api/accessi/permission/roles', 'Ruoli con i menu associati.'],
          ['POST', '/api/accessi/permission/create-role', 'Crea un ruolo (i menu sono obbligatori).'],
          ['PUT', '/api/accessi/permission/update-role/:codiceRuolo', 'Aggiorna un ruolo (menu sostitutivi).'],
          ['DELETE', '/api/accessi/permission/delete-role/:codiceRuolo', 'Elimina ruolo, mapping e assegnazioni.'],
          ['POST', '/api/accessi/permission/assign-roles/:codiceUtente', `Sostituisce i ruoli dell'utente.`],
          ['POST', '/api/accessi/permission/assign-permissions/:codiceUtente', 'Sostituisce i permessi diretti.'],
          ['GET', '/api/accessi/permission/grants/:codiceUtente', 'Grant effettivi, permessi diretti e ruoli.'],
        ],
      ),
      good('ts', [
        'const role = {',
        "  descrizioneRuolo: 'Gestore ordini',",
        '  menu: [',
        "    { codiceMenu: 'ORDINI', tipoAbilitazione: 20 },",
        "    { codiceMenu: 'CLIENTI', tipoAbilitazione: 10 },",
        '  ],',
        '};',
        'await createRole(role); // POST /api/accessi/permission/create-role',
        '',
        "// Sostitutivo: questa lista diventa l'intero set di ruoli dell'utente",
        'await assignRolesToUser(codiceUtente, { roles: [3, 7] });',
      ].join('\n'), 'Creazione di un ruolo e assegnazione'),
      bad('ts', [
        "// Sbagliato: pensare che l'assegnazione sia incrementale",
        'await assignRolesToUser(codiceUtente, { roles: [3] });',
        "// ora l'utente ha SOLO il ruolo 3, non 3 più quelli di prima",
      ].join('\n'), 'Assegnazione non additiva'),
      note('warn', `Menu obbligatori`, `create-role e update-role rifiutano un ruolo senza menu. Se ti serve un ruolo senza accessi, non crearlo.`),
    ],
  },
  // -------------------------------------------------------------------------
  {
    id: 'menu',
    group: 'Dominio',
    title: 'Menu, gruppi e tipi menu',
    summary: 'Catalogo di navigazione e CRUD completo (superutente).',
    blocks: [
      table(
        ['Metodo', 'Percorso', 'Descrizione'],
        [
          ['GET', '/api/accessi/permission/menus', 'Menu attivi.'],
          ['GET', '/api/accessi/permission/menu-types', 'Catalogo dei tipi menu.'],
          ['GET', '/api/accessi/permission/groups-with-menus?includeDisabled=true', 'Gruppi con menu (anche disabilitati).'],
          ['POST', '/api/accessi/permission/menus', 'Crea un menu.'],
          ['PUT', '/api/accessi/permission/menus/:codiceMenu', 'Aggiorna un menu.'],
          ['DELETE', '/api/accessi/permission/menus/:codiceMenu', 'Elimina un menu (con grant e associazioni ai ruoli).'],
          ['POST', '/api/accessi/permission/menu-groups', 'Crea un gruppo.'],
          ['PUT', '/api/accessi/permission/menu-groups/:codiceGruppo', 'Aggiorna un gruppo.'],
          ['DELETE', '/api/accessi/permission/menu-groups/:codiceGruppo', 'Elimina un gruppo (solo se vuoto).'],
          ['POST/PUT/DELETE', '/api/accessi/permission/menu-types[/:codiceTipo]', 'CRUD dei tipi menu.'],
        ],
      ),
      p(`I codici (CODMNU, CODGRP, CODTIP) sono chiavi immutabili: si indicano in creazione e poi si passano nel percorso. Un gruppo o un tipo si elimina solo se non è referenziato.`),
      good('ts', [
        "await createMenuGroup({ codiceGruppo: 'A', descrizioneGruppo: 'Amministrazione', ordineGruppo: 1, enabled: true });",
        "await createMenuType({ codiceTipo: 'X', descrizioneTipo: 'Operativo' });",
        "await createMenu({ codiceMenu: 'ORDINI', descrizioneMenu: 'Ordini', codiceGruppo: 'A', tipo: 'X', ordineMenu: 10, enabled: true });",
      ].join('\n'), 'Catalogo in ordine'),
      bad('ts', [
        '// Sbagliato: eliminare un gruppo che contiene menu -> 400 con spiegazione',
        "await deleteMenuGroup('A'); // contiene N menu",
      ].join('\n'), 'Vincoli di integrità'),
    ],
  },
  // -------------------------------------------------------------------------
  {
    id: 'filtri',
    group: 'Dominio',
    title: 'Filtri applicativi',
    summary: 'Filtri per utente e catalogo dei tipi filtro.',
    blocks: [
      table(
        ['Metodo', 'Percorso', 'Descrizione'],
        [
          ['GET', '/api/accessi/filtri/tipi', 'Catalogo dei tipi filtro.'],
          ['POST', '/api/accessi/filtri/tipi', 'Crea un tipo filtro (superutente).'],
          ['PUT', '/api/accessi/filtri/tipi/:tipFil', 'Aggiorna un tipo filtro.'],
          ['DELETE', '/api/accessi/filtri/tipi/:tipFil', 'Elimina un tipo filtro (se non è usato).'],
          ['GET', '/api/accessi/filtri/utente?codUte=123', 'Filtri di un utente (self o superutente).'],
          ['POST', '/api/accessi/filtri/utente', 'Upsert dei filtri (self o superutente).'],
        ],
      ),
      note('info', `Mapping delle colonne`, `I campi filtro sono mappati su colonne FILTRI in whitelist (FILTRI_UTENTE_DB_MAPPING). I campi non configurati nello schema vengono rifiutati.`),
    ],
  },
  // -------------------------------------------------------------------------
  {
    id: 'sso',
    group: 'SSO',
    title: 'SSO generico (federated authentication)',
    summary: 'Il backend valida il provider, Accessi gestisce identità e sessioni.',
    blocks: [
      p(`Accessi non valida i token Azure, Google o SAML: è il TUO backend a validare il flusso SSO e a passare solo { provider, subject } verificati a FederatedAuthService. Così issuer, secret e token restano fuori dal modulo.`),
      good('ts', [
        "import { FederatedAuthService } from 'emilsoftware-utilities';",
        '',
        '// Nel tuo callback SSO, dopo aver validato il token del provider:',
        'const verified = { provider: "azure-ad-acme", subject: claims.oid };',
        'const result = await federatedAuthService.authenticate(verified);',
        '',
        'if (result.login.challenge) {',
        '  // 2FA attiva: restituisci il challenge al frontend',
        '  return res.json({ challenge: result.login.challenge });',
        '}',
        'return res.json({ login: result.login, token: result.token });',
      ].join('\n'), 'Login SSO'),
      h(`API amministrative (superutente)`),
      list([
        `GET/POST /api/accessi/federated-auth/providers, PATCH/DELETE providers/:provider`,
        `GET/POST /api/accessi/federated-auth/users/:codiceUtente/identities`,
        `POST /api/accessi/federated-auth/users (crea un utente SSO-only)`,
        `PATCH /api/accessi/federated-auth/users/:codiceUtente/password-login`,
      ]),
      bad('ts', [
        "// Sbagliato: far validare il token del provider ad Accessi o fidarsi del frontend",
        'await federatedAuthService.authenticate({ provider, subject: req.body.email }); // subject non verificato',
      ].join('\n'), `Non fidarti dell'input`),
      note('warn', `Provider in uso`, `Un provider si elimina solo se nessuna identità è collegata; altrimenti disabilitalo. La chiave del provider deve coincidere con la configurazione del backend.`),
    ],
  },
  // -------------------------------------------------------------------------
  {
    id: 'service-token',
    group: 'Token di servizio',
    title: 'Token macchina-a-macchina',
    summary: 'Autenticazione tecnica con scope: non è un superutente.',
    blocks: [
      p(`Formato: st_<id>.<segreto> (segreto da 256 bit). Nel database si salva solo lo SHA-256 del segreto; il segreto è mostrato una sola volta. La verifica restituisce { tokenId, label, scopes }: nessun ruolo o grant.`),
      note('danger', `Non è un superutente`, `Un service token non apre le API Accessi: abilita solo le rotte della tua app che proteggi con ServiceTokenGuard.`),
      good('ts', [
        "import { ServiceTokenGuard, RequireServiceTokenScopes } from 'emilsoftware-utilities';",
        '',
        '@UseGuards(ServiceTokenGuard)',
        "@RequireServiceTokenScopes('ia')",
        '@Post("internal/ask")',
        'ask() { /* req.accessiServiceToken = { tokenId, label, scopes } */ }',
      ].join('\n'), 'Rotta tecnica protetta'),
      h(`Gestione (superutente)`),
      list([
        `POST /api/accessi/service-token (label, scopes, expiresAt o ttlDays) -> segreto mostrato una volta`,
        `GET /api/accessi/service-token?includeRevoked=true`,
        `DELETE /api/accessi/service-token/:tokenId (revoca immediata)`,
        `POST /api/accessi/service-token/:tokenId/rotate`,
      ]),
      bad('ts', [
        '// Sbagliato: usare un service token per autenticare un utente umano',
        "fetch('/api/profilo', { headers: { Authorization: 'Bearer ' + serviceToken } }); // req.user assente",
      ].join('\n'), 'Non è un utente'),
      note('warn', `Scadenza`, `Senza expiresAt né defaultTtlDays il token non scade: imposta serviceTokens.defaultTtlDays o una scadenza esplicita.`),
    ],
  },
  // -------------------------------------------------------------------------
  {
    id: 'console',
    group: 'Console',
    title: 'Console amministrativa',
    summary: 'Accesso, sezioni e che cosa si può fare.',
    blocks: [
      p(`La console è servita dal modulo su /api/accessi/console e richiede un superutente Accessi. Non ha stato proprio: ogni azione chiama le API protette con il JWT dell'utente connesso.`),
      list([
        `Utenti: elenco, creazione locale o SSO, profilo, ruoli, grant diretti, stato, 2FA.`,
        `Ruoli e grant: CRUD dei ruoli con l'albero delle abilitazioni.`,
        `Menu e gruppi: CRUD di gruppi, menu e tipi menu.`,
        `Filtri: filtri utente e tipi filtro.`,
        `Token di servizio: creazione, rotazione, revoca.`,
        `SSO: provider e identità.`,
      ]),
      note('info', `Accesso`, `Apri /api/accessi/console e accedi con un utente con flagSuper=true. Le sezioni sono raggiungibili anche tramite deep link (per esempio /api/accessi/console/menu-e-gruppi/menu).`),
    ],
  },
  // -------------------------------------------------------------------------
  {
    id: 'errori',
    group: 'Riferimenti',
    title: 'Contratto errori e codici',
    summary: 'Formato della risposta e codici stabili ACCESSI_* e AUTH_*.',
    blocks: [
      p(`Gli errori HTTP delle API Accessi usano un contratto stabile: severity, status, statusCode, code, error (campo legacy uguale a code), message e details per gli errori di validazione.`),
      code('json', `{\n  "severity": "error",\n  "status": 400,\n  "statusCode": 2,\n  "code": "ACCESSI_VALIDATION_ERROR",\n  "error": "ACCESSI_VALIDATION_ERROR",\n  "message": "La richiesta contiene dati non validi.",\n  "details": ["email: deve essere una stringa."]\n}`, 'Errore di validazione'),
      table(
        ['Codice', 'Quando'],
        [
          ['ACCESSI_VALIDATION_ERROR', 'Body o parametri non validi (400).'],
          ['ACCESSI_AUTH_INITIALIZING', 'Bootstrap in corso (503).'],
          ['ACCESSI_AUTH_NOT_INITIALIZED', 'Modulo non inizializzato (500).'],
          ['AUTH_HEADER_MISSING / AUTH_TOKEN_MISSING', 'Header Authorization assente (401).'],
          ['AUTH_TOKEN_INVALID', 'JWT non valido o scaduto (401).'],
          ['AUTH_USER_DISABLED', 'Utente non più autorizzato (401).'],
          ['AUTH_INSUFFICIENT_PERMISSIONS', 'Requisiti non soddisfatti (403).'],
          ['AUTH_REQUIREMENTS_MISCONFIGURED', 'Policy malformata o handler custom mancante (500).'],
          ['ACCESSI_DATABASE_SCHEMA_OUTDATED', 'Schema del database incompatibile.'],
          ['ACCESSI_SERVICE_TOKEN_RATE_LIMITED', 'Troppi tentativi (429).'],
        ],
      ),
    ],
  },
  // -------------------------------------------------------------------------
  {
    id: 'endpoint',
    group: 'Riferimenti',
    title: 'Indice degli endpoint',
    summary: 'Tutte le rotte /api/accessi/* in una tabella.',
    blocks: [
      table(
        ['Area', 'Endpoint principali'],
        [
          ['Auth', 'POST auth/login, auth/get-user-by-token, auth/confirm-reset-password/:token, auth/two-factor/verify, auth/two-factor/resend'],
          ['Email', 'POST email/send-reset-password-email, GET email/reset-password-page/:token'],
          ['Utenti', 'GET user/get-users, POST user/create-managed-user, PUT user/update-user/:codiceUtente, DELETE user/delete-user/:codiceUtente, POST user/set-stato, PATCH user/set-gdpr/:codiceUtente, POST user/register'],
          ['Permessi', 'GET permission/roles, POST permission/create-role, PUT permission/update-role/:codiceRuolo, DELETE permission/delete-role/:codiceRuolo, POST permission/assign-roles/:codiceUtente, POST permission/assign-permissions/:codiceUtente, GET permission/grants/:codiceUtente, GET permission/menus, GET permission/menu-types, GET permission/groups-with-menus'],
          ['Catalogo', 'POST/PUT/DELETE permission/menus[/:codiceMenu], permission/menu-groups[/:codiceGruppo], permission/menu-types[/:codiceTipo]'],
          ['Configurator', 'PATCH configurator/menus/:codiceMenu/enabled, PATCH configurator/groups/:codiceGruppo/enabled'],
          ['Filtri', 'GET filtri/tipi, POST/PUT/DELETE filtri/tipi[/:tipFil], GET/POST filtri/utente'],
          ['SSO', 'GET/POST federated-auth/providers, PATCH/DELETE providers/:provider, GET/POST users/:codiceUtente/identities, POST users, PATCH users/:codiceUtente/password-login'],
          ['Token', 'POST/GET service-token, DELETE service-token/:tokenId, POST service-token/:tokenId/rotate'],
          ['Console', 'GET console, console/:view, console/:view/:sub, console/assets/:file'],
        ],
      ),
    ],
  },
  // -------------------------------------------------------------------------
  {
    id: 'antipattern',
    group: 'Riferimenti',
    title: 'Antipattern e checklist',
    summary: 'Che cosa non fare, in breve.',
    blocks: [
      list([
        `Non aprire la porta HTTP prima di initializeAccessiModule.`,
        `Non usare authorizeAccessi come unico strato: valida sempre anche l'input applicativo.`,
        `Non dare per scontato che req.userGrants esista se non hai richiesto dei requisiti.`,
        `Non considerare incrementali assignRolesToUser e assignPermissionsToUser: sono sostitutivi.`,
        `Non far validare i token SSO ad Accessi: passagli solo { provider, subject } verificati.`,
        `Non usare un service token come identità utente.`,
        `Non versionare segreti; jwtOptions.secret deve essere unico per ambiente.`,
        `Non eliminare gruppi o tipi in uso: gestisci l'errore 400 e disabilita invece.`,
        `Non usare il challenge 2FA come JWT.`,
      ]),
      note('ok', `Checklist di rilascio`, `Schema verificato (db:check), segreti da un secret manager, mockDemoUser=false, rate limit pubblico configurato, SMTP reale testato, serviceTokens.defaultTtlDays impostato.`),
    ],
  },
];

/** Elenco ordinato dei gruppi per l'indice. */
export function wikiGroups(): Array<{ group: string; sections: WikiSection[] }> {
  const groups: Array<{ group: string; sections: WikiSection[] }> = [];
  for (const section of WIKI_SECTIONS) {
    let bucket = groups.find((item) => item.group === section.group);
    if (!bucket) {
      bucket = { group: section.group, sections: [] };
      groups.push(bucket);
    }
    bucket.sections.push(section);
  }
  return groups;
}

/**
 * Digest compatto in Markdown per l'IA che costruisce il backend integratore.
 * Deriva dagli stessi dati della wiki, quindi resta sincronizzato.
 */
export function buildAiDigest(): string {
  const lines: string[] = [
    `# Accessi (emilsoftware-utilities) - guida compatta per l'integrazione backend`,
    '',
    `Modulo NestJS/Express + Firebird per autenticazione JWT, autorizzazione per menu, utenti, 2FA e passwordless, SSO generico, service token e console.`,
    '',
  ];

  for (const { group, sections } of wikiGroups()) {
    lines.push(`## ${group}`);
    for (const section of sections) {
      lines.push(`### ${section.title}`);
      lines.push(section.summary);
      for (const block of section.blocks) {
        switch (block.kind) {
          case 'p':
            lines.push(block.text);
            break;
          case 'h':
            lines.push(`**${block.text}**`);
            break;
          case 'list':
            block.items.forEach((item, index) => lines.push(`${block.ordered ? `${index + 1}.` : '-'} ${item}`));
            break;
          case 'code':
            lines.push('```' + block.language);
            lines.push(block.code);
            lines.push('```');
            break;
          case 'callout':
            lines.push(`[${block.tone.toUpperCase()}] ${block.title ? block.title + ': ' : ''}${block.text}`);
            break;
          case 'table':
            lines.push('| ' + block.head.join(' | ') + ' |');
            lines.push('| ' + block.head.map(() => '---').join(' | ') + ' |');
            block.rows.forEach((row) => lines.push('| ' + row.join(' | ') + ' |'));
            break;
        }
      }
      lines.push('');
    }
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
