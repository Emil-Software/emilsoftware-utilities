# Wiki del modulo Accessi

> Documento generato automaticamente da `src/accessi-service/console/wiki.ts` (la stessa fonte della Wiki nella console).
> Non modificarlo a mano: esegui `npm run generate:accessi-wiki`.

La stessa documentazione è disponibile, resa in modo interattivo, nella console Accessi su `/api/accessi/console/wiki`.
Per una versione compatta da fornire a un'IA che costruisce il backend integratore, vedi [`WIKI.ai.md`](WIKI.ai.md).

Percorsi per ruolo: [`docs/README.md`](docs/README.md) · quickstart [`service`](docs/quickstart-service.md), [`resource server`](docs/quickstart-resource-server.md), [`frontend`](docs/quickstart-frontend.md).

## Indice

**Percorsi**

- [Scegli il percorso giusto](#scegli-il-percorso-giusto)
- [Topologie di deployment](#topologie-di-deployment)

**Per iniziare**

- [Panoramica e architettura](#panoramica-e-architettura)
- [Installazione](#installazione)
- [Bootstrap su Express esistente](#bootstrap-su-express-esistente)
- [Bootstrap su NestJS esistente](#bootstrap-su-nestjs-esistente)
- [Distribuzione multi-app e package entry point](#distribuzione-multi-app-e-package-entry-point)
- [Verifica rapida dopo il bootstrap](#verifica-rapida-dopo-il-bootstrap)

**Configurazione**

- [AccessiOptions (riferimento completo)](#accessioptions-riferimento-completo)
- [Schema e aggiornamento del database](#schema-e-aggiornamento-del-database)
- [Catalog migrations SQL](#catalog-migrations-sql)

**Autenticazione**

- [Login locale e JWT](#login-locale-e-jwt)
- [Codici email, 2FA e passwordless](#codici-email-2fa-e-passwordless)
- [Reset password](#reset-password)

**Autorizzazione**

- [authorizeAccessi (middleware)](#authorizeaccessi-middleware)
- [Resource server e introspection](#resource-server-e-introspection)
- [Requisiti e livelli di abilitazione](#requisiti-e-livelli-di-abilitazione)

**Frontend**

- [Login, refresh, 2FA e reset password](#login-refresh-2fa-e-reset-password)
- [Scegliere e configurare il client](#scegliere-e-configurare-il-client)
- [Modalità cookie HttpOnly e CSRF](#modalità-cookie-httponly-e-csrf)

**Dominio**

- [Utenti](#utenti)
- [Ruoli e permessi](#ruoli-e-permessi)
- [Menu, gruppi e tipi menu](#menu-gruppi-e-tipi-menu)

**SSO**

- [SSO generico (federated authentication)](#sso-generico-federated-authentication)

**Token di servizio**

- [Token macchina-a-macchina](#token-macchina-a-macchina)

**Console**

- [Console amministrativa](#console-amministrativa)
- [Login as (accesso temporaneo)](#login-as-accesso-temporaneo)

**Operazioni**

- [Deploy del servizio](#deploy-del-servizio)
- [Store condivisi e multi-istanza](#store-condivisi-e-multi-istanza)
- [Hardening e checklist di sicurezza](#hardening-e-checklist-di-sicurezza)
- [Health, metriche e audit](#health-metriche-e-audit)
- [Multi-tenancy operativa](#multi-tenancy-operativa)
- [Versioni, migrazioni e deprecazioni](#versioni-migrazioni-e-deprecazioni)

**Riferimenti**

- [Contratto errori e codici](#contratto-errori-e-codici)
- [Indice degli endpoint](#indice-degli-endpoint)
- [Antipattern e checklist](#antipattern-e-checklist)
- [Problemi comuni e come risolverli](#problemi-comuni-e-come-risolverli)
- [Glossario](#glossario)

---

## Scegli il percorso giusto

_Chi sei, che cosa devi fare e quale entry point usare._

Accessi è un servizio di identità, non una libreria da montare ovunque. Prima di scrivere codice individua il tuo ruolo nella topologia: cambiano entry point, permessi e responsabilità.

| Sei... | Devi... | Entry point | Guida |
| --- | --- | --- | --- |
| Sviluppatore frontend | Login, refresh, 2FA, reset password, chiamare i backend con Bearer | accessi/client/public, accessi/console | Frontend |
| Backend che possiede il database Accessi | Bootstrap, database, SMTP, migrazioni, console, API | accessi/server | Bootstrap e Operazioni |
| Backend fratello | Verificare JWT e grant senza credenziali del database Accessi | accessi/resource-server | Resource server e introspection |
| Console o tool amministrativo | Gestire utenti, ruoli, menu, SSO e token di servizio | accessi/client/admin | Console e Dominio |
| Job o servizio tecnico | Introspezione token e scambio identità SSO | accessi/client/service | Token macchina-a-macchina |
| Operations o SRE | Deploy, Redis, health, metriche, audit, backup | accessi/server, deploy/ | Operazioni |
| DBA | Allineare e verificare lo schema Firebird | CLI db:update:accessi e db:check:accessi | Schema e aggiornamento del database |
| Agente AI | Costruire un integrazione corretta senza inventare API | integration-prompt.md, WIKI.ai.md | Prompt di integrazione |

> [!TIP]
> **Regola d'oro**
> Un solo Accessi Service possiede database, encryptionKey, SMTP, chiavi JWT e console. Gli altri backend sono resource server: verificano i token e chiedono i grant, senza credenziali del database Accessi.

### Percorso minimo: backend che possiede Accessi

1. Leggi Topologie di deployment e scegli servizio dedicato oppure embedded.
2. Configura AccessiOptions con database, encryptionKey, SMTP e jwtOptions (issuer e audience espliciti).
3. Chiama initializeAccessiModule oppure AccessiModule.forRoot e attendi il bootstrap prima di aprire la porta HTTP.
4. Esegui la migrazione dello schema una sola volta e avvia le repliche con autoUpdateDatabase: false.
5. Verifica /health/ready, crea il primo admin e prova login e una rotta protetta.

### Percorso minimo: backend fratello

1. Non installare AccessiModule e non configurare il database Accessi.
2. Usa createAccessiAuthMiddleware (Express) o createAccessiAuthGuard (Nest) da accessi/resource-server.
3. Verifica i JWT con publicKey/JWKS (consigliato) oppure serverSecret solo per HS256 transitorio.
4. Configura introspection con un service token scope accessi:introspect se servono i grant correnti.
5. Applica una policy esplicita sulle rotte sensibili e gestisci 401, 403 e 503 senza autorizzare per errore.

### Percorso minimo: frontend

1. Usa accessi/client/public: non importare mai il client admin o un service token nel browser.
2. Chiama login su Accessi Service, conserva l'access token e gestisci refresh e 2FA.
3. Verso i backend invia Authorization: Bearer. Non chiamare il database Accessi.
4. Sul 401 porta l'utente al login; sul 403 mostra un messaggio di permessi insufficienti; sul 503 riprova senza perdere la sessione.
5. Per la console usa buildAccessiConsoleUrl con il ticket monouso: il JWT non va mai nell'URL.

> [!NOTE]
> **Documentazione correlata**
> La mappa completa di file e guide è in docs/README.md. I quickstart copiabili sono docs/quickstart-service.md, docs/quickstart-resource-server.md e docs/quickstart-frontend.md.

---

## Topologie di deployment

_Embedded, servizio centrale o multi-tenant: vantaggi, limiti e quando scegliere quale._

Accessi può vivere dentro un backend già esistente oppure come servizio autonomo. La scelta dipende da chi possiede il database, quanti backend devono autenticare le stesse persone e se serve isolamento tra clienti.

### 1. Accessi embedded in un backend esistente

- Il backend ospitante è anche il proprietario del database Accessi: monta AccessiModule o chiama initializeAccessiModule.
- Va bene per una sola applicazione o per una fase di migrazione da un monolite.
- Non montare lo stesso modulo in due backend puntati allo stesso database.
- La console è servita dallo stesso backend su /api/accessi/console.

### 2. Accessi Service dedicato (consigliato)

**Topologia consigliata**

```text
Frontend A ─┐
Frontend B ─┼──> Accessi Service (DB, SMTP, utenti, ruoli, console, SSO, 2FA)
            │         ▲
Backend A ──┼─────────┤  introspection / service token
Backend B ──┘         │
                      └──> Accessi DB (solo Accessi Service)
```

- Accessi Service usa accessi/server: possiede database, migrazioni, encryptionKey, SMTP, chiavi JWT e console.
- I backend fratelli usano accessi/resource-server e non hanno credenziali del database Accessi.
- I frontend usano accessi/client/public e chiamano i backend con il JWT Accessi.
- Un solo punto di verità per utenti, ruoli e grant; la console resta centralizzata.
- È la topologia da preferire quando più applicazioni condividono le stesse identità.

### 3. Un processo per tenant

- Un database e un processo Accessi per tenant: nessuna colonna tenant nel database.
- Configurazione in file \<id\>.environment.ts tipizzati; validazione e avvio con npm run accessi:tenants.
- Chiavi JWT, issuer, audience, encryptionKey e prefissi Redis separati per tenant.
- Supervisore incluso con hot reload, oppure router in-process opt-in per ridurre i processi.
- Dettagli operativi in docs/multi-tenancy.md e nella sezione Operazioni di questa wiki.

| Topologia | Vantaggi | Limiti | Quando sceglierla |
| --- | --- | --- | --- |
| Embedded | Meno processi e deploy semplice | Un solo backend può possedere il DB | Applicazione singola o migrazione iniziale |
| Servizio dedicato | Confini chiari, più backend, console unica | Un servizio in più da monitorare | Più applicazioni con le stesse identità |
| Un processo per tenant | Isolamento forte di dati e chiavi | Più processi, più deploy e osservabilità per tenant | Clienti che richiedono database o chiavi separate |

> [!WARNING]
> **Non mescolare i modelli**
> Non montare AccessiModule in un backend fratello e non condividere un database Accessi tra più proprietari. Se due processi eseguono migrazioni o emettono ticket console sullo stesso database, il comportamento diventa ambiguo.

> [!NOTE]
> **Quando basta un resource server**
> Se il backend non gestisce utenti ma deve solo accettare i token emessi da Accessi Service, non gli serve accessi/server: usa accessi/resource-server e, se servono i grant correnti, l'introspection con un service token.

---

## Panoramica e architettura

_Che cosa fa Accessi, come si incastra nel backend e come scorre una richiesta._

Accessi è un modulo Node/NestJS che aggiunge a un backend già esistente: autenticazione JWT, autorizzazione per ruoli e menu, gestione utenti, reset password, codici email (2FA e passwordless), SSO generico, token macchina-a-macchina e una console amministrativa. Il database è Firebird/InterBase.

### Che cosa possiede il modulo

- Le rotte sotto /api/accessi/\* (login, utenti, ruoli, menu, SSO, token, console).
- Lo schema database del dominio Accessi, riconciliato automaticamente al bootstrap.
- Il middleware di autorizzazione authorizeAccessi per le rotte della tua applicazione.
- La console web su /api/accessi/console.

### Che cosa resta alla tua applicazione

- Il proprio frontend e le proprie rotte di business.
- La validazione dei token dei provider SSO esterni (Accessi non li vede).
- I segreti: jwtOptions.secret, SMTP, database ed encryptionKey non raggiungono mai il browser.

### Flusso di una richiesta protetta

1. Il client chiama una rotta della tua app con header Authorization: Bearer \<jwt\>.
2. La tua rotta esegue authorizeAccessi, che verifica firma HS256, scadenza e stato utente corrente.
3. Se passi un requisito, il modulo carica ruoli e grant dell'utente e li valuta.
4. Su successo req.user, req.data e (se richiesto) req.userGrants sono popolati; altrimenti risponde con il contratto errore Accessi.

> [!NOTE]
> **Due modalità di bootstrap**
> Express esistente: initializeAccessiModule(app, options). NestJS esistente: AccessiModule.forRoot(options) nei tuoi imports. Non usarle entrambe.

---

## Installazione

_Dipendenze, peer e build._

**Installazione**

```bash
npm install emilsoftware-utilities
```

La libreria dipende da node-firebird per il database e da Express 5 come peer per il montaggio. Richiede Node 20 o superiore; per compilare dal sorgente servono Node 22.18 o superiore.

Il pacchetto è pubblicato in CommonJS con export map esplicita per ogni entry point (accessi/server, accessi/resource-server/\*, accessi/client/\*, accessi/contracts\*, accessi/openapi, accessi/console, accessi/ui): gli import ESM funzionano tramite interop Node. sideEffects elenca solo root barrel, firebirdCompat e bundle console, così il resto è tree-shakable.

> [!WARNING]
> **Un solo modulo per processo**
> AccessiModule è @Global(): inizializzalo una sola volta per processo. In caso di più istanze, usa un processo per istanza.

---

## Bootstrap su Express esistente

_initializeAccessiModule: ordine corretto e attesa prima di listen._

Chiama initializeAccessiModule prima di aprire la porta HTTP. Durante il bootstrap, authorizeAccessi risponde 503 ACCESSI\_AUTH\_INITIALIZING invece di autorizzare richieste parziali.

**Esempio corretto — Express + Accessi**

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

**Esempio da evitare — Non aprire la porta prima del bootstrap**

```ts
const app = express();
app.listen(3000); // porta aperta prima del bootstrap
await initializeAccessiModule(app, options); // le richieste nel frattempo ricevono 503
```

### Rotte montate

Accessi intercetta solo /api/accessi/\* e i path OpenAPI configurati (default /accessi/openapi\* e /accessi/openapi.json). Tutte le altre rotte passano intatte al tuo stack Express.

> [!TIP]
> **req.user**
> authorizeAccessi popola req.user con il payload utente corrente (utente, codiceUtente, flag) e req.data come alias storico. req.userGrants è presente solo se hai richiesto dei requisiti.

---

## Bootstrap su NestJS esistente

_AccessiModule.forRoot e uso dei provider esportati._

Se la tua applicazione è già NestJS, importa AccessiModule.forRoot(options). Il modulo è @Global e riesporta i servizi (AuthService, UserService, PermissionService, FederatedAuthService, ServiceTokenService, ServiceTokenGuard, AuthenticateGenService).

**Esempio corretto — app.module.ts**

```ts
import { Module } from '@nestjs/common';
import { AccessiModule } from 'emilsoftware-utilities';

@Module({
  imports: [AccessiModule.forRoot(options)],
})
export class AppModule {}
```

Il global prefix api e le rotte /api/accessi/\* sono gestiti dal modulo. Le tue rotte Nest si proteggono con JwtSimpleGuard usando il JWT Accessi. Per health e readiness usare createAccessiHealthModule(\{ accessiOptions \}): espone /health/live e /health/ready con lo stesso contratto del servizio standalone (bootstrap, database, store Redis e check aggiuntivi).

---

## Distribuzione multi-app e package entry point

_Come usare Accessi come servizio centrale, come resource server o solo come contratti._

Accessi non va montato per forza in ogni backend. La distribuzione consigliata separa il servizio che possiede il database e la console dai backend fratelli che devono solo autenticare le richieste.

| Entry point | Uso | Dipendenze server |
| --- | --- | --- |
| accessi/server | Bootstrap completo: DB, SMTP, migrazioni, console, API. | sì |
| accessi/resource-server | Guard/middleware per backend fratelli: verifica JWT e autorizzazione remota. | no |
| accessi/client | Client OpenAPI generato per chiamare Accessi Service. | no |
| accessi/client/public | Solo API pubbliche (login, refresh, 2FA, reset password, registrazione, ticket console). | no |
| accessi/client/admin | Solo API amministrative (utenti, ruoli, menu, filtri, provider federati, schema). | no |
| accessi/client/service | Solo API service-to-service (service token e introspezione), mai nei frontend. | no |
| accessi/contracts | Tipi, enum e helper puri browser-safe. | no |
| accessi/contracts/dtos | DTO Nest con class-validator e decoratori OpenAPI. | no |
| accessi/openapi | setupOpenApi e merge del documento OpenAPI. | no |
| accessi/console | Helper per URL console, ticket e 2FA handoff. | no |
| accessi/ui | Percorsi degli asset Web Component frameworkless. | no |

Topologia consigliata: un solo Accessi Service possiede database, encryptionKey, SMTP, chiavi JWT e console. Gli altri backend usano resource-server e client, senza credenziali del database Accessi.

Multi-tenancy: un database per tenant, configurato da file \<id\>.environment.ts tipizzati (AccessiTenantEnvironment). Il database resta invariato (nessuna colonna tenant); ogni tenant gira in un processo separato con chiavi, issuer e store propri. Validazione e avvio con npm run accessi:tenants; template systemd/Docker/Nginx/Traefik in deploy/; dettagli in docs/multi-tenancy.md.

> [!WARNING]
> **Root barrel legacy**
> Il root barrel e i deep import restano supportati fino alla prossima major. I nuovi consumer devono usare gli entry point della tabella; la mappa di migrazione e in docs/import-migration.md.

Per avviare Accessi come servizio autonomo usare startAccessiService: espone /health/live, /health/ready, /health/metrics, valida la configurazione e gestisce SIGTERM/SIGINT.

Per parlare con piu Accessi Service o tenant dallo stesso processo usare createAccessiClient: ogni istanza ha base URL e token propri, isolati anche tra richieste concorrenti. configureAccessiClient resta il default globale per le funzioni esportate dal package.

**Esempio corretto — Import corretti per ruolo**

```ts
// Backend che ospita Accessi
import { initializeAccessiModule } from 'emilsoftware-utilities/accessi/server';

// Backend fratello: nessun AccessiModule, nessun DB Accessi
import { createAccessiAuthMiddleware } from 'emilsoftware-utilities/accessi/resource-server';
import { createAccessiClient } from 'emilsoftware-utilities/accessi/client';

const milano = createAccessiClient({ baseUrl: 'https://accessi-milano.example.com', getToken });
const roma = createAccessiClient({ baseUrl: 'https://accessi-roma.example.com', token: tokenRoma });
const [utentiMilano, utentiRoma] = await Promise.all([milano.getUsers(), roma.getUsers()]);
```

> [!WARNING]
> **Un solo proprietario**
> Non montare AccessiModule in due backend puntati allo stesso database: migrazioni, bootstrap admin, ticket console e rate limit diventano ambigui.

> [!NOTE]
> **Client per scope**
> Usare accessi/client/public nei frontend pubblici, accessi/client/admin nella console e nei tool amministrativi, accessi/client/service solo nei backend fratelli. Gli scope partizionano il client completo e condividono gli stessi tipi; il client completo resta disponibile per compatibilita.

> [!NOTE]
> **Split in pacchetti**
> Il package resta unico con entry point per scope: decisione, soglie per rivalutarla e piano di migrazione sono nell'ADR docs/adr/0001-split-package.md.

> [!NOTE]
> **IP reali dietro proxy**
> Imposta http.trustProxy sul numero di proxy davanti al servizio (1 per Nginx/Traefik/ALB, 2 con Cloudflare + ingress) e lascialo false se il servizio e esposto direttamente. Rate limit e audit usano req.ip: dettagli in docs/proxy-ip.md.

> [!NOTE]
> **Prompt di integrazione**
> Il file integration-prompt.md nella root del repository contiene il contesto completo per frontend, backend e agenti AI.

---

## Verifica rapida dopo il bootstrap

_Checklist per capire subito se Accessi è configurato correttamente._

Dopo il bootstrap non fidarti solo del log di avvio. Verifica nell'ordine questi punti: un errore a monte rende inutili tutti i test successivi.

1. GET /health/live risponde 200: il processo è vivo.
2. GET /health/ready risponde 200 e ogni check è verde: bootstrap completato, database raggiungibile, schema allineato e store Redis configurati raggiungibili.
3. Il primo admin esiste: usa il bootstrap admin dalla console oppure crea l'utente con la CLI, poi disabilita adminBootstrap.
4. POST /api/accessi/auth/login restituisce un token e Result.token.expiresIn è espresso in secondi.
5. Una rotta protetta del backend accetta il token e popola req.user; senza token risponde 401 con un codice AUTH\_\*.
6. Una rotta con requisito e utente senza grant risponde 403 AUTH\_INSUFFICIENT\_PERMISSIONS, non 401.
7. Con Accessi Service spento, un backend fratello configurato con introspection risponde 503 e non autorizza.
8. La console si apre e il ticket di ingresso è monouso; in multi-istanza lo store condiviso è configurato.

**Health check**

```bash
curl -fsS https://accessi.example.com/health/live
curl -fsS https://accessi.example.com/health/ready
curl -fsS https://accessi.example.com/health/metrics | head
```

> [!TIP]
> **Prima del rilascio**
> Esegui npm run typecheck, npm test, npm run build, npm run test:pack e npm run check:accessi-openapi. Se hai modificato il contratto OpenAPI, aggiorna il fingerprint con npm run accessi:update-openapi-fingerprint.

> [!WARNING]
> **Segreti**
> Non copiare token, ticket console, password o chiavi private nei log, nelle issue o nei documenti. Le verifiche manuali vanno fatte con un utente e un ambiente di test.

---

## AccessiOptions (riferimento completo)

_Ogni campo di configurazione con tipo, obbligo e note._

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
| jwtOptions | \{ secret, expiresIn, refreshExpiresIn, algorithm, issuer, audience, privateKey, publicKey, keyId, jwksPath, previousPublicKeys, onUnknownKeyId \} | sì | Firma, durata, refresh token, JWKS e rotazione chiavi. Default HS256; RS/ES consigliati per resource server multi-servizio. |
| emailOptions | EmailOptions | sì | SMTP per reset e codici email. |
| publicAuthRateLimit | PublicAuthRateLimitOptions | no | Limiti per endpoint pubblici; store condiviso opzionale (Redis) per il cluster. |
| edgeRateLimit | AccessiEdgeRateLimitOptions | no | Limite grossolano per IP davanti alle rotte Accessi; opzionale, store condiviso supportato. |
| http | \{ cors, trustProxy, securityHeaders \} | no | CORS, IP reali dietro proxy e header di sicurezza con CSP a nonce per la console e direttive configurabili. |
| authCookie | \{ enabled, secure, sameSite, csrf, ... \} | no | Cookie HttpOnly e CSRF double-submit al posto del Bearer. Default disattivato. |
| metrics | \{ enabled, sink, prefix \} | no | Metriche Prometheus di dominio (login, 2FA, refresh, rate limit, store) e sink esterno opzionale. |
| audit | \{ enabled, sinks, store, retentionDays, redact \} | no | Audit persistente redatto, retention e query/export admin. Default: solo log strutturato. |
| publicRegistration | \{ enabled \} | no | Registrazione pubblica: disattivata per impostazione predefinita. |
| federatedAuthentication | FederatedAuthenticationOptions | no | Abilita l'SSO generico. |
| extensionFieldsOptions | ExtensionFieldsOptions\[\] | no | Tabelle esterne allegate al profilo. |
| serviceTokens | \{ enabled, defaultTtlDays, rateLimitStore \} | no | Token macchina-a-macchina, abilitati per impostazione predefinita; rate limit condiviso opzionale. |
| catalogScripts | \{ enabled, folder, ... \} | no | Catalog migrations SQL eseguite dopo la riconciliazione dello schema. |
| adminBootstrap | \{ enabled, superUser \} | no | Token casuale a ogni avvio per creare il primo admin dalla console. |
| publicBaseUrl | string | no | Base URL usata solo per loggare console/OpenAPI/API. |
| consoleApiBaseUrl | string | no | Base URL API per la console quando UI e API sono su domini diversi. |
| openapi | OpenApiSetupOptions | no | Path, titolo, descrizione e enabled della documentazione OpenAPI. Default invariati. |
| consoleEntry | \{ ttlMs, store \} | no | TTL e store condiviso dei ticket console (Redis per multi-istanza). Default in memoria. |
| sessionRevocation | \{ enabled, store, ttlMs \} | no | Revoca sessioni per utente tramite store memory/Redis; abilita POST /api/accessi/auth/revoke-sessions. |
| accessTokenRevocation | \{ enabled, store, ttlMs \} | no | Revoca dei singoli access token tramite jti (memory/Redis); abilita POST /api/accessi/auth/revoke-token. |
| refreshTokenRotation | \{ enabled, store, reuseGraceMs, revokeUserSessionsOnReuse \} | no | Refresh token monouso tramite store memory/Redis; al riuso oltre la finestra di grazia revoca la famiglia di token. Consigliato in multi-istanza. |
| logger | LoggerService | no | Logger Nest del sotto-app; se assente Nest usa il proprio logger. |
| bufferLogs | boolean | no | Buffer dei log di bootstrap del sotto-app. Default true. |

**Esempio corretto — Configurazione tipica**

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
    issuer: 'accessi',
    audience: 'backend-app',
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

options.openapi personalizza path, titolo e descrizione della documentazione OpenAPI. Con enabled: false UI e JSON non vengono montati, ma le API /api/accessi restano attive. initializeAccessiModule restituisce \{ nestApp, document \} per mergiare il contratto nel documento OpenAPI unico dell'host.

**Esempio corretto — OpenAPI personalizzato**

```ts
const { document } = await initializeAccessiModule(app, {
  ...options,
  openapi: { openApiPath: 'auth/docs', openApiJsonPath: 'auth/docs.json', title: 'Auth API' },
});
// document.paths e document.components.schemas sono pronti per il merge
```

**Esempio da evitare — Errori comuni**

```ts
jwtOptions: { secret: 'accessi', expiresIn: '24h' }, // segreto debole e condiviso
mockDemoUser: true, // MAI in produzione
```

> [!CAUTION]
> **Segreti**
> Non versionare i segreti e non passarli al frontend. jwtOptions.secret deve essere identico tra le istanze del backend e diverso da quello dei provider SSO.

---

## Schema e aggiornamento del database

_Tabelle, riconciliazione automatica e CLI._

Accessi possiede lo schema del dominio. Con autoUpdateDatabase true (predefinito) lo riconcilia a ogni avvio; con false verifica comunque la compatibilità in sola lettura e blocca gli avvii incompatibili.

### Tabelle principali

- PARAMETRI, UTENTI, UTENTI\_CONFIG, UTENTI\_PWD, UTENTI\_OLDPWD, UTENTI\_GDPR
- RUOLI, MENU\_GRP, MENU\_TIPI, MENU, ABILITAZIONI, RUOLI\_MNU, UTENTI\_RUOLI
- FILTRI, FILTRI\_TIPO
- SSO\_PROVIDER, UTENTI\_IDENTITA\_EXT
- ACCESSI\_2FA, ACCESSI\_SERVICE\_TOKEN, ACCESSI\_CATALOG\_SCRIPT

**CLI schema**

```bash
npm run db:update:accessi   # riconcilia lo schema
npm run db:check:accessi    # verifica senza modificare
```

> [!WARNING]
> **Versioni**
> La libreria richiede uno schema compatibile con la versione corrente (ACCESSI\_SCHEMA\_VERSION). Se la verifica fallisce, leggi il codice errore ACCESSI\_DATABASE\_SCHEMA\_OUTDATED ed esegui db:update:accessi.

> [!NOTE]
> **Schema esatto**
> La riconciliazione allinea le tabelle Accessi a "niente in piu, niente in meno": le colonne non previste vengono segnalate come incompatibili e rimosse automaticamente (dopo rename e copie dei dati legacy). Gli indici, i trigger e i CHECK extra non previsti non vengono tolti, ma un indice non previsto su una tabella Accessi viene riportato come avviso senza bloccare l'avvio.

---

## Catalog migrations SQL

_Allinea menu, ruoli e cataloghi su piu database in modo idempotente._

Gli script SQL applicativi (menu, ruoli, tipi, cataloghi) restano nel repository del backend ospitante e Accessi li esegue dopo la riconciliazione dello schema. Ogni script viene tracciato nella tabella ACCESSI\_CATALOG\_SCRIPT (nome + checksum), quindi viene applicato una sola volta per database.

### Configurazione

**Esempio corretto — AccessiOptions**

```ts
catalogScripts: {
  enabled: true,
  folder: './db/accessi-catalog', // versionata nel repo del backend
  onChecksumMismatch: 'error',     // 'error' (default) | 'warn' | 'reapply'
  stopOnError: true,
}
```

- Gli script sono ordinati per percorso (usa prefissi numerici: 0001\_, 0002\_, ...).
- Devono essere idempotenti e ripetibili: UPDATE OR INSERT ... MATCHING, MERGE, DELETE+INSERT mirati.
- Non includere utenti: le catalog migrations allineano solo catalogo e configurazione.
- Supportati stringhe, commenti e statement multipli; SET TERM non serve perché gli script sono solo DML.

> [!CAUTION]
> **Solo righe (DML)**
> Vincolo tassativo: uno script puo eseguire solo INSERT, UPDATE, DELETE, MERGE, SELECT, EXECUTE. Qualunque DDL (CREATE/ALTER/DROP, trigger, procedure, GRANT, transazioni) viene rifiutato. Lo schema si aggiorna solo con db:update:accessi.

> [!NOTE]
> **File non conformi**
> Un file con statement non consentiti non viene applicato ne registrato nel ledger; il run prosegue con gli altri e il report riporta una voce per ogni file con i relativi messaggi di errore (visibili anche con db:catalog:accessi:check).

> [!NOTE]
> **allowDdl**
> Disattivato di default. Impostarlo a true disabilita la validazione e permette DDL: usarlo solo consapevolmente e mai come sostituto dell'updater dello schema.

**CLI catalog migrations**

```bash
# Applica (schema + catalog migrations) su un database
ACCESSI_CATALOG_FOLDER=./db/accessi-catalog npm run db:catalog:accessi

# Elenca solo quelle da applicare / modificate
ACCESSI_CATALOG_FOLDER=./db/accessi-catalog npm run db:catalog:accessi:check
```

> [!NOTE]
> **Idempotenza**
> Uno script gia applicato con lo stesso checksum viene saltato. Se il file cambia dopo l'applicazione, con policy error il run si interrompe: non modificare uno script applicato, aggiungine uno nuovo.

---

## Login locale e JWT

_Endpoint di login, risposta e gestione della password scaduta._

**Login con password**

```http
POST /api/accessi/auth/login
Content-Type: application/json

{ "email": "utente@example.com", "password": "Segreta123!" }
```

La risposta include Result.token (il JWT) e il profilo utente con ruoli e permessi. Se l'account è passwordless, ometti la password: il server risponde con un challenge via email (vedi la sezione su 2FA e passwordless).

> [!NOTE]
> **Scadenza del token**
> Result.token.expiresIn e sempre espresso in secondi (per esempio 86400 per 24h), indipendentemente dal formato usato in jwtOptions.expiresIn.

> [!NOTE]
> **Autorizzazioni lato client**
> La fonte autorevole è Result.userGrants.grants: contiene i grant effettivi (ruoli + permessi diretti, livello massimo). Non leggere i permessi dal JWT e non usare Result.utente.permissions: non sono popolati. Per i superutenti grants contiene tutti i menu attivi al livello 30.

**Esempio corretto — Chiamata dal frontend**

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

> [!WARNING]
> **Password scaduta**
> Con passwordExpiration attivo, una password scaduta produce una PasswordExpiredResponse con code PASSWORD\_EXPIRED. Il client deve avviare il reset della password.

### Verifica del token

**get-user-by-token**

```http
POST /api/accessi/auth/get-user-by-token
Content-Type: application/json

{ "token": "<jwt>" }
```

Usalo per verificare un JWT e ottenere il profilo corrente (utile al bootstrap di una SPA). Restituisce Result.userData.

---

## Codici email, 2FA e passwordless

_Verifica in due passi, challenge e policy per utente._

La verifica con codice email è per-utente (flagDueFattori / UTENTI\_CONFIG.FLG2FATT) ed è disattivata per impostazione predefinita. Con passwordlessLoginEnabled (FLGPWDLESS, richiede la 2FA attiva) l'accesso avviene con il solo codice email.

| Configurazione | Accesso locale | Accesso SSO |
| --- | --- | --- |
| 2FA disattivata | Password | Provider |
| 2FA attiva | Password + codice email | Provider + codice email |
| 2FA + passwordless | Solo codice email | Provider + codice email |

**Risposta con challenge**

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

**Verifica e reinvio**

```http
POST /api/accessi/auth/two-factor/verify
{ "challengeId": "...", "code": "012345" }

POST /api/accessi/auth/two-factor/resend
{ "challengeId": "..." }
```

- Il codice ha 6 cifre, dura 10 minuti, consente 5 tentativi totali e al massimo 3 invii per challenge.
- Fino alla verifica non sono presenti token, profilo o grant.
- Il challenge non è un JWT e non va usato nell'header Authorization.

**Esempio da evitare — Il challenge non è un token**

```ts
// Sbagliato: usare il challenge come token
fetch('/api/ordini', { headers: { Authorization: 'Bearer ' + challengeId } }); // 401
```

---

## Reset password

_Invio email e conferma con token monouso._

**Reset in due passi**

```http
POST /api/accessi/email/send-reset-password-email
{ "email": "utente@example.com" }

POST /api/accessi/auth/confirm-reset-password/{token}
{ "newPassword": "NuovaSegreta123!" }
```

L'invio non rivela se l'email esiste (anti-enumerazione). Il token di reset è monouso ed è firmato con una chiave dedicata.

> [!WARNING]
> **Policy password (solo quando si imposta)**
> Reset, set-password admin e bootstrap richiedono almeno 8 caratteri con maiuscola, minuscola, cifra e carattere speciale, senza spazi e non comuni. Se non conforme l'API risponde 400 con code ACCESSI\_WEAK\_PASSWORD e l'elenco dei requisiti in details. La policy NON si applica al login: le password preesistenti eventualmente deboli continuano ad autenticare e vengono migrate senza blocco.

> [!NOTE]
> **Pagina personalizzata**
> Imposta customResetPage per usare la tua pagina di reset invece di quella inclusa. confirmationEmailReturnUrl e confirmationEmailPrefix controllano il ritorno.

---

## authorizeAccessi (middleware)

_Proteggere le rotte della tua app con il JWT Accessi._

authorizeAccessi è un middleware Express che verifica il JWT, ricarica lo stato utente corrente e applica i requisiti. Su successo prosegue; su errore risponde direttamente con il contratto Accessi (non chiamare un tuo next(error)).

**Esempio corretto — Rotta protetta**

```ts
app.get('/api/report',
  (req, res, next) => authorizeAccessi(req, res, next, {
    requirements: [{ menuCode: 'REPORT', minPermissionLevel: 10 }],
  }),
  (req, res) => res.json({ user: req.user, grants: req.userGrants }),
);
```

### Che cosa trovi nella request

- req.user e req.data: payload utente corrente (alias storici).
- req.userGrants: grant effettivi, presente solo quando hai richiesto dei requisiti.

**Esempio da evitare — Non dare per scontato req.userGrants**

```ts
app.get('/api/report', authorizeAccessi, (req, res) => {
  // Sbagliato: assumere che req.userGrants esista senza requisiti
  const grants = req.userGrants.grants; // possibile TypeError
});
```

> [!CAUTION]
> **Lo stato utente è sempre ricontrollato**
> Un JWT valido non basta: se l'utente è stato bloccato, eliminato o ha cambiato policy, il middleware risponde 401 AUTH\_USER\_DISABLED.

---

## Resource server e introspection

_Proteggere un backend fratello senza accedere al database Accessi._

Un backend che non possiede Accessi usa resource-server. La verifica puo essere locale (JWT) oppure delegata all'introspection di Accessi Service. La policy di autorizzazione usa gli stessi accessiRequirement del middleware storico.

**Esempio corretto — Express resource server**

```ts
import { createAccessiAuthMiddleware } from 'emilsoftware-utilities/accessi/resource-server';

app.use(createAccessiAuthMiddleware({
  jwt: {
    // In una topologia multi-servizio preferire RS256/JWKS:
    // publicKey: process.env.ACCESSI_JWT_PUBLIC_KEY,
    // algorithms: ["RS256"],
    serverSecret: process.env.ACCESSI_JWT_SECRET, // HS256: deriva la chiave access
    issuer: "accessi",
    audience: "backend-a",
  },
  introspection: {
    url: "https://accessi.example.com/api/accessi/auth/introspect",
    serviceToken: process.env.ACCESSI_SERVICE_TOKEN!,
  },
}));
```

**Esempio corretto — Guard Nest**

```ts
import { createAccessiAuthGuard } from 'emilsoftware-utilities/accessi/resource-server';

@UseGuards(createAccessiAuthGuard({
  jwt: { publicKey: process.env.ACCESSI_JWT_PUBLIC_KEY, algorithms: ["RS256"] },
  introspection: { url: process.env.ACCESSI_INTROSPECT_URL!, serviceToken: process.env.ACCESSI_SERVICE_TOKEN! },
  authorization: { requirements: [{ menuCode: "ORDINI", minPermissionLevel: 20 }] },
}))
@Get("ordini")
list(@Req() req: Request) { return req.user; }
```

| Campo | Obbligo | Note |
| --- | --- | --- |
| jwt.serverSecret | HS256 | Segreto grezzo Accessi; il resource server applica la KDF access. |
| jwt.publicKey / jwt.jwks | RS/ES | Consigliato in multi-servizio. JWKS ha cache e timeout. |
| jwt.issuer / jwt.audience | no | Consigliati per evitare token di altri ambienti. |
| introspection.url | se servono grant | Endpoint service-to-service protetto da service token. |
| introspection.serviceToken | se introspection | Scope richiesto: accessi:introspect. |
| authorization | no | Policy accessiRequirement; senza introspection i grant sono obbligatori. |

> [!WARNING]
> **Fail closed**
> Se introspection e configurata ma non raggiungibile, il resource server risponde 503. Non autorizza la richiesta.

> [!NOTE]
> **Introspection**
> POST /api/accessi/auth/introspect restituisce active=false per token invalido, scaduto o utente disabilitato. I risultati attivi sono cachati lato resource server per 30 secondi per default.

> [!NOTE]
> **JWKS**
> Con RS256/ES256 Accessi pubblica la JWKS su /accessi/.well-known/jwks.json (configurabile con jwtOptions.jwksPath). Il resource server puo usare jwks.url e ruotare le chiavi con previousPublicKeys.

> [!NOTE]
> **Revoca**
> revocation.store applica la revoca per utente; revocation.accessTokenStore rifiuta i singoli jti revocati e revocation.familyStore invalida le famiglie di refresh token revocate per riuso sospetto.

> [!NOTE]
> **Audit**
> I fallimenti di autenticazione del resource server, i blocchi edge, il riuso dei refresh token e le revoche di sessione producono eventi strutturati tramite auditAccessi; i token e i segreti vengono redatti dal Logger.

---

## Requisiti e livelli di abilitazione

_DSL accessiRequirement: permission, and, or, not, custom._

I requisiti si compongono con accessiRequirement. La forma storica requirements è un AND di permessi. Il livello è TipoAbilitazione: NESSUNA=0, LETTURA=10, SCRITTURA=20, SPECIAL=30; il confronto è tipoAbilitazione \>= soglia.

**Esempio corretto — Policy composte**

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

**Esempio da evitare — Configurazione non valida**

```ts
// Sbagliato: AND/OR senza figli -> errore di configurazione (500 AUTH_REQUIREMENTS_MISCONFIGURED)
const empty = r.and();
```

> [!WARNING]
> **custom senza handler**
> Un requisito custom la cui chiave non ha un handler produce 500 AUTH\_REQUIREMENTS\_MISCONFIGURED: è un errore di programmazione, non un 403.

---

## Login, refresh, 2FA e reset password

_Il flusso completo lato browser con accessi/client/public._

Il frontend non monta Accessi e non vede il database: chiama Accessi Service, conserva l'access token e lo invia ai backend come Bearer. Il client pubblico espone solo le operazioni sicure per il browser.

### Flusso di login

1. POST /api/accessi/auth/login con email e password.
2. Se la risposta contiene challenge e twoFactorRequired, il login non è completo: chiedi il codice e chiama verifyTwoFactor. Nessun JWT è stato emesso.
3. Se la risposta contiene token, conserva token.value, token.expiresIn (secondi) e, se presente, refreshToken.
4. Chiama i backend con Authorization: Bearer \<access-token\>.
5. Prima della scadenza, o dopo un 401 AUTH\_TOKEN\_INVALID, usa refreshAccessToken e riprova una sola volta.
6. Al logout chiama revokeToken per il token corrente oppure revokeSessions per tutte le sessioni.

**Login dal browser**

```ts
import { configureAccessiClient, login } from 'emilsoftware-utilities/accessi/client/public';

configureAccessiClient({ baseUrl: 'https://accessi.example.com' });

const response = await login({ email, password });
const result = response.data.Result;

if (result.challenge?.twoFactorRequired) {
  // Mostra il campo codice e chiama verifyTwoFactor({ challengeId, code })
  return { twoFactor: result.challenge };
}

if (!result.token) throw new Error('Login senza token: controlla la configurazione');
authStore.setAccessToken(result.token.value);
authStore.setRefreshToken(result.refreshToken?.value ?? null);
```

### Refresh e retry

**Refresh con un solo retry**

```ts
import { refreshAccessToken } from 'emilsoftware-utilities/accessi/client/public';

async function apiFetch(input: RequestInfo, init: RequestInit = {}) {
  const token = authStore.getAccessToken();
  const response = await fetch(input, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${token}` },
  });

  if (response.status !== 401) return response;

  const refreshToken = authStore.getRefreshToken();
  if (!refreshToken) throw new Error("Sessione scaduta");

  const refreshed = await refreshAccessToken({ refreshToken });
  authStore.setAccessToken(refreshed.data.Result.token.value);
  authStore.setRefreshToken(refreshed.data.Result.refreshToken?.value ?? null);

  // Un solo retry: se fallisce di nuovo, logout.
  return fetch(input, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${authStore.getAccessToken()}` },
  });
}
```

| Campo | Significato | Uso lato frontend |
| --- | --- | --- |
| Result.token.value | Access token JWT | Header Authorization verso i backend, mai nell URL |
| Result.token.expiresIn | Durata in secondi | Programma il refresh prima della scadenza |
| Result.refreshToken | Refresh token opzionale | Conservalo separato; non usarlo come Bearer |
| Result.challenge | Challenge 2FA | Chiedi il codice e completa il login |
| Result.passwordRequired | Passo password richiesto | Completa il flusso passwordless senza perdere la challenge |
| Result.utente / userGrants | Profilo e grant | UI, menu e messaggi di permesso |

### Errori da gestire

| HTTP / codice | Cosa fare |
| --- | --- |
| 401 AUTH\_TOKEN\_MISSING / AUTH\_TOKEN\_INVALID | Nessun token o token scaduto: refresh e, se fallisce, login |
| 401 AUTH\_USER\_DISABLED | Sessione non più valida: logout e messaggio dedicato |
| 403 AUTH\_INSUFFICIENT\_PERMISSIONS | Non fare logout: mostra permessi insufficienti e nascondi l azione |
| 403 AUTH\_CSRF\_INVALID | Cookie mode: rileggi il cookie CSRF e ripeti la richiesta |
| 429 | Rate limit: rispetta Retry-After e non ritentare in loop |
| 503 AUTH\_INTROSPECTION\_UNAVAILABLE / AUTH\_JWKS\_UNAVAILABLE | Servizio non raggiungibile: riprova con backoff, non cancellare la sessione |

### 2FA

La challenge 2FA è un identificativo opaco, non un JWT: non va usato come Bearer e non va salvato come sessione. verifyTwoFactor restituisce il login completo con token e refreshToken. resendTwoFactor rispetta resendAfterSeconds.

### Reset password

Il reset è un flusso pubblico in due passi: sendPasswordResetEmail invia il link, la pagina di reset arriva da Accessi oppure è custom, confirmResetPassword consuma il token monouso e imposta la nuova password. La nuova password deve rispettare la policy (minimo 8 caratteri, maiuscola, minuscola, cifra e carattere speciale). Dopo il reset le sessioni precedenti vengono revocate se sessionRevocation è configurato.

> [!CAUTION]
> **Mai nel browser**
> Non importare accessi/client/admin, non usare accessi/client/service e non inserire service token, encryptionKey o chiavi JWT nel bundle. Non mettere JWT o ticket console nell URL o nei log.

> [!NOTE]
> **Dove conservare il token**
> Con Bearer evita localStorage se puoi: memoria più refresh token in storage sicuro limita il danno di XSS. Se il browser non può proteggere il token, valuta la modalità cookie HttpOnly con CSRF descritta nella sezione successiva.

---

## Scegliere e configurare il client

_Client pubblico, admin e service: scope, configurazione globale e per istanza._

Il package espone client separati per scope. La scelta non è stilistica: un client troppo ampio porta nel bundle operazioni che il browser non deve poter chiamare.

| Client | Contenuto | Dove usarlo |
| --- | --- | --- |
| accessi/client/public | Login, refresh, 2FA, reset password, registrazione, ticket console | Frontend pubblico e SPA |
| accessi/client/admin | Utenti, ruoli, menu, filtri, provider SSO, schema, audit | Console e tool amministrativi interni |
| accessi/client/service | Service token e introspezione | Solo backend fratelli e job, mai browser |
| accessi/client | Client completo generato | Compatibilità e tool interni; non distribuirlo a frontend pubblici |
| accessi/contracts | Tipi, enum e helper puri | Bundle browser-safe senza Nest o database |

### Configurazione globale

**Client globale**

```ts
import { configureAccessiClient, login } from 'emilsoftware-utilities/accessi/client/public';

configureAccessiClient({ baseUrl: 'https://accessi.example.com' });
const response = await login({ email, password });

// Se il token cambia nel tempo, passa un provider invece del valore:
configureAccessiClient({
  baseUrl: 'https://accessi.example.com',
  getToken: () => authStore.getAccessToken(),
});
```

### Più Accessi Service o più tenant

**Client isolati per istanza**

```ts
import { createAccessiPublicClient } from 'emilsoftware-utilities/accessi/client/public';

const milano = createAccessiPublicClient({ baseUrl: 'https://accessi-milano.example.com' });
const roma = createAccessiPublicClient({ baseUrl: 'https://accessi-roma.example.com', token: tokenRoma });

const [utentiMilano, utentiRoma] = await Promise.all([milano.getUsers(), roma.getUsers()]);
```

Le istanze create con createAccessiPublicClient, createAccessiAdminClient e createAccessiServiceClient non condividono base URL né token: sono sicure anche con richieste concorrenti. configureAccessiClient resta il default globale per le funzioni esportate direttamente.

### Link alla console

**Apertura console**

```ts
import { buildAccessiConsoleUrl } from 'emilsoftware-utilities/accessi/console';

const url = buildAccessiConsoleUrl('https://accessi.example.com', { entryTicket: ticket });
window.location.assign(url);
```

> [!WARNING]
> **Ticket, non JWT**
> Il ticket console è monouso e dura 60 secondi. Non passare il JWT nell URL: buildAccessiConsoleUrl mette il ticket nel fragment e non nel query string.

> [!NOTE]
> **Tipi condivisi**
> Tutti gli scope condividono gli stessi tipi generati dall OpenAPI. Se aggiorni il contratto, rigenera il client con npm run generate:accessi-client e verifica con npm run check:accessi-openapi.

---

## Modalità cookie HttpOnly e CSRF

_Quando usare i cookie invece del Bearer e come configurare il browser._

Bearer resta il default. La modalità cookie serve quando il browser non può custodire un access token in memoria in modo sicuro: Accessi invia access e refresh token in cookie HttpOnly e il browser non li legge da JavaScript.

**Abilitazione lato server**

```ts
const accessiOptions: AccessiOptions = {
  // ...
  authCookie: {
    enabled: true,
    secure: true,
    sameSite: 'lax',
  },
};
```

**Login e richiesta con cookie**

```ts
const response = await fetch('https://accessi.example.com/api/accessi/auth/login', {
  method: 'POST',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});

// Sulle richieste che modificano stato invia il token CSRF double-submit:
const csrf = document.cookie.split('; ').find((c) => c.startsWith('accessi_csrf='))?.split('=')[1];
await fetch('/api/ordini', {
  method: 'POST',
  credentials: 'include',
  headers: {
    'Content-Type': 'application/json',
    'x-csrf-token': csrf ?? '',
  },
  body: JSON.stringify(payload),
});
```

- Il login non restituisce più i token nel body, salvo exposeTokens: true.
- Il refresh avviene dal cookie: POST /api/accessi/auth/refresh può essere chiamato con body vuoto.
- Le richieste non sicure richiedono x-csrf-token; token mancante o diverso produce 403 AUTH\_CSRF\_INVALID.
- CORS deve avere credentials: true e un origin esplicito, mai wildcard.
- La revoca cancella i cookie; logout e revoke-sessions restano gli stessi endpoint.

> [!CAUTION]
> **CSRF obbligatorio**
> Non disabilitare CSRF (csrf: off) se non hai un altra protezione equivalente davanti al servizio. Senza CSRF, un sito ostile può inviare richieste autenticate per conto dell utente.

> [!NOTE]
> **Convivenza con Bearer**
> Il resource server continua a leggere l header Authorization. In cookie mode il middleware Accessi copia il cookie nell header interno, quindi guard e policy esistenti non cambiano.

---

## Utenti

_Creazione, aggiornamento, stati e GDPR._

### Stati di registrazione (STAREG)

| Valore | Nome | Effetto sul login |
| --- | --- | --- |
| 0 | NULL | Non confermato |
| 5 | INSERT | Non confermato |
| 10 | INVIO | Richiede il rinnovo della password |
| 20 | CONF | Valido |
| 50 | DELETE | Bloccato (soft delete) |
| 99 | BLOCC | Bloccato |

### Endpoint principali (superutente salvo diversamente indicato)

| Metodo | Percorso | Descrizione |
| --- | --- | --- |
| GET | /api/accessi/user/get-users | Elenco con paginazione (limit e offset, header X-Total-Count). |
| POST | /api/accessi/user/create-managed-user | Crea un utente locale e invia il reset password. |
| PUT | /api/accessi/user/update-user/:codiceUtente | Aggiorna profilo e policy (campi privilegiati solo superutente). |
| DELETE | /api/accessi/user/delete-user/:codiceUtente | Soft delete: STAREG=DELETE. Admin o superutente. |
| DELETE | /api/accessi/user/delete-user-permanent/:codiceUtente | Eliminazione definitiva: rimuove utente e record collegati. Solo admin. |
| POST | /api/accessi/user/set-password/:codiceUtente | Imposta direttamente la password: hash lato backend e scadenza secondo policy, nessuna email. |
| POST | /api/accessi/user/set-stato | Imposta lo stato di registrazione. |
| PATCH | /api/accessi/user/set-gdpr/:codiceUtente | Registra il consenso GDPR. |
| POST | /api/accessi/user/register | Registrazione pubblica, solo se publicRegistration.enabled. |

> [!WARNING]
> **Eliminazione: soft o definitiva**
> Il soft delete (STAREG=DELETE) è disponibile per admin e superutenti ed è reversibile. L'eliminazione definitiva rimuove utente e record collegati in transazione ed è riservata agli admin; il superutente senza flag Admin può solo flaggare l'utente come eliminato. Se l'utente ha dati collegati in altre tabelle (per esempio campi estesi del backend) l'eliminazione definitiva fallisce con code ACCESSI\_USER\_DELETE\_HAS\_REFERENCES e messaggio esplicito: usa allora il soft delete.

> [!TIP]
> **Creazione con invito atomica**
> La creazione utente con invio email è atomica: se SMTP non è configurato si fallisce prima di scrivere, e se l'invio fallisce l'utente creato viene annullato (codice ACCESSI\_USER\_INVITE\_EMAIL\_FAILED). Non restano utenti senza password. In alternativa un admin crea l'utente e imposta la password dal form dedicato.

> [!TIP]
> **Admin: controllo completo del profilo**
> Dalla scheda utente un admin modifica tutti i campi Accessi: anagrafica, cellulare, lingua, avatar, pagina di default, metadata JSON, 2FA/passwordless/login con password, flag, GDPR, stato registrazione e scadenza password. La password si imposta direttamente con set-password. Le scritture sono idempotenti (UPDATE OR INSERT su UTENTI\_CONFIG) e verificate dal backend; non serve accedere al database.

> [!NOTE]
> **Consenso GDPR**
> Il pulsante "Registra consenso GDPR" completa il processo: imposta FLGGDPR e DATGDPR e scrive la riga storica in UTENTI\_GDPR (endpoint set-gdpr). Anche impostare flagGdpr via update-user completa il processo con la stessa riga storica.

**Esempio corretto — Creazione di un utente gestito**

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

**Esempio da evitare — Privilegi dal client**

```ts
// Sbagliato: inviare flag privilegiati dal frontend pubblico
fetch("/api/accessi/user/register", {
  method: "POST",
  body: JSON.stringify({ email, flagSuper: true }), // ignorato o negato
});
```

> [!NOTE]
> **Campi di dominio**
> UTENTI\_CONFIG contiene i campi di dominio Accessi: FLGSUPER, FLGADMIN, FLG2FATT (2FA), FLGPWDLESS (passwordless), FLGPASSWORD (login locale), CODLINGUA, CELLULARE, PAGDEF (pagina di default) e JSON\_METADATA. I flag/colonne applicativi (FLGMOP, FLGPIANA, FLGADDETTI, FLGOSPITI, FLGPIANARFID, FLGCONTA, FLGCUBI, FLGCICLPASS, FLGDIPENDENTI, FLGINVENTARI, CAUMOV, NUMMAC, RAGSOCCLI, ENABLEIA, CELLUTE e NOMECAMPO) sono stati rimossi: i backend devono gestirli in tabelle proprie. Il telefono canonico e UTENTI\_CONFIG.CELLULARE.

> [!NOTE]
> **Autorizzazioni**
> I gruppi/menu si abilitano tramite ABILITAZIONI, RUOLI\_MNU e UTENTI\_RUOLI. Il vecchio meccanismo NOMECAMPO (flag applicativo su UTENTI\_CONFIG) e stato rimosso.

> [!NOTE]
> **Campi estesi**
> extensionFieldsOptions allega colonne di tabelle applicative al profilo (per esempio la ragione sociale). Le colonne sono in whitelist: non costruirle mai da input HTTP.

---

## Ruoli e permessi

_Assegnazioni sostitutive e composizione dei grant._

I ruoli contengono una lista di menu con livello. Le assegnazioni (ruoli e permessi diretti) sono SOSTITUTIVE: invia sempre la lista completa desiderata. I grant effettivi sommano ruoli e permessi diretti prendendo il livello massimo per menu; un livello 0 non annulla un grant del ruolo. I superutenti ricevono tutti i menu attivi al livello massimo.

| Metodo | Percorso | Descrizione |
| --- | --- | --- |
| GET | /api/accessi/permission/roles | Ruoli con i menu associati. |
| POST | /api/accessi/permission/create-role | Crea un ruolo (i menu sono obbligatori). |
| PUT | /api/accessi/permission/update-role/:codiceRuolo | Aggiorna un ruolo (menu sostitutivi). |
| DELETE | /api/accessi/permission/delete-role/:codiceRuolo | Elimina ruolo, mapping e assegnazioni. |
| POST | /api/accessi/permission/assign-roles/:codiceUtente | Sostituisce i ruoli dell'utente. |
| POST | /api/accessi/permission/assign-permissions/:codiceUtente | Sostituisce i permessi diretti. |
| GET | /api/accessi/permission/grants/:codiceUtente | Grant effettivi, permessi diretti e ruoli. |

**Esempio corretto — Creazione di un ruolo e assegnazione**

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

**Esempio da evitare — Assegnazione non additiva**

```ts
// Sbagliato: pensare che l'assegnazione sia incrementale
await assignRolesToUser(codiceUtente, { roles: [3] });
// ora l'utente ha SOLO il ruolo 3, non 3 più quelli di prima
```

> [!WARNING]
> **Menu obbligatori**
> create-role e update-role rifiutano un ruolo senza menu. Se ti serve un ruolo senza accessi, non crearlo.

---

## Menu, gruppi e tipi menu

_Catalogo di navigazione e CRUD completo (superutente)._

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
| POST/PUT/DELETE | /api/accessi/permission/menu-types\[/:codiceTipo\] | CRUD dei tipi menu. |

I codici (CODMNU, CODGRP, CODTIP) sono chiavi immutabili: si indicano in creazione e poi si passano nel percorso. Un gruppo o un tipo si elimina solo se non è referenziato.

**Esempio corretto — Catalogo in ordine**

```ts
await createMenuGroup({ codiceGruppo: 'A', descrizioneGruppo: 'Amministrazione', ordineGruppo: 1, enabled: true });
await createMenuType({ codiceTipo: 'X', descrizioneTipo: 'Operativo' });
await createMenu({ codiceMenu: 'ORDINI', descrizioneMenu: 'Ordini', codiceGruppo: 'A', tipo: 'X', ordineMenu: 10, enabled: true });
```

**Esempio da evitare — Vincoli di integrità**

```ts
// Sbagliato: eliminare un gruppo che contiene menu -> 400 con spiegazione
await deleteMenuGroup('A'); // contiene N menu
```

---

## SSO generico (federated authentication)

_Il backend valida il provider, Accessi gestisce identità e sessioni._

Accessi non valida i token Azure, Google o SAML: è il TUO backend a validare il flusso SSO e a passare solo \{ provider, subject \} verificati a FederatedAuthService. Così issuer, secret e token restano fuori dal modulo.

**Esempio corretto — Login SSO**

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

> [!NOTE]
> **Scambio service-to-service**
> Se il backend fratello valida il provider SSO, può scambiare \{ provider, subject \} con POST /api/accessi/federated-auth/exchange usando un service token con scope accessi:federated:exchange. Accessi non riceve il token del provider.

### API amministrative (superutente)

- GET/POST /api/accessi/federated-auth/providers, PATCH/DELETE providers/:provider
- GET/POST /api/accessi/federated-auth/users/:codiceUtente/identities
- POST /api/accessi/federated-auth/users (crea un utente SSO-only)
- PATCH /api/accessi/federated-auth/users/:codiceUtente/password-login

**Esempio da evitare — Non fidarti dell'input**

```ts
// Sbagliato: far validare il token del provider ad Accessi o fidarsi del frontend
await federatedAuthService.authenticate({ provider, subject: req.body.email }); // subject non verificato
```

> [!WARNING]
> **Provider in uso**
> Un provider si elimina solo se nessuna identità è collegata; altrimenti disabilitalo. La chiave del provider deve coincidere con la configurazione del backend.

---

## Token macchina-a-macchina

_Autenticazione tecnica con scope: non è un superutente._

Formato: st\_\<id\>.\<segreto\> (segreto da 256 bit). Nel database si salva solo lo SHA-256 del segreto; il segreto è mostrato una sola volta. La verifica restituisce \{ tokenId, label, scopes \}: nessun ruolo o grant.

> [!CAUTION]
> **Non è un superutente**
> Un service token non apre le API Accessi: abilita solo le rotte della tua app che proteggi con ServiceTokenGuard.

> [!NOTE]
> **Introspection**
> Per un backend fratello creare un service token con scope accessi:introspect e usarlo in POST /api/accessi/auth/introspect. Il resource server lo configura in introspection.serviceToken.

> [!WARNING]
> **Rate limit condiviso**
> In cluster configurare serviceTokens.rateLimitStore e publicAuthRateLimit.store con createRedisRateLimitStore: i contatori in memoria valgono solo per singola istanza.

> [!NOTE]
> **Edge rate limit**
> Per una soglia grossolana per IP configurare edgeRateLimit: viene applicata davanti alle rotte Accessi. Il gateway/API gateway resta comunque consigliato per bot protection e limiti di connessione.

**Esempio corretto — Rotta tecnica protetta**

```ts
import { ServiceTokenGuard, RequireServiceTokenScopes } from 'emilsoftware-utilities';

@UseGuards(ServiceTokenGuard)
@RequireServiceTokenScopes('ia')
@Post("internal/ask")
ask() { /* req.accessiServiceToken = { tokenId, label, scopes } */ }
```

### Gestione (superutente)

- POST /api/accessi/service-token (label, scopes, expiresAt o ttlDays) -\> segreto mostrato una volta
- GET /api/accessi/service-token?includeRevoked=true
- DELETE /api/accessi/service-token/:tokenId (revoca immediata)
- POST /api/accessi/service-token/:tokenId/rotate

**Esempio da evitare — Non è un utente**

```ts
// Sbagliato: usare un service token per autenticare un utente umano
fetch('/api/profilo', { headers: { Authorization: 'Bearer ' + serviceToken } }); // req.user assente
```

> [!WARNING]
> **Scadenza**
> Senza expiresAt né defaultTtlDays il token non scade: imposta serviceTokens.defaultTtlDays o una scadenza esplicita.

---

## Console amministrativa

_Accesso, sezioni e che cosa si può fare._

La console è servita dal modulo su /api/accessi/console. Non ha stato proprio: ogni azione chiama le API protette con il JWT dell'utente connesso.

- Utenti: elenco, creazione locale o SSO, profilo, ruoli, grant diretti, stato, 2FA e Login as.
- Ruoli e grant: CRUD dei ruoli con l'albero delle abilitazioni.
- Menu e gruppi: CRUD di gruppi, menu e tipi menu.
- Token di servizio: creazione, rotazione, revoca.
- SSO: provider e identità.
- Wiki e Changelog: documentazione e novità della libreria.
- SQL: esporta il DDL delle entità Accessi (tabelle, generatori, FK, indici, check, trigger) per replicare il database.

> [!NOTE]
> **Superutente (FLGSUPER)**
> Riceve TUTTE le abilitazioni al livello massimo (30) dopo il login. In console vede solo la sezione Utenti e gestisce utenti, ruoli e grant.

> [!NOTE]
> **Admin (FLGADMIN)**
> Accede a tutta la console (catalogo, token, SSO, utenti) ma NON conferisce abilitazioni: i menu restano quelli assegnati via ABILITAZIONI/RUOLI\_MNU. Gerarchia: ADMIN \> SUPER \> utente.

> [!NOTE]
> **Gerarchia dei ruoli**
> Vale ADMIN (2) \> SUPER (1) \> utente comune (0). Un attore può gestire solo utenti di rango pari o inferiore: un superutente può amministrare totalmente utenti comuni e superutenti (profilo, password, flag, ruoli, grant, stato, eliminazione e identità/utenti SSO) ma NON può toccare un admin. Un admin può gestire chiunque. La regola è imposta dal backend (ensureCanManageTargetUser): un tentativo non consentito restituisce 403.

> [!NOTE]
> **Gestione dei flag**
> Dalla scheda utente i flag sono mostrati in base al ruolo di chi è connesso: un admin può assegnare o togliere sia il flag Admin sia il flag Superutente; un superutente senza flag Admin può gestire solo il flag Superutente. I flag si impostano anche in creazione (utente locale o SSO).

> [!WARNING]
> **Ultimo admin**
> Per non restare chiusi fuori dalla console, l'ultimo admin attivo non può essere disattivato, bloccato, eliminato né privato del flag Admin: l'operazione restituisce 400 finché non viene promosso un altro admin.

> [!NOTE]
> **Accesso**
> Apri /api/accessi/console e accedi con un utente con FLGSUPER o FLGADMIN. Le sezioni sono raggiungibili anche tramite deep link (per esempio /api/accessi/console/menu-e-gruppi/menu).

> [!NOTE]
> **Bootstrap admin**
> Con adminBootstrap.enabled il backend stampa a ogni avvio un token casuale (monouso, valido fino al riavvio). La sezione "Crea utente admin" nella schermata di login compare solo quando adminBootstrap è abilitato (stato esposto da GET /api/accessi/auth/bootstrap-admin/status): incolla il token e crea il primo admin senza email di conferma. La password è opzionale: se assente viene generata e mostrata una sola volta.

> [!TIP]
> **Auto-ingresso dal frontend**
> Se un frontend ha già una sessione Accessi valida e l'utente è abilitato alla console, può aprire la console senza rifare il login: \`POST /api/accessi/console/entry\` con \`Authorization: Bearer \<jwt\>\` restituisce un ticket monouso; apri poi \`/api/accessi/console\#entry=\<ticket\>\`. Il JWT non finisce mai nell'URL; il ticket dura 60 secondi ed è utilizzabile una sola volta (endpoint di scambio protetto da rate limit).

> [!NOTE]
> **Console centralizzata**
> In una topologia multi-backend la console va ospitata una sola volta su Accessi Service. Gli altri backend possono linkarla con \`buildAccessiConsoleUrl\` di \`accessi/console\` oppure proxare \`/api/accessi/\*\` sullo stesso dominio. Non copiare gli asset della console in ogni applicazione.

> [!WARNING]
> **Ticket multi-istanza**
> I ticket di ingresso console sono in memoria per default. Con piu istanze configurare \`consoleEntry.store\` con \`createRedisConsoleEntryStore\`: il JWT viene cifrato e il consume e atomico.

---

## Login as (accesso temporaneo)

_Superutenti e admin possono generare un URL per entrare in un applicazione come un altro utente._

Dalla lista utenti della console il pulsante Login as apre il pannello dedicato: inserisci l'URL dell'applicazione e premi "Genera URL di accesso". Accessi emette un JWT per l'utente target e lo allega all'URL come query parameter \`loginAsToken\`.

**Richiesta**

```http
POST /api/accessi/user/login-as/:codiceUtente
Content-Type: application/json
Authorization: Bearer <jwt amministratore>

{ "url": "https://app.example.com/dashboard" }
```

**Risposta**

```json
{
  "Result": {
    "loginUrl": "https://app.example.com/dashboard?loginAsToken=eyJ...",
    "token": "eyJ...",
    "expiresInSeconds": 86400,
    "expiresAt": "2026-10-24T14:05:00.000Z"
  }
}
```

> [!CAUTION]
> **La durata è quella standard**
> Il token dura quanto la sessione Accessi standard (jwtOptions.expiresIn). È una credenziale: chiunque abbia l'URL può usarlo fino alla scadenza per entrare nell'applicazione come l'utente target. Non condividerlo, non salvarlo in log o documenti e non usarlo in produzione per operazioni distruttive.

> [!NOTE]
> **Chi può generarlo**
> Solo utenti con FLGSUPER o FLGADMIN. Vale la stessa gerarchia della gestione utenti: un superutente non può impersonare un admin; un admin può impersonare chiunque. Il tentativo non consentito restituisce 403.

> [!WARNING]
> **Responsabilità dell applicazione**
> Accessi non controlla l'URL di destinazione né consuma il token al posto dell'applicazione. L'app deve leggere \`loginAsToken\`, validarlo (per esempio con \`POST /api/accessi/auth/get-user-by-token\` o \`authorizeAccessi\`) e decidere cosa consentire. Il token è un access token Accessi a tutti gli effetti, con claim \`loginAs: true\`, \`amr: \["login\_as"\]\` e \`act\` valorizzato con l'attore.

Il token viene emesso anche per utenti con 2FA attiva: l'attore ha già completato l'autenticazione amministrativa. Non usare questa funzione per aggirare la 2FA di un utente comune al di fuori di un intervento amministrativo autorizzato.

---

## Deploy del servizio

_Servizio standalone, variabili d ambiente, migrazioni e rollout senza downtime._

Accessi Service è un processo Node che possiede database, migrazioni, SMTP, chiavi JWT e console. In produzione va eseguito come servizio gestito (systemd, container o supervisor) e protetto da TLS.

**Avvio standalone**

```ts
import { startAccessiService } from 'emilsoftware-utilities/accessi/server';

await startAccessiService({
  port: Number(process.env.PORT ?? 3000),
  healthPath: "/health",
  metrics: true,
});
```

### Variabili principali

| Gruppo | Variabili | Note |
| --- | --- | --- |
| Database | ACCESSI\_DB\_HOST, ACCESSI\_DB\_PORT, ACCESSI\_DB\_DATABASE, ACCESSI\_DB\_USER, ACCESSI\_DB\_PASSWORD | Firebird 2.5 o successivo |
| Sicurezza | ACCESSI\_ENCRYPTION\_KEY, ACCESSI\_JWT\_SECRET | Obbligatorie; mai nel repository |
| JWT | ACCESSI\_JWT\_ALGORITHM, ACCESSI\_JWT\_PRIVATE\_KEY, ACCESSI\_JWT\_PUBLIC\_KEY, ACCESSI\_JWT\_KEY\_ID, ACCESSI\_JWKS\_PATH, ACCESSI\_JWT\_PREVIOUS\_PUBLIC\_KEYS | RS/ES consigliato in multi-servizio |
| Token | ACCESSI\_JWT\_ISSUER, ACCESSI\_JWT\_AUDIENCE, ACCESSI\_JWT\_EXPIRES, ACCESSI\_JWT\_REFRESH\_EXPIRES | Issuer e audience espliciti per ambiente |
| Email | ACCESSI\_EMAIL\_HOST, ACCESSI\_EMAIL\_PORT, ACCESSI\_EMAIL\_USER, ACCESSI\_EMAIL\_PASSWORD, ACCESSI\_EMAIL\_FROM | SMTP obbligatorio per reset, 2FA e inviti |
| URL | ACCESSI\_PUBLIC\_BASE\_URL, ACCESSI\_CONFIRMATION\_EMAIL\_URL, ACCESSI\_CONFIRMATION\_RETURN\_EMAIL\_URL, ACCESSI\_CONSOLE\_API\_BASE\_URL | Link nelle email e console su dominio separato |
| Console | ACCESSI\_CONSOLE\_ENTRY\_TTL\_MS, ACCESSI\_CONSOLE\_ENTRY\_KEY | Ticket monouso; store Redis in multi-istanza |
| Migrazioni | ACCESSI\_AUTO\_UPDATE\_DATABASE, ACCESSI\_LEGACY\_PASSWORD\_MIGRATION, ACCESSI\_SYSTEM\_SEEDS\_ENABLED, ACCESSI\_ADMIN\_BOOTSTRAP\_ENABLED | false su auto-update per le repliche dopo la migrazione |
| Cookie | ACCESSI\_AUTH\_COOKIE\_ENABLED, \_SECURE, \_SAME\_SITE, \_DOMAIN, \_CSRF | Bearer resta il default; abilitare solo se serve HttpOnly |
| Osservabilità | ACCESSI\_METRICS\_\*, ACCESSI\_AUDIT\_\* | Metriche e audit; store e sink restano oggetti runtime |
| Feature e tenant | ACCESSI\_TENANT\_ID, ACCESSI\_PUBLIC\_REGISTRATION\_ENABLED, ACCESSI\_FEDERATED\_\*, ACCESSI\_SERVICE\_TOKENS\_\* | Registrazione e SSO sono opt-in |
| HTTP e proxy | ACCESSI\_HTTP\_TRUST\_PROXY, ACCESSI\_CORS\_ORIGINS, ACCESSI\_CORS\_CREDENTIALS, ACCESSI\_SECURITY\_HEADERS | trust proxy corretto per rate limit e audit |
| Rate limit | ACCESSI\_PUBLIC\_RATE\_LIMIT\_\*, ACCESSI\_EDGE\_RATE\_LIMIT\_\* | Finestra e tentativi dello stesso scope vanno configurati insieme |

### Rollout sicuro

1. Costruisci l artefatto e valida la configurazione prima del deploy: assertValidAccessiOptions blocca gli errori evidenti.
2. Esegui la migrazione dello schema con un solo processo (autoUpdateDatabase: true oppure npm run db:update:accessi).
3. Avvia le repliche con autoUpdateDatabase: false: verificano lo schema in sola lettura e non eseguono DDL concorrenti.
4. Attendi /health/ready prima di inviare traffico dal load balancer.
5. Ruota una replica alla volta; il servizio gestisce SIGTERM/SIGINT e chiude Nest e i pool Firebird.
6. Dopo il rollout verifica login, una rotta protetta, introspection e console.

**systemd minimale**

```ini
[Unit]
Description=Accessi Service
After=network.target

[Service]
WorkingDirectory=/opt/accessi-service
EnvironmentFile=/etc/accessi/accessi.env
ExecStart=/usr/bin/node dist/scripts/startAccessiService.js
Restart=on-failure
RestartSec=5
KillSignal=SIGTERM
TimeoutStopSec=15

[Install]
WantedBy=multi-user.target
```

Template pronti per multi-tenant, Docker, Nginx e Traefik sono in deploy/: systemd/accessi-tenant@.service, systemd/tenant.secrets.example, docker/docker-compose.yml, nginx/accessi-tenants.conf e traefik/dynamic.yml. Non contengono segreti e vanno adattati.

> [!WARNING]
> **Migrazioni**
> Non eseguire DDL concorrenti con più repliche o con traffico applicativo. Migra prima del rollout e lascia autoUpdateDatabase: false sulle repliche. Fai un backup e collauda su una copia rappresentativa.

> [!WARNING]
> **Proxy**
> Imposta http.trustProxy sul numero esatto di proxy davanti al servizio (1 per Nginx/Traefik/ALB, 2 con Cloudflare più ingress). Un valore sbagliato rende rate limit e audit aggirabili tramite header.

> [!NOTE]
> **Dettagli**
> Procedura completa in docs/standalone-service.md, deploy/README.md e docs/proxy-ip.md.

---

## Store condivisi e multi-istanza

_Quali store devono stare su Redis e che cosa succede se Redis non risponde._

Con una sola istanza gli store in memoria bastano. Con più repliche o più tenant gli store devono essere condivisi, altrimenti ticket, revoche e rate limit divergono tra processi.

| Store | Opzione | Serve per | Se manca in multi-istanza |
| --- | --- | --- | --- |
| Rate limit pubblico | publicAuthRateLimit.store | Login, reset, 2FA, refresh, console entry | Contatori separati per istanza: il limite effettivo si moltiplica |
| Rate limit service token | serviceTokens.rateLimitStore | Protezione API tecniche | Lo stesso token può superare il limite su istanze diverse |
| Ticket console | consoleEntry.store | Ingresso console monouso | Il ticket emesso da una istanza non vale su un altra |
| Revoca sessioni | sessionRevocation.store | Logout globale e cambio password | La revoca vale solo nel processo che la esegue |
| Revoca access token | accessTokenRevocation.store | Logout del singolo jti | Il token revocato resta valido altrove |
| Rotazione refresh | refreshTokenRotation.store | Refresh monouso e riuso sospetto | Due refresh concorrenti possono riuscire entrambi |
| Audit | audit.store o audit.sinks | Record interrogabili e retention | Solo log locale, nessuna query admin |

**Store condivisi**

```ts
import {
  createRedisRateLimitStore,
  createRedisConsoleEntryStore,
  createRedisSessionRevocationStore,
  createRedisAccessTokenRevocationStore,
  createRedisRefreshTokenRotationStore,
} from 'emilsoftware-utilities/accessi/server';

const rateLimitStore = createRedisRateLimitStore({ client: redis, keyPrefix: "accessi:rate:" });

const options: AccessiServerOptions = {
  // ...
  publicAuthRateLimit: { store: rateLimitStore },
  serviceTokens: { enabled: true, rateLimitStore },
  consoleEntry: { store: createRedisConsoleEntryStore({ client: redis, encryptionKey }) },
  sessionRevocation: { store: createRedisSessionRevocationStore({ client: redis, ttlMs }) },
  accessTokenRevocation: { store: createRedisAccessTokenRevocationStore({ client: redis }) },
  refreshTokenRotation: { store: createRedisRefreshTokenRotationStore({ client: redis }) },
};
```

### Multi-tenant

**Prefissi automatici per tenant**

```ts
import { createAccessiTenantStores } from 'emilsoftware-utilities/accessi/server';

const stores = createAccessiTenantStores({ tenantId: 'acme', client: redis });
// rateLimit, consoleEntry, sessionRevocation, accessTokenRevocation,
// refreshTokenRotation e serviceTokenRateLimit hanno già il prefisso del tenant.
```

- Non comporre i prefissi a mano: usa createAccessiTenantStores o getAccessiTenantRedisPrefix.
- Ogni tenant deve avere chiavi JWT, issuer, audience e encryptionKey propri.
- healthCheck() degli store partecipa a /health/ready: uno store irraggiungibile rende il servizio non pronto.
- Se Redis non è raggiungibile i controlli falliscono chiusi: l endpoint risponde con errore e non autorizza.

> [!WARNING]
> **Fail closed**
> Redis non disponibile non significa limiti disattivati. Significa che le operazioni protette da store condiviso rispondono con errore (spesso 503) finché lo store non torna disponibile.

> [!NOTE]
> **Test**
> I test di integrazione Redis sono opt-in con ACCESSI\_TEST\_REDIS\_URL; carico e concorrenza sono in docs/redis-load-testing.md.

---

## Hardening e checklist di sicurezza

_Le impostazioni che non vanno lasciate al caso in produzione._

Accessi concentra identità, password, token e chiavi: la configurazione di sicurezza non è opzionale. Questa checklist vale per qualsiasi topologia.

1. Database Accessi raggiungibile solo da Accessi Service: nessun backend fratello ha credenziali del DB.
2. Con NODE\_ENV=production il servizio rifiuta JWT secret ed encryptionKey mancanti o uguali ai default locali.
3. encryptionKey, SMTP, chiavi JWT private e token di bootstrap vivono in un secret manager, mai nel repository o nei file tenant versionati.
4. In multi-servizio usa RS256 o ES256 con JWKS; HS256 con segreto condiviso solo come transizione.
5. Imposta issuer e audience espliciti e diversi per ambiente: un token di staging non deve valere in produzione.
6. Configura http.trustProxy con il numero esatto di proxy e non fidarti di header tenant o IP inviati dal client.
7. CORS con origin espliciti: credentials: true solo se usi cookie e mai insieme a wildcard.
8. Tieni attivi securityHeaders e CSP; se usi cookie, abilita CSRF double-submit e SameSite adeguato.
9. Configura rate limit pubblico, service token ed edge rate limit; in multi-istanza usa store Redis.
10. Service token con lo scope minimo (accessi:introspect, accessi:federated:exchange) e rotazione periodica; mai nel browser.
11. Configura sessionRevocation, accessTokenRevocation e refreshTokenRotation: cambio password, disabilitazione e riuso devono invalidare le sessioni.
12. Configura audit con retention e sink interrogabile; token, ticket, password e chiavi non devono finire nei log.
13. Backup del database e test di ripristino; migrazioni collaudate su copia prima del rollout.

| Rischio | Contromisura principale |
| --- | --- |
| Token di un altro ambiente | issuer e audience obbligatori, chiavi diverse per ambiente |
| Furto di un access token | scadenza breve, revoca per jti, session revocation store condiviso |
| Riuso di un refresh token | refresh rotation con store Redis e revoca della famiglia |
| Rate limit aggirato | trustProxy corretto, edge rate limit, store condiviso |
| XSS che ruba token | cookie HttpOnly con CSRF oppure token in memoria e CSP rigorosa |
| CSRF su cookie mode | double-submit token e SameSite; mai csrf off senza protezione esterna |
| Privilegi eccessivi | service token con scope minimo, gerarchia ADMIN \> SUPER, ultimo admin protetto |
| Dati o token tra tenant | un processo e un DB per tenant, chiavi e prefissi Redis separati |
| Perdita di audit | sink persistente, retention, export e alert su error rate |

> [!CAUTION]
> **Mai nel browser**
> Non esporre accessi/client/admin o accessi/client/service a un frontend pubblico e non inserire service token, chiavi private o encryptionKey nel bundle.

> [!NOTE]
> **Dettagli**
> CSP e header in docs/security-headers.md, cookie e CSRF in docs/auth-cookies.md, rotazione chiavi in docs/jwt-key-rotation.md, proxy in docs/proxy-ip.md e gateway in docs/gateway-rate-limit.md.

---

## Health, metriche e audit

_Come capire se Accessi sta funzionando e che cosa monitorare._

Il servizio standalone espone health e metriche; un host Nest/Express può montare gli stessi controlli con createAccessiHealthModule e renderAccessiMetrics.

| Endpoint | Significato | Uso |
| --- | --- | --- |
| GET /health/live | Processo vivo | Liveness probe; non controlla il database |
| GET /health/ready | Bootstrap, DB, schema e store pronti | Readiness probe del load balancer |
| GET /health/metrics | Metriche Prometheus | Scrape periodico, protetto in rete interna |

**Health in un host Nest**

```ts
import { createAccessiHealthModule } from 'emilsoftware-utilities/accessi/server';

@Module({
  imports: [
    AccessiModule.forRoot(accessiOptions),
    createAccessiHealthModule({
      accessiOptions,
      path: "/health",
      readinessChecks: [{ name: "coda", check: async () => queue.isReady() }],
    }),
  ],
})
export class AppModule {}
```

### Metriche di dominio

- Login riusciti e falliti, 2FA, refresh token e riuso.
- Blocchi di rate limit pubblico, edge e service token.
- Introspection, JWKS, revoche sessioni e ticket console.
- Errori degli store Redis e durata delle operazioni.

### Audit

- Login, logout, revoche, cambio password, 2FA, rate limit e rotazione chiavi producono eventi strutturati.
- I campi sensibili vengono redatti dal Logger; non aggiungere token o segreti nei metadati.
- Con un sink interrogabile gli admin usano GET /api/accessi/audit e /audit/export con retention configurabile.
- Senza sink interrogabile gli endpoint rispondono 501 ACCESSI\_AUDIT\_STORE\_DISABLED, ma il log continua.

> [!TIP]
> **Alert suggeriti**
> Error rate 5xx sopra soglia, readiness rossa, errori Redis, aumento di login falliti o 429, kid JWKS sconosciuto, riuso refresh token e audit non raggiungibile.

> [!NOTE]
> **Dettagli**
> Metriche e alert in docs/metrics.md; audit, retention ed export in docs/audit.md.

---

## Multi-tenancy operativa

_Un database e un processo per tenant, con configurazione validata e hot reload._

La multi-tenancy di Accessi isola i tenant a livello di processo e database: non esiste una colonna tenant nelle tabelle Accessi. Ogni tenant ha configurazione, chiavi e store propri.

**tenants/acme.environment.ts**

```ts
import { defineAccessiTenantEnvironment } from 'emilsoftware-utilities/accessi/server';

export default defineAccessiTenantEnvironment({
  tenant: { id: 'acme', hosts: ['accessi.acme.example.com'], port: 3201, enabled: true },
  database: {
    host: process.env.ACME_DB_HOST!,
    port: 3050,
    database: process.env.ACME_DB_DATABASE!,
    user: process.env.ACME_DB_USER!,
    password: process.env.ACME_DB_PASSWORD!,
  },
  jwt: {
    algorithm: 'RS256',
    secret: process.env.ACME_JWT_SECRET!,
    privateKey: process.env.ACME_JWT_PRIVATE_KEY!,
    publicKey: process.env.ACME_JWT_PUBLIC_KEY!,
    issuer: 'https://accessi.acme.example.com',
    audience: 'accessi-api',
  },
  encryptionKey: process.env.ACME_ENCRYPTION_KEY!,
  confirmationEmailUrl: 'https://accessi.acme.example.com',
  confirmationEmailReturnUrl: 'https://accessi.acme.example.com',
  email: {
    host: process.env.ACME_SMTP_HOST!,
    port: 587,
    from: 'noreply@acme.example.com',
    auth: {
      user: process.env.ACME_SMTP_USER!,
      pass: process.env.ACME_SMTP_PASSWORD!,
    },
  },
});
```

**CLI tenant**

```bash
npm run accessi:tenants -- --dir ./tenants --check
npm run accessi:tenants -- --dir ./tenants --list
npm run accessi:tenants -- --dir ./tenants --resolve accessi.acme.example.com /api/accessi
npm run accessi:tenants -- --dir ./tenants --serve --base-port 3200
npm run accessi:tenants -- --dir ./tenants --serve --base-port 3200 --watch
```

- Un processo per tenant è il default: errori, memoria e pool non si mescolano.
- Il supervisore avvia i tenant abilitati e con --watch applica aggiunte, modifiche e rimozioni senza riavviare i tenant invariati.
- Se la nuova configurazione non è valida, il supervisore mantiene la precedente e logga l errore.
- Il router in-process (createAccessiTenantRouter) è opt-in: risolve host, path o header fidato e non accetta header tenant dal client.
- Metriche e audit ricevono il label tenant; gli store Redis usano prefissi separati tramite createAccessiTenantStores.

> [!CAUTION]
> **Isolamento**
> Non condividere chiavi JWT, encryptionKey, database o prefissi Redis tra tenant. Un token o un ticket di un tenant non deve essere valido per un altro.

> [!NOTE]
> **Dettagli e template**
> Configurazione, hot reload, router e test di leakage in docs/multi-tenancy.md; systemd, Docker, Nginx e Traefik in deploy/.

---

## Versioni, migrazioni e deprecazioni

_Come aggiornare Accessi senza rompere consumer, token o database._

Il package usa semantic-release: feat e fix su dev producono versioni 2.0.0-dev.N; il merge su main produce la versione stabile. Le modifiche breaking richiedono una major e una finestra di migrazione.

| Cambiamento | Impatto | Procedura |
| --- | --- | --- |
| Aggiornamento patch/minor | Nessuna azione di codice attesa | Aggiorna la dipendenza, riavvia e verifica /health/ready |
| Nuovo schema database | Migrazione DDL | Un solo processo, backup, poi repliche con autoUpdateDatabase: false |
| Rotazione chiavi JWT | Token firmati con la vecchia chiave | Pubblica la nuova in JWKS, mantieni previousPublicKeys, attendi la scadenza dei token, rimuovi la vecchia |
| Passaggio a cookie HttpOnly | Cambia il trasporto, non le API | Abilita authCookie, aggiorna CORS e CSRF, testa login, refresh, revoca e console |
| Passaggio a RS256/JWKS | I token HS256 non sono più validi | Pianifica una finestra: i token emessi prima restano validi solo fino alla scadenza |
| Deprecazione root barrel o deep import | Import legacy | Passa agli entry point accessi/\*; i deep import restano fino alla prossima major |

### Gate prima del rilascio

**Verifiche**

```bash
npm run typecheck
npm test
npm run build
npm run test:pack
npm run check:naming
npm run check:deploy
npm run check:accessi-openapi
```

Se modifichi intenzionalmente il contratto OpenAPI, aggiorna il fingerprint con npm run accessi:update-openapi-fingerprint e includilo nel commit. Il diff semantico in CI blocca rimozioni di operation o schema e breaking change non approvati.

> [!WARNING]
> **Deep import e root barrel**
> Sono supportati fino alla prossima major, ma il layout interno può cambiare in una minor. I consumer devono usare gli entry point dichiarati in package.json\#exports. Mappa completa in docs/import-migration.md.

> [!NOTE]
> **ADR**
> Le decisioni su split in pacchetti e multi-tenancy sono in docs/adr/0001-split-package.md e docs/adr/0002-multi-tenancy.md.

---

## Contratto errori e codici

_Formato della risposta e codici stabili ACCESSI\_\* e AUTH\_\*._

Gli errori HTTP delle API Accessi usano un contratto stabile: severity, status, statusCode, code, error (campo legacy uguale a code), message e details per gli errori di validazione.

**Errore di validazione**

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
| ACCESSI\_VALIDATION\_ERROR | Body o parametri non validi (400). |
| ACCESSI\_AUTH\_INITIALIZING | Bootstrap in corso (503). |
| ACCESSI\_AUTH\_NOT\_INITIALIZED | Modulo non inizializzato (500). |
| AUTH\_HEADER\_MISSING / AUTH\_TOKEN\_MISSING | Header Authorization assente (401). |
| AUTH\_TOKEN\_INVALID | JWT non valido o scaduto (401). |
| AUTH\_USER\_DISABLED | Utente non più autorizzato (401). |
| AUTH\_INSUFFICIENT\_PERMISSIONS | Requisiti non soddisfatti (403). |
| AUTH\_REQUIREMENTS\_MISCONFIGURED | Policy malformata o handler custom mancante (500). |
| ACCESSI\_DATABASE\_SCHEMA\_OUTDATED | Schema del database incompatibile. |
| ACCESSI\_SERVICE\_TOKEN\_RATE\_LIMITED | Troppi tentativi (429). |

---

## Indice degli endpoint

_Tutte le rotte /api/accessi/\* in una tabella._

| Area | Endpoint principali |
| --- | --- |
| Auth | POST auth/login, auth/get-user-by-token, auth/confirm-reset-password/:token, auth/refresh, auth/revoke-sessions, auth/revoke-token, auth/two-factor/verify, auth/two-factor/resend |
| Email | POST email/send-reset-password-email, GET email/reset-password-page/:token |
| Utenti | GET user/get-users, POST user/create-managed-user, PUT user/update-user/:codiceUtente, DELETE user/delete-user/:codiceUtente, DELETE user/delete-user-permanent/:codiceUtente, POST user/set-password/:codiceUtente, POST user/set-stato, PATCH user/set-gdpr/:codiceUtente, POST user/register, POST user/login-as/:codiceUtente |
| Permessi | GET permission/roles, POST permission/create-role, PUT permission/update-role/:codiceRuolo, DELETE permission/delete-role/:codiceRuolo, POST permission/assign-roles/:codiceUtente, POST permission/assign-permissions/:codiceUtente, GET permission/grants/:codiceUtente, GET permission/menus, GET permission/menu-types, GET permission/groups-with-menus |
| Catalogo | POST/PUT/DELETE permission/menus\[/:codiceMenu\], permission/menu-groups\[/:codiceGruppo\], permission/menu-types\[/:codiceTipo\] |
| Configurator | PATCH configurator/menus/:codiceMenu/enabled, PATCH configurator/groups/:codiceGruppo/enabled |
| SSO | GET/POST federated-auth/providers, PATCH/DELETE providers/:provider, GET/POST users/:codiceUtente/identities, POST users, PATCH users/:codiceUtente/password-login |
| Token | POST/GET service-token, DELETE service-token/:tokenId, POST service-token/:tokenId/rotate |
| Schema | GET schema (DDL completo + entità presenti, solo admin) |
| Console | GET console, console/:view, console/:view/:sub, console/assets/:file |

---

## Antipattern e checklist

_Che cosa non fare, in breve._

- Non aprire la porta HTTP prima di initializeAccessiModule.
- Non usare authorizeAccessi come unico strato: valida sempre anche l'input applicativo.
- Non dare per scontato che req.userGrants esista se non hai richiesto dei requisiti.
- Non considerare incrementali assignRolesToUser e assignPermissionsToUser: sono sostitutivi.
- Non far validare i token SSO ad Accessi: passagli solo \{ provider, subject \} verificati.
- Non usare un service token come identità utente.
- Non versionare segreti; jwtOptions.secret deve essere unico per ambiente.
- Non eliminare gruppi o tipi in uso: gestisci l'errore 400 e disabilita invece.
- Non usare il challenge 2FA come JWT.

> [!TIP]
> **Checklist di rilascio**
> Schema verificato (db:check), segreti da un secret manager, mockDemoUser=false, rate limit pubblico configurato, SMTP reale testato, serviceTokens.defaultTtlDays impostato.

---

## Problemi comuni e come risolverli

_Sintomo, causa probabile e rimedio per gli errori più frequenti._

Prima di cambiare configurazione, leggi il codice di errore: Accessi distingue autenticazione, autorizzazione, bootstrap e disponibilità. Un 503 non è un 401 e un 403 non va risolto facendo logout.

| Sintomo | Causa probabile | Rimedio |
| --- | --- | --- |
| 401 AUTH\_TOKEN\_MISSING | Header Authorization assente o malformato | Invia Bearer \<access-token\>; non usare il refresh token come Bearer |
| 401 AUTH\_TOKEN\_INVALID | Firma, issuer, audience, scadenza o tipo token errati | Allinea issuer/audience e chiavi; rinnova il token con refresh |
| 401 AUTH\_USER\_DISABLED | Utente bloccato, cancellato o non più autorizzato | Verifica STAREG, flag e stato utente in console |
| 403 AUTH\_INSUFFICIENT\_PERMISSIONS | Menu o livello insufficiente, grant non aggiornati | Controlla ruoli e grant; verifica che il backend usi introspection se richiede i grant correnti |
| 403 AUTH\_CSRF\_INVALID | Cookie mode senza header CSRF o token diverso | Invia x-csrf-token letto dal cookie accessi\_csrf |
| 503 ACCESSI\_AUTH\_INITIALIZING | La porta HTTP è stata aperta prima del bootstrap | Attendi initializeAccessiModule o AccessiModule.forRoot prima di app.listen |
| 503 AUTH\_INTROSPECTION\_UNAVAILABLE / AUTH\_JWKS\_UNAVAILABLE | Accessi Service o JWKS non raggiungibile | Fail closed: ripristina la rete o il servizio; non autorizzare per errore |
| 500 ACCESSI\_DATABASE\_SCHEMA\_OUTDATED | Schema Firebird incompatibile | Esegui db:check:accessi, poi la migrazione con un solo processo e backup |
| 429 ripetuto | Rate limit o edge rate limit superato | Rispetta Retry-After; se dietro proxy verifica trustProxy e il numero di hop |
| Ticket console non valido | Ticket scaduto, già consumato o emesso da un altra istanza | Rigenera il ticket; in multi-istanza configura consoleEntry.store su Redis |
| Login senza token e con challenge | 2FA richiesta: il login non è completo | Chiama verifyTwoFactor con challengeId e codice, poi usa il token restituito |
| Email di reset non ricevute | SMTP non configurato o bloccato | Verifica ACCESSI\_EMAIL\_\*, TLS e mittente; i log riportano l errore SMTP senza password |
| CORS o cookie ignorati dal browser | Origin non in allowlist o credentials mancanti | Origin esplicito, credentials: true, SameSite/Secure coerenti con HTTPS |

### Come isolare il problema

1. Controlla /health/live e /health/ready: se readiness è rossa, il problema è infrastrutturale.
2. Leggi il codice nel body della risposta, non solo lo status HTTP.
3. Verifica lo stato dell utente e i suoi grant in console prima di modificare la policy.
4. Per i backend fratelli, distingui verifica locale (firma/claim) da introspection (stato e grant correnti).
5. Riproduci con un utente di test e un token appena emesso; non riusare token trovati nei log.

> [!NOTE]
> **Serve aiuto in più**
> Apri una issue con: versione del package, topologia, endpoint chiamato, status e codice errore, estratto di log senza token o segreti. Non allegare database o file di configurazione con credenziali.

---

## Glossario

_I termini usati nella documentazione, senza ambiguità._

| Termine | Significato |
| --- | --- |
| Accessi Service | Il servizio che possiede database, migrazioni, encryptionKey, SMTP, chiavi JWT e console |
| Proprietario | L unico backend o servizio autorizzato a montare AccessiModule e a eseguire migrazioni |
| Resource server | Backend fratello che verifica i token Accessi e non ha credenziali del database Accessi |
| Entry point | Subpath pubblico del package, per esempio accessi/server o accessi/client/public |
| Root barrel | Import legacy da emilsoftware-utilities; resta fino alla prossima major ma non è consigliato |
| Abilitazione | Permesso su un menu con livello NESSUNA=0, LETTURA=10, SCRITTURA=20, SPECIAL=30 |
| Grant | Insieme di abilitazioni e ruoli correnti di un utente, letto da Accessi |
| Menu code | Codice stabile del menu usato nelle policy di autorizzazione |
| Service token | Credenziale macchina-a-macchina con scope, non un utente e mai per il browser |
| Introspection | Chiamata service-to-service che restituisce active, profilo e grant correnti di un token |
| JWKS | Documento con le chiavi pubbliche per verificare JWT asimmetrici |
| kid | Identificativo della chiave JWT, usato per la rotazione |
| jti | Identificativo del singolo JWT, usato per la revoca puntuale |
| Refresh family | Catena di refresh token collegati; il riuso di uno consumato revoca la famiglia |
| Console ticket | Ticket monouso e a scadenza breve per aprire la console senza rimettere il JWT nell URL |
| Tenant | Cliente isolato con database, processo, chiavi e store propri |
| Sink | Destinazione esterna per audit o metriche (Redis, HTTP, callback, OpenTelemetry) |
| Readiness | Stato che indica se il servizio può ricevere traffico: bootstrap, DB, schema e store |
| Fail closed | In caso di dubbio o dipendenza non raggiungibile, la richiesta viene rifiutata |
| CSRF double-submit | Cookie leggibile più header uguale per proteggere le richieste che modificano stato |
