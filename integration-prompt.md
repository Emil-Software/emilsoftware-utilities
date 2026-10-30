# Integration prompt — Accessi (`emilsoftware-utilities`)

Questo documento e il contesto unico da passare a un agente AI o a uno sviluppatore che deve integrare Accessi in un backend, in un frontend o in un altro servizio.

L'obiettivo e evitare l'errore piu comune: **montare `AccessiModule` ovunque**. Accessi e un servizio di identita; gli altri backend sono resource server.

---

## 1. Architettura da seguire

```text
Frontend A ─┐
Frontend B ─┼──> Accessi Service (DB, SMTP, utenti, ruoli, console, SSO, 2FA)
            │         ▲
Backend A ──┼─────────┤  introspection / service token
Backend B ──┘         │
                      └──> Accessi DB (solo Accessi Service)
```

Regole:

- **Accessi Service** e l'unico proprietario di:
  - database Accessi e migrazioni
  - `encryptionKey`
  - SMTP
  - chiavi JWT
  - admin bootstrap
  - console amministrativa
- **Backend A/B** non hanno credenziali del DB Accessi e non eseguono migrazioni Accessi.
- **Frontend A/B** fanno login su Accessi Service e usano il JWT verso i backend.
- La console e centralizzata su Accessi Service.
- Non montare `AccessiModule` in due backend puntati allo stesso database.

Se per ora Accessi e montato dentro Backend A, va bene: Backend A e il proprietario. Backend B usa solo `accessi/resource-server` e `accessi/client`.

---

## 2. Entry point del pacchetto

| Import | Quando usarlo |
|---|---|
| `emilsoftware-utilities/accessi/server` | Backend che ospita Accessi: `AccessiModule`, `initializeAccessiModule`, updater DB, migrazioni, console. |
| `emilsoftware-utilities/accessi/resource-server` | Backend fratello: middleware Express, guard Nest, verifica JWT e introspection. |
| `emilsoftware-utilities/accessi/client` | Client OpenAPI completo, con configurazione globale o per istanza (`createAccessiClient`). |
| `emilsoftware-utilities/accessi/client/public` | Solo API pubbliche (login, refresh, 2FA, reset password, ticket console): da preferire nei frontend. |
| `emilsoftware-utilities/accessi/client/admin` | Solo API amministrative (utenti, ruoli, menu, filtri, provider federati, schema): console e tool admin. |
| `emilsoftware-utilities/accessi/client/service` | Solo API service-to-service (service token e introspezione): backend fratelli e job. |
| `emilsoftware-utilities/accessi/contracts` | Tipi, enum e helper puri browser-safe. |
| `emilsoftware-utilities/accessi/contracts/dtos` | DTO Nest con `class-validator` e decoratori OpenAPI. Solo backend. |
| `emilsoftware-utilities/accessi/openapi` | `setupOpenApi`, `mergeOpenApiDocuments`. |
| `emilsoftware-utilities/accessi/console` | `buildAccessiConsoleUrl`, URL console e ticket. |
| `emilsoftware-utilities/accessi/ui` | Percorsi asset Web Component frameworkless. |

Il root export `emilsoftware-utilities` resta per retrocompatibilita, ma nei nuovi progetti usare gli entry point sopra.

---

## 3. Backend che ospita Accessi

### Bootstrap Express

```ts
import { initializeAccessiModule } from "emilsoftware-utilities/accessi/server";

const { nestApp, document } = await initializeAccessiModule(app, options);
// document e il documento OpenAPI Accessi, gia con /api/accessi/*
```

`initializeAccessiModule` restituisce:

```ts
{
  nestApp: INestApplication;
  document: OpenAPIObject;
}
```

Aprire la porta HTTP solo dopo l'await.

### Avvio standalone

Per un servizio Accessi autonomo:

```ts
import { startAccessiService } from "emilsoftware-utilities/accessi/server";

await startAccessiService({
  port: Number(process.env.PORT ?? 3000),
  healthPath: "/health",
  metrics: true,
});
```

Oppure:

```bash
npm run accessi:serve
```

Endpoint:

```text
GET /health/live
GET /health/ready
GET /health/metrics
```

`/health/ready` controlla bootstrap, database, schema, store Redis configurati e `readinessChecks` custom. `startAccessiService` registra SIGTERM/SIGINT e chiude Nest e i pool Firebird.

In produzione il servizio viene eseguito come processo Node con systemd/PM2/supervisor:

```bash
npm run accessi:serve:dist
```

Dettagli e esempio systemd: `docs/standalone-service.md`.

### Validazione configurazione

```ts
import {
  assertValidAccessiOptions,
  validateAccessiOptions,
} from "emilsoftware-utilities/accessi/server";

const validation = validateAccessiOptions(options);
// validation.errors / validation.warnings

assertValidAccessiOptions(options); // fail-fast
```

`createAccessiService` la applica automaticamente. Controlla JWT/key, DB, encryption key, URL email, rate limit, console entry e `http`.

### Bootstrap Nest

```ts
import { AccessiModule } from "emilsoftware-utilities/accessi/server";

@Module({
  imports: [AccessiModule.forRoot(options)],
})
export class AppModule {}
```

### Configurazione minima

```ts
import type { AccessiServerOptions } from "emilsoftware-utilities/accessi/server";

const options: AccessiServerOptions = {
  databaseOptions: {
    host: process.env.ACCESSI_DB_HOST!,
    port: Number(process.env.ACCESSI_DB_PORT ?? 3050),
    database: process.env.ACCESSI_DB_NAME!,
    user: process.env.ACCESSI_DB_USER!,
    password: process.env.ACCESSI_DB_PASSWORD!,
  },
  confirmationEmailUrl: "https://app.example.com",
  confirmationEmailReturnUrl: "https://app.example.com/login",
  encryptionKey: process.env.ACCESSI_ENCRYPTION_KEY!,
  mockDemoUser: false,
  autoUpdateDatabase: true,
  legacyPasswordMigrationOnStartup: true,
  jwtOptions: {
    secret: process.env.ACCESSI_JWT_SECRET!,
    expiresIn: "24h",
    issuer: "accessi",
    audience: "backend-app",
    // Per multi-servizio:
    // algorithm: "RS256",
    // privateKey: process.env.ACCESSI_JWT_PRIVATE_KEY,
    // publicKey: process.env.ACCESSI_JWT_PUBLIC_KEY,
    // keyId: "accessi-2026-01",
  },
  emailOptions: {
    host: process.env.SMTP_HOST!,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: false,
    requireTLS: true,
    tls: { rejectUnauthorized: true },
    from: "no-reply@example.com",
    auth: { user: process.env.SMTP_USER!, pass: process.env.SMTP_PASS! },
  },
  serviceTokens: { enabled: true, defaultTtlDays: 365 },
};
```

### OpenAPI

```ts
import { setupOpenApi, mergeOpenApiDocuments } from "emilsoftware-utilities/accessi/openapi";

const document = setupOpenApi(nestApp, {
  openApiPath: "accessi/openapi",
  openApiJsonPath: "accessi/openapi.json",
  title: "Accessi API Documentation",
  description: "API del modulo accessi",
  enabled: true,
});
```

Per un documento unico host:

```ts
const merged = mergeOpenApiDocuments(hostDocument, accessiDocument, {
  conflict: "error", // "keep" | "overwrite"
});
```

### HTTP, CORS e proxy

```ts
http: {
  cors: {
    origin: ["https://app.example.com"],
    credentials: false,
  },
  trustProxy: 1, // load balancer/reverse proxy
  securityHeaders: true,
}
```

- `cors: false` disabilita CORS.
- `trustProxy` e obbligatorio per rate limit corretti dietro proxy.
- `securityHeaders` aggiunge `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`.
- Con Bearer token non serve CSRF. Se usi cookie httpOnly, aggiungi CSRF e cookie same-site.

### JWKS e rotazione chiavi

Con RS256/ES256 Accessi pubblica automaticamente:

```text
GET /accessi/.well-known/jwks.json
```

Configurazione:

```ts
jwtOptions: {
  algorithm: "RS256",
  privateKey: process.env.ACCESSI_JWT_PRIVATE_KEY,
  publicKey: process.env.ACCESSI_JWT_PUBLIC_KEY,
  keyId: "accessi-2026-02",
  jwksPath: "accessi/.well-known/jwks.json",
  previousPublicKeys: [
    {
      publicKey: process.env.ACCESSI_JWT_PUBLIC_KEY_2026_01!,
      keyId: "accessi-2026-01",
      algorithm: "RS256",
    },
  ],
}
```

Rotazione:

1. generare la nuova coppia
2. pubblicare la nuova chiave mantenendo la precedente in `previousPublicKeys`
3. firmare con la nuova `keyId`
4. attendere la scadenza massima dei token + il TTL cache della JWKS (default 5 minuti)
5. rimuovere la chiave precedente

Per un'app Nest esistente si può usare `setupAccessiJwks(app.getHttpAdapter().getInstance(), options)`.

### Store ticket console

Il default è in memoria, adatto a una sola istanza. In multi-istanza configurare uno store condiviso:

```ts
import { createRedisConsoleEntryStore } from "emilsoftware-utilities/accessi/server";

consoleEntry: {
  ttlMs: 60_000,
  store: createRedisConsoleEntryStore({
    client: redis, // ioredis o client compatibile con eval(script, numKeys, ...args)
    encryptionKey: process.env.ACCESSI_CONSOLE_ENTRY_KEY!,
    keyPrefix: "accessi:console-entry:",
  }),
}
```

Lo store Redis:

- cifra il JWT con AES-256-GCM
- usa `SET ... PX ... NX` con TTL
- consuma con `GET` + `DEL` atomici in Lua
- rende il ticket monouso anche tra istanze diverse

Se lo store condiviso non è raggiungibile, la console deve fallire chiusa.

### Rate limit condiviso

Con più istanze anche i rate limit devono usare uno store condiviso:

```ts
import { createRedisRateLimitStore } from "emilsoftware-utilities/accessi/server";

const rateLimitStore = createRedisRateLimitStore({
  client: redis, // ioredis o client compatibile con eval(script, numKeys, ...args)
  keyPrefix: "accessi:rate:",
});

publicAuthRateLimit: {
  enabled: true,
  store: rateLimitStore,
  login: { windowMs: 15 * 60_000, maxAttempts: 10 },
  twoFactorVerify: { windowMs: 15 * 60_000, maxAttempts: 20 },
},

serviceTokens: {
  enabled: true,
  rateLimitStore: rateLimitStore,
},
```

Lo store Redis usa `INCR` + `PEXPIRE` atomici:

- conta tentativi per IP e per soggetto (email, challenge, ticket, tokenId);
- il limite è globale tra le istanze;
- non viene azzerato da un restart;
- se Redis non è raggiungibile il controllo fallisce chiuso: l’endpoint risponde con errore, non autorizza.

Default: store in memoria. Va bene per una singola istanza o per ambienti di sviluppo.

### Edge rate limit per IP

Per una soglia grossolana davanti alle rotte Accessi:

```ts
edgeRateLimit: {
  enabled: true,
  windowMs: 60_000,
  maxAttempts: 300,
  store: rateLimitStore, // stesso store Redis, opzionale
}
```

Viene applicato prima del dispatcher Accessi e copre `/api/accessi/*`, OpenAPI e JWKS. In caso di store non disponibile risponde `503 ACCESSI_RATE_LIMIT_UNAVAILABLE`; quando la soglia è superata risponde `429 ACCESSI_EDGE_RATE_LIMITED` con `Retry-After`.

Il gateway/API gateway resta consigliato per:

- limiti di connessione e burst;
- bot protection e WAF;
- rate limit per IP a livello di rete;
- blocco geografico o reputazionale.

Configurazioni di riferimento: `docs/gateway-rate-limit.md`.

### Audit

Resource server ed edge rate limit producono eventi strutturati tramite `auditAccessi`. I campi sensibili vengono redatti dal Logger. Disattivabile con `audit: false` nelle rispettive opzioni.

Nel servizio standalone le metriche Prometheus sono su `/health/metrics`.

---

## 4. Backend fratello — Express

```ts
import { createAccessiAuthMiddleware } from "emilsoftware-utilities/accessi/resource-server";

app.use(createAccessiAuthMiddleware({
  mode: "local",
  jwt: {
    // HS256: passare il segreto grezzo Accessi, la KDF viene applicata qui
    serverSecret: process.env.ACCESSI_JWT_SECRET,
    issuer: "accessi",
    audience: "backend-a",
  },
  // Opzionale: serve per leggere i grant correnti
  introspection: {
    url: "https://accessi.example.com/api/accessi/auth/introspect",
    serviceToken: process.env.ACCESSI_SERVICE_TOKEN!,
    cacheTtlMs: 30_000,
    timeoutMs: 3_000,
  },
  authorization: {
    requirements: [{ menuCode: "ORDINI", minPermissionLevel: 20 }],
  },
}));
```

Dopo il middleware:

- `req.user`: payload autenticato (compatibile con il middleware storico)
- `req.data`: alias di `req.user`
- `req.userGrants`: presente solo se la policy richiede grant
- `req.accessi`: `{ token, user, codiceUtente, grants?, payload? }`

### HS256 vs RS256/JWKS

- **HS256**: usare `jwt.serverSecret` con `ACCESSI_JWT_SECRET`. Il resource server deriva la chiave access con la stessa KDF del server.
- **RS256/ES256**: usare `jwt.publicKey` PEM oppure `jwt.jwks.url`. Consigliato in multi-servizio.
- Il server Accessi supporta `jwtOptions.algorithm`, `privateKey`, `publicKey`, `keyId`.
- Accessi espone la JWKS su `jwtOptions.jwksPath` (default `accessi/.well-known/jwks.json`) quando usa RS/ES.
- La JWKS include la chiave corrente e le `previousPublicKeys`, per la rotazione senza downtime.
- Configurare il resource server con `jwks: { url: "https://accessi.example.com/accessi/.well-known/jwks.json" }`.

### Errori

| HTTP | Codice | Significato |
|---|---|---|
| 401 | `AUTH_TOKEN_MISSING` | Header Bearer assente o malformato. |
| 401 | `AUTH_TOKEN_INVALID` | Firma, scadenza, issuer/audience o tipo token non validi. |
| 401 | `AUTH_USER_CODE_MISSING` | Token senza `codiceUtente`. |
| 403 | `AUTH_INSUFFICIENT_PERMISSIONS` | Policy di autorizzazione non soddisfatta. |
| 500 | `AUTH_CONFIG_INVALID` | Configurazione resource server incompleta. |
| 500 | `AUTH_GRANTS_SOURCE_MISSING` | Policy richiede grant ma introspection non configurata. |
| 503 | `AUTH_INTROSPECTION_UNAVAILABLE` | Accessi Service non raggiungibile; fail closed. |
| 503 | `AUTH_INTROSPECTION_UNAUTHORIZED` | Service token invalido o senza `accessi:introspect`. |
| 503 | `AUTH_JWKS_UNAVAILABLE` | JWKS non raggiungibile. |

---

## 5. Backend fratello — NestJS

```ts
import {
  createAccessiAuthGuard,
  type AccessiAuthenticatedRequest,
} from "emilsoftware-utilities/accessi/resource-server";

@UseGuards(createAccessiAuthGuard({
  jwt: { publicKey: process.env.ACCESSI_JWT_PUBLIC_KEY, algorithms: ["RS256"] },
  introspection: {
    url: process.env.ACCESSI_INTROSPECT_URL!,
    serviceToken: process.env.ACCESSI_SERVICE_TOKEN!,
  },
  authorization: {
    requirements: [{ menuCode: "ORDINI", minPermissionLevel: 20 }],
  },
}))
@Get("ordini")
list(@Req() req: AccessiAuthenticatedRequest) {
  return req.user;
}
```

Il guard mappa gli errori in `UnauthorizedException`, `ForbiddenException`, `ServiceUnavailableException` o `InternalServerErrorException`.

---

## 6. Introspection

Endpoint:

```http
POST /api/accessi/auth/introspect
Authorization: Bearer <service-token>
Content-Type: application/json

{ "token": "<access-token-utente>" }
```

Scope richiesto:

```text
accessi:introspect
```

Risposta:

```json
{
  "Status": { "errorCode": "0", "errorDescription": "" },
  "Result": {
    "active": true,
    "user": { "codiceUtente": 123, "email": "utente@example.com" },
    "grants": { "abilitazioni": [], "ruoli": [], "grants": [] }
  },
  "Message": "Dati recuperati con successo."
}
```

- `active: false` per token invalido, scaduto o utente disabilitato.
- Gli errori di database/configurazione sono 500: non vanno interpretati come token scaduto.
- Il client `createAccessiIntrospectionClient` normalizza `Result`, applica timeout e cache.
- Il resource server cachea i risultati attivi per `cacheTtlMs` (default 30s). I risultati inattivi non sono cachati.
- Fail closed: se Accessi Service non risponde, la richiesta non viene autorizzata.

### SSO exchange service-to-service

Se un backend fratello valida un provider SSO proprio, non deve duplicare utenti o grant. Dopo aver verificato firma, issuer, audience e subject del provider, chiama:

```http
POST /api/accessi/federated-auth/exchange
Authorization: Bearer <service-token>
Content-Type: application/json

{ "provider": "azure-ad-acme-produzione", "subject": "<oid o sub>" }
```

Scope richiesto: `accessi:federated:exchange`.

La risposta contiene:

- `codiceUtente`
- `login` con profilo, grant e token
- `token` assente quando è richiesta la verifica 2FA

Accessi non riceve il token del provider: riceve solo l'identità esterna già verificata.

### Revoca sessioni

Configurazione:

```ts
import { createRedisSessionRevocationStore } from "emilsoftware-utilities/accessi/server";

sessionRevocation: {
  store: createRedisSessionRevocationStore({
    client: redis,
    ttlMs: 30 * 24 * 60 * 60 * 1000, // maggiore della durata massima dei token
  }),
}
```

Endpoint utente:

```http
POST /api/accessi/auth/revoke-sessions
Authorization: Bearer <access-token>
```

Invalida i token emessi prima della chiamata. I token emessi dopo restano validi. Per i backend fratelli configurare lo stesso store anche nel resource server:

```ts
revocation: {
  store: revocationStore,
}
```

Senza store condiviso la revoca vale solo nel processo che la esegue.

---

## 7. Frontend

### Login

Il frontend chiama Accessi Service:

```ts
import { configureAccessiClient, login } from "emilsoftware-utilities/accessi/client";

configureAccessiClient({
  baseUrl: "https://accessi.example.com",
  token: null,
});

const response = await login({ email, password });
const token = response.data.Result.token.value;
```

Dopo il login:

```ts
configureAccessiClient({
  baseUrl: "https://accessi.example.com",
  token,
});
```

Se `jwtOptions.refreshExpiresIn` è configurato, la risposta contiene anche `refreshToken`. Conservarlo separatamente dall’access token e usarlo su:

```http
POST /api/accessi/auth/refresh
Content-Type: application/json

{ "refreshToken": "<refresh-token>" }
```

La risposta contiene un nuovo `token` e un nuovo `refreshToken`. Il refresh token ha `typ: "refresh"` e non va mai usato come Bearer sulle API.

Per rendere il refresh token monouso anche in multi-istanza:

```ts
import { createRedisRefreshTokenRotationStore } from "emilsoftware-utilities/accessi/server";

refreshTokenRotation: {
  store: createRedisRefreshTokenRotationStore({ client: redis }),
}
```

Ogni refresh consuma il vecchio `jti` in modo atomico. Due refresh concorrenti dello stesso token producono un solo successo.

Per token che cambiano nel tempo:

```ts
configureAccessiClient({
  baseUrl: "https://accessi.example.com",
  getToken: () => authStore.getToken(),
});
```

### Chiamate ai backend

Il frontend usa il JWT Accessi come Bearer verso Backend A/B. Non serve che il frontend importi il resource server.

### Console

Non incorporare la console in ogni applicazione. Linkare Accessi Service:

```ts
import { buildAccessiConsoleUrl } from "emilsoftware-utilities/accessi/console";

const consoleUrl = buildAccessiConsoleUrl("https://accessi.example.com", {
  entryTicket: ticket, // da POST /api/accessi/console/entry
});
```

- Il JWT non va mai nell'URL.
- Il ticket e monouso, dura 60 secondi.
- Per il 2FA handoff usare `twoFactorChallengeId`.
- Se la console deve stare sullo stesso dominio, fare reverse proxy di `/api/accessi/*` verso Accessi Service, non copiare gli asset.
- Se la UI della console è su un dominio diverso dall’API, configurare `consoleApiBaseUrl`: Accessi inietta `window.__ACCESSI_API_BASE_URL__` nella pagina servita.

### Web component

```html
<script type="module" src="/assets/aree-disponibili/aree-disponibili.js"></script>
<es-aree-disponibili></es-aree-disponibili>
```

I componenti sono frameworkless e ricevono i dati via proprieta; non fanno chiamate di rete.

---

## 8. Contratti e DTO

- `accessi/contracts`: tipi/enum/helper puri, adatti anche al browser.
- `accessi/contracts/dtos`: DTO Nest con decoratori; non usarli in bundle frontend leggeri.
- `accessi/client`: tipi generati dall'OpenAPI e funzioni HTTP; e la fonte consigliata per frontend e backend fratelli.
- `accessi/client/public` / `admin` / `service`: stessi tipi e funzioni, filtrati per scope. Il client pubblico non espone operazioni amministrative; usare `createAccessiPublicClient`, `createAccessiAdminClient` o `createAccessiServiceClient` per isolare base URL e token per istanza.

Non usare i DTO server come contratto pubblico se il frontend non ha `class-validator`, `class-transformer` e `reflect-metadata`.

---

## 9. Service token

Per chiamare l'introspection o API tecniche:

1. Abilitare `serviceTokens: { enabled: true }` su Accessi Service.
2. Creare un token dalla console o con `POST /api/accessi/service-token`.
3. Assegnare lo scope minimo necessario:
   - `accessi:introspect` per l'introspection
   - `accessi:federated:exchange` per scambiare un'identita SSO verificata
   - altri scope applicativi secondo necessita
4. Conservarlo come secret nel backend fratello.
5. Ruotarlo periodicamente; il segreto e mostrato una sola volta.

Non usare un service token nel browser.

---

## 10. Sicurezza: regole non negoziabili

- Il database Accessi è solo di Accessi Service.
- `encryptionKey`, SMTP, chiavi private JWT e admin bootstrap restano solo su Accessi Service.
- In multi-servizio usare RS256/ES256 con chiave pubblica/JWKS. HS256 con segreto condiviso e accettabile solo come fase transitoria.
- Non inserire JWT, ticket console o service token nei log.
- Non mettere JWT o ticket nell'URL; il ticket console va nel fragment `#entry=`.
- La console va centralizzata.
- Le rotte amministrative richiedono policy esplicite; non fidarsi dei flag nel token senza introspection.
- Le richieste con introspection non raggiungibile devono fallire chiuse.
- Usare `issuer` e `audience` per evitare token di ambienti diversi.

---

## 11. Variabili ambiente consigliate

Accessi Service:

```env
ACCESSI_DB_HOST=
ACCESSI_DB_PORT=3050
ACCESSI_DB_NAME=
ACCESSI_DB_USER=
ACCESSI_DB_PASSWORD=
ACCESSI_ENCRYPTION_KEY=
ACCESSI_JWT_SECRET=
ACCESSI_JWT_EXPIRES=24h
ACCESSI_JWT_REFRESH_EXPIRES=30d
ACCESSI_JWT_ISSUER=accessi
ACCESSI_JWT_AUDIENCE=backend-app
# Opzionale RS256
ACCESSI_JWT_ALGORITHM=RS256
ACCESSI_JWT_PRIVATE_KEY=
ACCESSI_JWT_PUBLIC_KEY=
ACCESSI_JWT_KEY_ID=
ACCESSI_JWKS_PATH=accessi/.well-known/jwks.json
ACCESSI_CONSOLE_ENTRY_TTL_MS=60000
ACCESSI_CONSOLE_ENTRY_KEY=
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
ACCESSI_EMAIL_FROM=
```

Backend fratello:

```env
ACCESSI_JWT_PUBLIC_KEY=
# oppure, solo HS256 transitorio:
ACCESSI_JWT_SECRET=
ACCESSI_JWT_ISSUER=accessi
ACCESSI_JWT_AUDIENCE=backend-a
ACCESSI_INTROSPECT_URL=https://accessi.example.com/api/accessi/auth/introspect
ACCESSI_SERVICE_TOKEN=
```

Frontend:

```env
ACCESSI_API_BASE_URL=https://accessi.example.com
ACCESSI_CONSOLE_URL=https://accessi.example.com/api/accessi/console
ACCESSI_JWKS_URL=https://accessi.example.com/accessi/.well-known/jwks.json
```

---

## 12. Migrazione da Accessi embedded

Checklist:

1. Scegliere il proprietario: Accessi Service o un backend esistente.
2. Se il DB resta lo stesso, non migrare i dati; cambiare solo rete e credenziali.
3. Mantenere la stessa `encryptionKey` finche tutte le password legacy non sono migrate.
4. Introdurre `issuer`/`audience` o RS256 solo con una finestra di migrazione: i token vecchi possono diventare invalidi.
5. Spostare la console una sola volta.
6. Passare i backend fratelli a `resource-server`.
7. Configurare un service token con `accessi:introspect`.
8. Pubblicare la JWKS e configurare i resource server su `jwks.url`.
9. In multi-istanza configurare `consoleEntry.store`, `publicAuthRateLimit.store` e `serviceTokens.rateLimitStore` con Redis.
10. Testare:
   - login
   - token valido
   - token scaduto
   - utente disabilitato
   - revoca grants
   - Accessi Service spento (fail closed)
   - console entry ticket su istanze diverse
   - rate limit condiviso tra istanze
   - rotazione JWKS con vecchia chiave ancora valida
11. Aggiornare CORS se i frontend cambiano dominio.
12. Aggiornare monitoraggio e log senza includere token.
13. Eseguire `npm run check:accessi-openapi` e `npm run typecheck` prima del rilascio.
14. Dopo una modifica intenzionale al contratto, aggiornare il fingerprint con `npm run accessi:update-openapi-fingerprint` e includerlo nel commit.

---

## 13. Prompt operativo da copiare

### Per un backend

> Integra Accessi usando l'entry point corretto. Se questo backend possiede il database Accessi, usa `emilsoftware-utilities/accessi/server` e `initializeAccessiModule`/`AccessiModule.forRoot`. Se non lo possiede, non importare `AccessiModule` e non configurare il database Accessi: usa `emilsoftware-utilities/accessi/resource-server` con `createAccessiAuthMiddleware` (Express) o `createAccessiAuthGuard` (Nest). Configura `jwt` con `publicKey`/`jwks` (preferito) o `serverSecret` (HS256), `issuer` e `audience`. Se servono grant, configura `introspection` con URL e service token scope `accessi:introspect`, e una cache breve. Applica una policy `authorization` esplicita sulle rotte sensibili. Non fidarti dei flag nel token senza introspection. Usa `accessi/client` per chiamare Accessi Service e `accessi/contracts` per i tipi. Non inserire token nei log o negli URL.

### Per un frontend

> Usa `emilsoftware-utilities/accessi/client/public` nei frontend (mai il client admin) e `createAccessiClient`/`createAccessiPublicClient` se parli con piu Accessi Service o tenant: chiama `configureAccessiClient({ baseUrl, token })` dopo il login e `getToken` se il token cambia. Il login, il refresh, il 2FA e il reset password passano da Accessi Service. Verso i backend usa `Authorization: Bearer <access-token>`. Non incorporare il database o il server Accessi. Per la console usa `buildAccessiConsoleUrl` con il ticket monouso restituito da `POST /api/accessi/console/entry`; non mettere mai il JWT nell'URL. Per i componenti UI usa gli asset di `accessi/ui`. Gestisci gli errori 401 (`AUTH_TOKEN_INVALID`) portando l'utente al login e 403 (`AUTH_INSUFFICIENT_PERMISSIONS`) mostrando un messaggio di permessi insufficienti.

### Per un agente AI

> Prima di modificare codice, leggi `integration-prompt.md`, `WIKI.md` e `src/accessi-module/Console/changelog.md`. Rispetta la separazione dei ruoli: `accessi/server` solo sul proprietario del DB, `accessi/resource-server` sui backend fratelli. Non aggiungere dipendenze dal database Accessi nei resource server. Non inventare endpoint: l'introspection e `POST /api/accessi/auth/introspect` con service token scope `accessi:introspect`. Non cambiare i default HS256 senza una finestra di migrazione. Aggiungi test per token valido, scaduto, utente disabilitato, permessi insufficienti e introspection non raggiungibile.

---

## 14. Limiti attuali da conoscere

- I ticket di ingresso console usano lo store in memoria per default: in multi-istanza configurare `consoleEntry.store` con Redis. Lo store Redis e cifrato e monouso, ma richiede un client Redis compatibile.
- I rate limit usano lo store in memoria per default: in multi-istanza configurare `publicAuthRateLimit.store` e `serviceTokens.rateLimitStore` con Redis. Il gateway resta comunque consigliato per i limiti grossolani per IP.
- Il client generato e completo (include endpoint amministrativi): non distribuirlo a frontend non amministrativi senza valutare gli endpoint esposti. Per un client pubblico ridotto, generare un sottoinsieme per tag con Orval.
- I DTO in `accessi/contracts/dtos` dipendono da Nest/class-validator: non sono pensati per bundle frontend minimali.
- La JWKS viene pubblicata solo con algoritmi asimmetrici: con HS256 non esiste una chiave pubblica da distribuire.
