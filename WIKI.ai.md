<!-- Documento generato automaticamente da src/accessi-module/Console/wiki.ts. Non modificare a mano: npm run generate:accessi-wiki. -->

# Guida compatta per l'IA

Versione sintetica della wiki, pensata per essere incollata a un'IA che costruisce il backend integratore.
Disponibile anche nella console con il pulsante "Copia per AI" (`/api/accessi/console/wiki`).

Il contenuto è racchiuso in un blocco di codice per essere copiato verbatim, senza interpretazione Markdown.

````text
# Accessi (emilsoftware-utilities) - guida compatta per l'integrazione backend

Modulo NestJS/Express + Firebird per autenticazione JWT, autorizzazione per menu, utenti, 2FA e passwordless, SSO generico, service token e console.

## Per iniziare
### Panoramica e architettura
Che cosa fa Accessi, come si incastra nel backend e come scorre una richiesta.
Accessi è un modulo Node/NestJS che aggiunge a un backend già esistente: autenticazione JWT, autorizzazione per ruoli e menu, gestione utenti, reset password, codici email (2FA e passwordless), SSO generico, token macchina-a-macchina e una console amministrativa. Il database è Firebird/InterBase.
**Che cosa possiede il modulo**
- Le rotte sotto /api/accessi/* (login, utenti, ruoli, menu, filtri, SSO, token, console).
- Lo schema database del dominio Accessi, riconciliato automaticamente al bootstrap.
- Il middleware di autorizzazione authorizeAccessi per le rotte della tua applicazione.
- La console web su /api/accessi/console.
**Che cosa resta alla tua applicazione**
- Il proprio frontend e le proprie rotte di business.
- La validazione dei token dei provider SSO esterni (Accessi non li vede).
- I segreti: jwtOptions.secret, SMTP, database ed encryptionKey non raggiungono mai il browser.
**Flusso di una richiesta protetta**
1. Il client chiama una rotta della tua app con header Authorization: Bearer <jwt>.
2. La tua rotta esegue authorizeAccessi, che verifica firma HS256, scadenza e stato utente corrente.
3. Se passi un requisito, il modulo carica ruoli e grant dell'utente e li valuta.
4. Su successo req.user, req.data e (se richiesto) req.userGrants sono popolati; altrimenti risponde con il contratto errore Accessi.
[INFO] Due modalità di bootstrap: Express esistente: initializeAccessiModule(app, options). NestJS esistente: AccessiModule.forRoot(options) nei tuoi imports. Non usarle entrambe.

### Installazione
Dipendenze, peer e build.
```bash
npm install emilsoftware-utilities
```
La libreria dipende da node-firebird per il database e da Express 5 come peer per il montaggio. È consigliato Node 18 o superiore.
[WARN] Un solo modulo per processo: AccessiModule è @Global(): inizializzalo una sola volta per processo. In caso di più istanze, usa un processo per istanza.

### Bootstrap su Express esistente
initializeAccessiModule: ordine corretto e attesa prima di listen.
Chiama initializeAccessiModule prima di aprire la porta HTTP. Durante il bootstrap, authorizeAccessi risponde 503 ACCESSI_AUTH_INITIALIZING invece di autorizzare richieste parziali.
```ts
import express from 'express';
import { initializeAccessiModule, authorizeAccessi } from 'emilsoftware-utilities';

const app = express();
app.use(express.json());

await initializeAccessiModule(app, options); // prima di app.listen

app.get('/api/ordini', authorizeAccessi, (req, res) => {
  res.json({ utente: req.user });
});

app.get('/api/ordini/scrivi', (req, res, next) =>
  authorizeAccessi(req, res, next, {
    requirements: [{ menuCode: 'ORDINI', minPermissionLevel: 20 }],
  }),
(req, res) => res.json({ ok: true }));

app.listen(3000);
```
```ts
const app = express();
app.listen(3000); // porta aperta prima del bootstrap
await initializeAccessiModule(app, options); // le richieste nel frattempo ricevono 503
```
**Rotte montate**
Accessi intercetta solo /api/accessi/*, /accessi/swagger* e /accessi/swagger.json. Tutte le altre rotte passano intatte al tuo stack Express.
[OK] req.user: authorizeAccessi popola req.user con il payload utente corrente (utente, codiceUtente, flag) e req.data come alias storico. req.userGrants è presente solo se hai richiesto dei requisiti.

### Bootstrap su NestJS esistente
AccessiModule.forRoot e uso dei provider esportati.
Se la tua applicazione è già NestJS, importa AccessiModule.forRoot(options). Il modulo è @Global e riesporta i servizi (AuthService, UserService, PermissionService, FederatedAuthService, ServiceTokenService, ServiceTokenGuard, AuthenticateGenService).
```ts
import { Module } from '@nestjs/common';
import { AccessiModule } from 'emilsoftware-utilities';

@Module({
  imports: [AccessiModule.forRoot(options)],
})
export class AppModule {}
```
Il global prefix api e le rotte /api/accessi/* sono gestiti dal modulo. Le tue rotte Nest si proteggono con JwtSimpleGuard usando il JWT Accessi.

## Configurazione
### AccessiOptions (riferimento completo)
Ogni campo di configurazione con tipo, obbligo e note.
| Campo | Tipo | Obbligo | Note |
| --- | --- | --- | --- |
| databaseOptions | Options (node-firebird) | sì | Connessione Firebird al database Accessi. |
| confirmationEmailUrl | string | sì | Base URL usata per il reset password. |
| confirmationEmailReturnUrl | string | sì | URL di ritorno dopo il reset. |
| confirmationEmailPrefix | string | no | Prefisso passato alla pagina di reset. |
| customResetPage | string | no | Sostituisce la pagina HTML di reset inclusa. |
| encryptionKey | string | sì | Compatibilità e migrazione delle password legacy. |
| mockDemoUser | boolean | sì | Utenti fittizi admin e demo solo fuori produzione. |
| passwordExpiration | boolean | no | Attiva il controllo della scadenza password al login. |
| passwordExpirationDays | number | no | Valore predefinito: 90 giorni. |
| legacyPasswordMigrationOnStartup | boolean | no | Predefinito true: converte le password legacy. |
| autoUpdateDatabase | boolean | no | Predefinito true: riconcilia lo schema al boot. |
| jwtOptions | { secret, expiresIn } | sì | Firma HS256 e durata dei JWT Accessi. |
| emailOptions | EmailOptions | sì | SMTP per reset e codici email. |
| publicAuthRateLimit | PublicAuthRateLimitOptions | no | Limiti in-memory sugli endpoint pubblici. |
| publicRegistration | { enabled } | no | Registrazione pubblica: disattivata per impostazione predefinita. |
| federatedAuthentication | FederatedAuthenticationOptions | no | Abilita l'SSO generico. |
| extensionFieldsOptions | ExtensionFieldsOptions[] | no | Tabelle esterne allegate al profilo. |
| serviceTokens | { enabled, defaultTtlDays } | no | Token macchina-a-macchina, abilitati per impostazione predefinita. |
| catalogScripts | { enabled, folder, ... } | no | Catalog migrations SQL eseguite dopo la riconciliazione dello schema. |
```ts
import type { AccessiOptions } from 'emilsoftware-utilities';

export const options: AccessiOptions = {
  databaseOptions: {
    host: process.env.ACCESSI_DB_HOST!,
    port: Number(process.env.ACCESSI_DB_PORT ?? 3050),
    database: process.env.ACCESSI_DB_NAME!,
    user: process.env.ACCESSI_DB_USER!,
    password: process.env.ACCESSI_DB_PASSWORD!,
  },
  confirmationEmailUrl: 'https://app.example.com',
  confirmationEmailReturnUrl: 'https://app.example.com/login',
  encryptionKey: process.env.ACCESSI_ENCRYPTION_KEY!,
  mockDemoUser: false,
  passwordExpiration: true,
  passwordExpirationDays: 90,
  jwtOptions: {
    secret: process.env.ACCESSI_JWT_SECRET!, // almeno 32 caratteri casuali, unico per ambiente
    expiresIn: '24h',
  },
  emailOptions: {
    host: process.env.SMTP_HOST!,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: false,
    requireTLS: true,
    tls: { rejectUnauthorized: true },
    from: 'no-reply@example.com',
    auth: { user: process.env.SMTP_USER!, pass: process.env.SMTP_PASS! },
  },
  publicRegistration: { enabled: false },
  serviceTokens: { enabled: true, defaultTtlDays: 365 },
};
```
```ts
jwtOptions: { secret: 'accessi', expiresIn: '24h' }, // segreto debole e condiviso
mockDemoUser: true, // MAI in produzione
```
[DANGER] Segreti: Non versionare i segreti e non passarli al frontend. jwtOptions.secret deve essere identico tra le istanze del backend e diverso da quello dei provider SSO.

### Schema e aggiornamento del database
Tabelle, riconciliazione automatica e CLI.
Accessi possiede lo schema del dominio. Con autoUpdateDatabase true (predefinito) lo riconcilia a ogni avvio; con false verifica comunque la compatibilità in sola lettura e blocca gli avvii incompatibili.
**Tabelle principali**
- PARAMETRI, UTENTI, UTENTI_CONFIG, UTENTI_PWD, UTENTI_OLDPWD, UTENTI_GDPR
- RUOLI, MENU_GRP, MENU_TIPI, MENU, ABILITAZIONI, RUOLI_MNU, UTENTI_RUOLI
- FILTRI, FILTRI_TIPO
- SSO_PROVIDER, UTENTI_IDENTITA_EXT
- ACCESSI_2FA, ACCESSI_SERVICE_TOKEN, ACCESSI_CATALOG_SCRIPT
```bash
npm run db:update:accessi   # riconcilia lo schema
npm run db:check:accessi    # verifica senza modificare
```
[WARN] Versioni: La libreria richiede uno schema compatibile con la versione corrente (ACCESSI_SCHEMA_VERSION). Se la verifica fallisce, leggi il codice errore ACCESSI_DATABASE_SCHEMA_OUTDATED ed esegui db:update:accessi.

### Catalog migrations SQL
Allinea menu, ruoli e cataloghi su piu database in modo idempotente.
Gli script SQL applicativi (menu, ruoli, tipi, cataloghi) restano nel repository del backend ospitante e Accessi li esegue dopo la riconciliazione dello schema. Ogni script viene tracciato nella tabella ACCESSI_CATALOG_SCRIPT (nome + checksum), quindi viene applicato una sola volta per database.
**Configurazione**
```ts
catalogScripts: {
  enabled: true,
  folder: './db/accessi-catalog', // versionata nel repo del backend
  onChecksumMismatch: 'error',     // 'error' (default) | 'warn' | 'reapply'
  stopOnError: true,
}
```
- Gli script sono ordinati per percorso (usa prefissi numerici: 0001_, 0002_, ...).
- Devono essere idempotenti e ripetibili: UPDATE OR INSERT ... MATCHING, MERGE, DELETE+INSERT mirati.
- Non includere utenti: le catalog migrations allineano solo catalogo e configurazione.
- Supportati SET TERM, stringhe e commenti; nessuna semantica SQL viene interpretata.
```bash
# Applica (schema + catalog migrations) su un database
ACCESSI_CATALOG_FOLDER=./db/accessi-catalog npm run db:catalog:accessi

# Elenca solo quelle da applicare / modificate
ACCESSI_CATALOG_FOLDER=./db/accessi-catalog npm run db:catalog:accessi:check
```
[INFO] Idempotenza: Uno script gia applicato con lo stesso checksum viene saltato. Se il file cambia dopo l'applicazione, con policy error il run si interrompe: non modificare uno script applicato, aggiungine uno nuovo.

## Autenticazione
### Login locale e JWT
Endpoint di login, risposta e gestione della password scaduta.
```http
POST /api/accessi/auth/login
Content-Type: application/json

{ "email": "utente@example.com", "password": "Segreta123!" }
```
La risposta include Result.token (il JWT) e il profilo utente con ruoli, permessi e filtri. Se l'account è passwordless, ometti la password: il server risponde con un challenge via email (vedi la sezione su 2FA e passwordless).
```ts
const res = await fetch('/api/accessi/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
const body = await res.json();
if (body.Result?.challenge) { /* richiedi il codice */ }
const token = body.Result?.token;
```
[WARN] Password scaduta: Con passwordExpiration attivo, una password scaduta produce una PasswordExpiredResponse con code PASSWORD_EXPIRED. Il client deve avviare il reset della password.
**Verifica del token**
```http
POST /api/accessi/auth/get-user-by-token
Content-Type: application/json

{ "token": "<jwt>" }
```
Usalo per verificare un JWT e ottenere il profilo corrente (utile al bootstrap di una SPA). Restituisce Result.userData.

### Codici email, 2FA e passwordless
Verifica in due passi, challenge e policy per utente.
La verifica con codice email è per-utente (flagDueFattori / UTENTI_CONFIG.FLG2FATT) ed è disattivata per impostazione predefinita. Con passwordlessLoginEnabled (FLGPWDLESS, richiede la 2FA attiva) l'accesso avviene con il solo codice email.
| Configurazione | Accesso locale | Accesso SSO |
| --- | --- | --- |
| 2FA disattivata | Password | Provider |
| 2FA attiva | Password + codice email | Provider + codice email |
| 2FA + passwordless | Solo codice email | Provider + codice email |
```json
{
  "Result": {
    "challenge": {
      "twoFactorRequired": true,
      "challengeId": "64-caratteri-esadecimali",
      "method": "email",
      "expiresAt": "2026-09-11T14:00:00.000Z",
      "resendAfterSeconds": 60
    }
  }
}
```
```http
POST /api/accessi/auth/two-factor/verify
{ "challengeId": "...", "code": "012345" }

POST /api/accessi/auth/two-factor/resend
{ "challengeId": "..." }
```
- Il codice ha 6 cifre, dura 10 minuti, consente 5 tentativi totali e al massimo 3 invii per challenge.
- Fino alla verifica non sono presenti token, profilo o grant.
- Il challenge non è un JWT e non va usato nell'header Authorization.
```ts
// Sbagliato: usare il challenge come token
fetch('/api/ordini', { headers: { Authorization: 'Bearer ' + challengeId } }); // 401
```

### Reset password
Invio email e conferma con token monouso.
```http
POST /api/accessi/email/send-reset-password-email
{ "email": "utente@example.com" }

POST /api/accessi/auth/confirm-reset-password/{token}
{ "newPassword": "NuovaSegreta123!" }
```
L'invio non rivela se l'email esiste (anti-enumerazione). Il token di reset è monouso ed è firmato con una chiave dedicata.
[INFO] Pagina personalizzata: Imposta customResetPage per usare la tua pagina di reset invece di quella inclusa. confirmationEmailReturnUrl e confirmationEmailPrefix controllano il ritorno.

## Autorizzazione
### authorizeAccessi (middleware)
Proteggere le rotte della tua app con il JWT Accessi.
authorizeAccessi è un middleware Express che verifica il JWT, ricarica lo stato utente corrente e applica i requisiti. Su successo prosegue; su errore risponde direttamente con il contratto Accessi (non chiamare un tuo next(error)).
```ts
app.get('/api/report',
  (req, res, next) => authorizeAccessi(req, res, next, {
    requirements: [{ menuCode: 'REPORT', minPermissionLevel: 10 }],
  }),
  (req, res) => res.json({ user: req.user, grants: req.userGrants }),
);
```
**Che cosa trovi nella request**
- req.user e req.data: payload utente corrente (alias storici).
- req.userGrants: grant effettivi, presente solo quando hai richiesto dei requisiti.
```ts
app.get('/api/report', authorizeAccessi, (req, res) => {
  // Sbagliato: assumere che req.userGrants esista senza requisiti
  const grants = req.userGrants.grants; // possibile TypeError
});
```
[DANGER] Lo stato utente è sempre ricontrollato: Un JWT valido non basta: se l'utente è stato bloccato, eliminato o ha cambiato policy, il middleware risponde 401 AUTH_USER_DISABLED.

### Requisiti e livelli di abilitazione
DSL accessiRequirement: permission, and, or, not, custom.
I requisiti si compongono con accessiRequirement. La forma storica requirements è un AND di permessi. Il livello è TipoAbilitazione: NESSUNA=0, LETTURA=10, SCRITTURA=20, SPECIAL=30; il confronto è tipoAbilitazione >= soglia.
```ts
import { authorizeAccessi, accessiRequirement as r } from 'emilsoftware-utilities';

// AND (entrambi i menu)
const both = r.and(r.permission("ORDINI", 20), r.permission("CLIENTI", 10));

// OR
const either = r.or(r.permission("REPORT", 10), r.permission("EXPORT", 20));

// NOT + custom
const policy = r.and(
  r.permission("AREA_RISERVATA", 10),
  r.not(r.permission("BLOCCO_TOTALE", 0)),
);

app.get("/api/riservato", (req, res, next) => authorizeAccessi(req, res, next, {
  requirementTree: policy,
  customRequirementHandlers: {
    stessoReparto: async (ctx) => ctx.userCode === Number(ctx.req.query.reparto),
  },
}), handler);
```
```ts
// Sbagliato: AND/OR senza figli -> errore di configurazione (500 AUTH_REQUIREMENTS_MISCONFIGURED)
const empty = r.and();
```
[WARN] custom senza handler: Un requisito custom la cui chiave non ha un handler produce 500 AUTH_REQUIREMENTS_MISCONFIGURED: è un errore di programmazione, non un 403.

## Dominio
### Utenti
Creazione, aggiornamento, stati, GDPR e filtri.
**Stati di registrazione (STAREG)**
| Valore | Nome | Effetto sul login |
| --- | --- | --- |
| 0 | NULL | Non confermato |
| 5 | INSERT | Non confermato |
| 10 | INVIO | Richiede il rinnovo della password |
| 20 | CONF | Valido |
| 50 | DELETE | Bloccato (soft delete) |
| 99 | BLOCC | Bloccato |
**Endpoint principali (superutente salvo diversamente indicato)**
| Metodo | Percorso | Descrizione |
| --- | --- | --- |
| GET | /api/accessi/user/get-users | Elenco con paginazione (limit e offset, header X-Total-Count). |
| POST | /api/accessi/user/create-managed-user | Crea un utente locale e invia il reset password. |
| PUT | /api/accessi/user/update-user/:codiceUtente | Aggiorna profilo e policy (campi privilegiati solo superutente). |
| DELETE | /api/accessi/user/delete-user/:codiceUtente | Soft delete: STAREG=DELETE. |
| POST | /api/accessi/user/set-stato | Imposta lo stato di registrazione. |
| PATCH | /api/accessi/user/set-gdpr/:codiceUtente | Registra il consenso GDPR. |
| POST | /api/accessi/user/register | Registrazione pubblica, solo se publicRegistration.enabled. |
```ts
await fetch('/api/accessi/user/create-managed-user', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + adminToken },
  body: JSON.stringify({
    email: 'nuovo@example.com',
    nome: 'Mario',
    cognome: 'Rossi',
    roles: [1, 2],
    permissions: [{ codiceMenu: 'REPORT', tipoAbilitazione: 10 }],
  }),
});
```
```ts
// Sbagliato: inviare flag privilegiati dal frontend pubblico
fetch("/api/accessi/user/register", {
  method: "POST",
  body: JSON.stringify({ email, flagSuper: true }), // ignorato o negato
});
```
[INFO] Campi di dominio: UTENTI_CONFIG contiene solo i flag di dominio Accessi: FLGSUPER, FLGADMIN, FLG2FATT (2FA), FLGPWDLESS (passwordless) e FLGPASSWORD (login locale). I flag/colonne applicativi (FLGMOP, FLGPIANA, FLGADDETTI, FLGOSPITI, FLGPIANARFID, FLGCONTA, FLGCUBI, FLGCICLPASS, FLGDIPENDENTI, FLGINVENTARI, CAUMOV, NUMMAC, RAGSOCCLI, PAGDEF, ENABLEIA, CELLUTE e NOMECAMPO) sono stati rimossi: i backend devono gestirli in tabelle proprie. Il telefono canonico e UTENTI_CONFIG.CELLULARE.
[INFO] Autorizzazioni: I gruppi/menu si abilitano tramite ABILITAZIONI, RUOLI_MNU e UTENTI_RUOLI. Il vecchio meccanismo NOMECAMPO (flag applicativo su UTENTI_CONFIG) e stato rimosso.
[INFO] Campi estesi: extensionFieldsOptions allega colonne di tabelle applicative al profilo (per esempio la ragione sociale). Le colonne sono in whitelist: non costruirle mai da input HTTP.

### Ruoli e permessi
Assegnazioni sostitutive e composizione dei grant.
I ruoli contengono una lista di menu con livello. Le assegnazioni (ruoli e permessi diretti) sono SOSTITUTIVE: invia sempre la lista completa desiderata. I grant diretti prevalgono su quelli dei ruoli; i superutenti vedono tutti i menu attivi.
| Metodo | Percorso | Descrizione |
| --- | --- | --- |
| GET | /api/accessi/permission/roles | Ruoli con i menu associati. |
| POST | /api/accessi/permission/create-role | Crea un ruolo (i menu sono obbligatori). |
| PUT | /api/accessi/permission/update-role/:codiceRuolo | Aggiorna un ruolo (menu sostitutivi). |
| DELETE | /api/accessi/permission/delete-role/:codiceRuolo | Elimina ruolo, mapping e assegnazioni. |
| POST | /api/accessi/permission/assign-roles/:codiceUtente | Sostituisce i ruoli dell'utente. |
| POST | /api/accessi/permission/assign-permissions/:codiceUtente | Sostituisce i permessi diretti. |
| GET | /api/accessi/permission/grants/:codiceUtente | Grant effettivi, permessi diretti e ruoli. |
```ts
const role = {
  descrizioneRuolo: 'Gestore ordini',
  menu: [
    { codiceMenu: 'ORDINI', tipoAbilitazione: 20 },
    { codiceMenu: 'CLIENTI', tipoAbilitazione: 10 },
  ],
};
await createRole(role); // POST /api/accessi/permission/create-role

// Sostitutivo: questa lista diventa l'intero set di ruoli dell'utente
await assignRolesToUser(codiceUtente, { roles: [3, 7] });
```
```ts
// Sbagliato: pensare che l'assegnazione sia incrementale
await assignRolesToUser(codiceUtente, { roles: [3] });
// ora l'utente ha SOLO il ruolo 3, non 3 più quelli di prima
```
[WARN] Menu obbligatori: create-role e update-role rifiutano un ruolo senza menu. Se ti serve un ruolo senza accessi, non crearlo.

### Menu, gruppi e tipi menu
Catalogo di navigazione e CRUD completo (superutente).
| Metodo | Percorso | Descrizione |
| --- | --- | --- |
| GET | /api/accessi/permission/menus | Menu attivi. |
| GET | /api/accessi/permission/menu-types | Catalogo dei tipi menu. |
| GET | /api/accessi/permission/groups-with-menus?includeDisabled=true | Gruppi con menu (anche disabilitati). |
| POST | /api/accessi/permission/menus | Crea un menu. |
| PUT | /api/accessi/permission/menus/:codiceMenu | Aggiorna un menu. |
| DELETE | /api/accessi/permission/menus/:codiceMenu | Elimina un menu (con grant e associazioni ai ruoli). |
| POST | /api/accessi/permission/menu-groups | Crea un gruppo. |
| PUT | /api/accessi/permission/menu-groups/:codiceGruppo | Aggiorna un gruppo. |
| DELETE | /api/accessi/permission/menu-groups/:codiceGruppo | Elimina un gruppo (solo se vuoto). |
| POST/PUT/DELETE | /api/accessi/permission/menu-types[/:codiceTipo] | CRUD dei tipi menu. |
I codici (CODMNU, CODGRP, CODTIP) sono chiavi immutabili: si indicano in creazione e poi si passano nel percorso. Un gruppo o un tipo si elimina solo se non è referenziato.
```ts
await createMenuGroup({ codiceGruppo: 'A', descrizioneGruppo: 'Amministrazione', ordineGruppo: 1, enabled: true });
await createMenuType({ codiceTipo: 'X', descrizioneTipo: 'Operativo' });
await createMenu({ codiceMenu: 'ORDINI', descrizioneMenu: 'Ordini', codiceGruppo: 'A', tipo: 'X', ordineMenu: 10, enabled: true });
```
```ts
// Sbagliato: eliminare un gruppo che contiene menu -> 400 con spiegazione
await deleteMenuGroup('A'); // contiene N menu
```

### Filtri applicativi
Filtri per utente e catalogo dei tipi filtro.
| Metodo | Percorso | Descrizione |
| --- | --- | --- |
| GET | /api/accessi/filtri/tipi | Catalogo dei tipi filtro. |
| POST | /api/accessi/filtri/tipi | Crea un tipo filtro (superutente). |
| PUT | /api/accessi/filtri/tipi/:tipFil | Aggiorna un tipo filtro. |
| DELETE | /api/accessi/filtri/tipi/:tipFil | Elimina un tipo filtro (se non è usato). |
| GET | /api/accessi/filtri/utente?codUte=123 | Filtri di un utente (self o superutente). |
| POST | /api/accessi/filtri/utente | Upsert dei filtri (self o superutente). |
[INFO] Mapping delle colonne: I campi filtro sono mappati su colonne FILTRI in whitelist (FILTRI_UTENTE_DB_MAPPING). I campi non configurati nello schema vengono rifiutati.

## SSO
### SSO generico (federated authentication)
Il backend valida il provider, Accessi gestisce identità e sessioni.
Accessi non valida i token Azure, Google o SAML: è il TUO backend a validare il flusso SSO e a passare solo { provider, subject } verificati a FederatedAuthService. Così issuer, secret e token restano fuori dal modulo.
```ts
import { FederatedAuthService } from 'emilsoftware-utilities';

// Nel tuo callback SSO, dopo aver validato il token del provider:
const verified = { provider: "azure-ad-acme", subject: claims.oid };
const result = await federatedAuthService.authenticate(verified);

if (result.login.challenge) {
  // 2FA attiva: restituisci il challenge al frontend
  return res.json({ challenge: result.login.challenge });
}
return res.json({ login: result.login, token: result.token });
```
**API amministrative (superutente)**
- GET/POST /api/accessi/federated-auth/providers, PATCH/DELETE providers/:provider
- GET/POST /api/accessi/federated-auth/users/:codiceUtente/identities
- POST /api/accessi/federated-auth/users (crea un utente SSO-only)
- PATCH /api/accessi/federated-auth/users/:codiceUtente/password-login
```ts
// Sbagliato: far validare il token del provider ad Accessi o fidarsi del frontend
await federatedAuthService.authenticate({ provider, subject: req.body.email }); // subject non verificato
```
[WARN] Provider in uso: Un provider si elimina solo se nessuna identità è collegata; altrimenti disabilitalo. La chiave del provider deve coincidere con la configurazione del backend.

## Token di servizio
### Token macchina-a-macchina
Autenticazione tecnica con scope: non è un superutente.
Formato: st_<id>.<segreto> (segreto da 256 bit). Nel database si salva solo lo SHA-256 del segreto; il segreto è mostrato una sola volta. La verifica restituisce { tokenId, label, scopes }: nessun ruolo o grant.
[DANGER] Non è un superutente: Un service token non apre le API Accessi: abilita solo le rotte della tua app che proteggi con ServiceTokenGuard.
```ts
import { ServiceTokenGuard, RequireServiceTokenScopes } from 'emilsoftware-utilities';

@UseGuards(ServiceTokenGuard)
@RequireServiceTokenScopes('ia')
@Post("internal/ask")
ask() { /* req.accessiServiceToken = { tokenId, label, scopes } */ }
```
**Gestione (superutente)**
- POST /api/accessi/service-token (label, scopes, expiresAt o ttlDays) -> segreto mostrato una volta
- GET /api/accessi/service-token?includeRevoked=true
- DELETE /api/accessi/service-token/:tokenId (revoca immediata)
- POST /api/accessi/service-token/:tokenId/rotate
```ts
// Sbagliato: usare un service token per autenticare un utente umano
fetch('/api/profilo', { headers: { Authorization: 'Bearer ' + serviceToken } }); // req.user assente
```
[WARN] Scadenza: Senza expiresAt né defaultTtlDays il token non scade: imposta serviceTokens.defaultTtlDays o una scadenza esplicita.

## Console
### Console amministrativa
Accesso, sezioni e che cosa si può fare.
La console è servita dal modulo su /api/accessi/console. Non ha stato proprio: ogni azione chiama le API protette con il JWT dell'utente connesso.
- Utenti: elenco, creazione locale o SSO, profilo, ruoli, grant diretti, stato, 2FA.
- Ruoli e grant: CRUD dei ruoli con l'albero delle abilitazioni.
- Menu e gruppi: CRUD di gruppi, menu e tipi menu.
- Filtri: filtri utente e tipi filtro.
- Token di servizio: creazione, rotazione, revoca.
- SSO: provider e identità.
- Wiki e Changelog: documentazione e novità della libreria.
[INFO] Superutente (FLGSUPER): Riceve TUTTE le abilitazioni al livello massimo (30) dopo il login. In console vede solo la sezione Utenti e gestisce utenti, ruoli e grant.
[INFO] Admin (FLGADMIN): Accede a tutta la console (catalogo, token, SSO, utenti) ma NON conferisce abilitazioni: i menu restano quelli assegnati via ABILITAZIONI/RUOLI_MNU.
[INFO] Accesso: Apri /api/accessi/console e accedi con un utente con FLGSUPER o FLGADMIN. Le sezioni sono raggiungibili anche tramite deep link (per esempio /api/accessi/console/menu-e-gruppi/menu).

## Riferimenti
### Contratto errori e codici
Formato della risposta e codici stabili ACCESSI_* e AUTH_*.
Gli errori HTTP delle API Accessi usano un contratto stabile: severity, status, statusCode, code, error (campo legacy uguale a code), message e details per gli errori di validazione.
```json
{
  "severity": "error",
  "status": 400,
  "statusCode": 2,
  "code": "ACCESSI_VALIDATION_ERROR",
  "error": "ACCESSI_VALIDATION_ERROR",
  "message": "La richiesta contiene dati non validi.",
  "details": ["email: deve essere una stringa."]
}
```
| Codice | Quando |
| --- | --- |
| ACCESSI_VALIDATION_ERROR | Body o parametri non validi (400). |
| ACCESSI_AUTH_INITIALIZING | Bootstrap in corso (503). |
| ACCESSI_AUTH_NOT_INITIALIZED | Modulo non inizializzato (500). |
| AUTH_HEADER_MISSING / AUTH_TOKEN_MISSING | Header Authorization assente (401). |
| AUTH_TOKEN_INVALID | JWT non valido o scaduto (401). |
| AUTH_USER_DISABLED | Utente non più autorizzato (401). |
| AUTH_INSUFFICIENT_PERMISSIONS | Requisiti non soddisfatti (403). |
| AUTH_REQUIREMENTS_MISCONFIGURED | Policy malformata o handler custom mancante (500). |
| ACCESSI_DATABASE_SCHEMA_OUTDATED | Schema del database incompatibile. |
| ACCESSI_SERVICE_TOKEN_RATE_LIMITED | Troppi tentativi (429). |

### Indice degli endpoint
Tutte le rotte /api/accessi/* in una tabella.
| Area | Endpoint principali |
| --- | --- |
| Auth | POST auth/login, auth/get-user-by-token, auth/confirm-reset-password/:token, auth/two-factor/verify, auth/two-factor/resend |
| Email | POST email/send-reset-password-email, GET email/reset-password-page/:token |
| Utenti | GET user/get-users, POST user/create-managed-user, PUT user/update-user/:codiceUtente, DELETE user/delete-user/:codiceUtente, POST user/set-stato, PATCH user/set-gdpr/:codiceUtente, POST user/register |
| Permessi | GET permission/roles, POST permission/create-role, PUT permission/update-role/:codiceRuolo, DELETE permission/delete-role/:codiceRuolo, POST permission/assign-roles/:codiceUtente, POST permission/assign-permissions/:codiceUtente, GET permission/grants/:codiceUtente, GET permission/menus, GET permission/menu-types, GET permission/groups-with-menus |
| Catalogo | POST/PUT/DELETE permission/menus[/:codiceMenu], permission/menu-groups[/:codiceGruppo], permission/menu-types[/:codiceTipo] |
| Configurator | PATCH configurator/menus/:codiceMenu/enabled, PATCH configurator/groups/:codiceGruppo/enabled |
| Filtri | GET filtri/tipi, POST/PUT/DELETE filtri/tipi[/:tipFil], GET/POST filtri/utente |
| SSO | GET/POST federated-auth/providers, PATCH/DELETE providers/:provider, GET/POST users/:codiceUtente/identities, POST users, PATCH users/:codiceUtente/password-login |
| Token | POST/GET service-token, DELETE service-token/:tokenId, POST service-token/:tokenId/rotate |
| Console | GET console, console/:view, console/:view/:sub, console/assets/:file |

### Antipattern e checklist
Che cosa non fare, in breve.
- Non aprire la porta HTTP prima di initializeAccessiModule.
- Non usare authorizeAccessi come unico strato: valida sempre anche l'input applicativo.
- Non dare per scontato che req.userGrants esista se non hai richiesto dei requisiti.
- Non considerare incrementali assignRolesToUser e assignPermissionsToUser: sono sostitutivi.
- Non far validare i token SSO ad Accessi: passagli solo { provider, subject } verificati.
- Non usare un service token come identità utente.
- Non versionare segreti; jwtOptions.secret deve essere unico per ambiente.
- Non eliminare gruppi o tipi in uso: gestisci l'errore 400 e disabilita invece.
- Non usare il challenge 2FA come JWT.
[OK] Checklist di rilascio: Schema verificato (db:check), segreti da un secret manager, mockDemoUser=false, rate limit pubblico configurato, SMTP reale testato, serviceTokens.defaultTtlDays impostato.
````
