# Accessi Service standalone

Guida per eseguire Accessi come servizio autonomo, senza un backend ospitante.
È il modello consigliato quando più applicazioni condividono le stesse identità.
Per il bootstrap dentro un backend esistente vedi
[quickstart-service.md](quickstart-service.md).

## Avvio da codice

```ts
import { startAccessiService } from 'emilsoftware-utilities/accessi/server';

await startAccessiService({
  port: Number(process.env.PORT ?? 3000),
  healthPath: '/health',
  metrics: true,
});
```

`startAccessiService`:

- valida `AccessiOptions` con `assertValidAccessiOptions`;
- crea l'app Express e monta `/health/live`, `/health/ready`, `/health/metrics`;
- inizializza Accessi;
- avvia il server;
- registra `SIGTERM`/`SIGINT` per lo shutdown graceful;
- chiude Nest e i pool Firebird.

Per un controllo manuale usa `createAccessiService`, che restituisce `start()` e
`stop()`.

## Avvio da CLI

```bash
npm run accessi:serve
npm run accessi:serve:dist
```

La configurazione viene letta da `createAccessiOptionsFromEnv()`. Le variabili
principali sono elencate in [quickstart-service.md](quickstart-service.md) e
nella sezione [variabili d'ambiente](../WIKI.md#deploy-del-servizio).

## Health e readiness

```text
GET /health/live      -> 200 se il processo è vivo
GET /health/ready     -> 200 se DB e store configurati sono pronti
GET /health/metrics   -> metriche Prometheus testuali
```

`/health/ready` controlla:

- bootstrap completato;
- database Accessi raggiungibile e schema inizializzato;
- `healthCheck()` degli store Redis configurati;
- `readinessChecks` aggiuntivi passati dal chiamante.

Non esporre `/health/metrics` su Internet: contiene il dettaglio delle rotte e
degli errori. Mettilo su rete interna o proteggilo con un reverse proxy.

### Host Nest con `AccessiModule.forRoot`

Un'app Nest che monta Accessi in-process ottiene gli stessi endpoint con il
modulo di health:

```ts
import { AccessiModule, createAccessiHealthModule } from 'emilsoftware-utilities/accessi/server';

@Module({
  imports: [
    AccessiModule.forRoot(accessiOptions),
    createAccessiHealthModule({
      accessiOptions,
      readinessChecks: [{ name: 'coda', check: async () => queue.isReady() }],
      path: '/health',
    }),
  ],
})
export class AppModule {}
```

Il contratto è identico al servizio standalone (200/503, `checks` con
`bootstrap`, `database`, store configurati e check aggiuntivi). Per un uso
programmatico ci sono `checkAccessiReadiness`, `createAccessiLiveReport` e
`readinessHttpStatus`.

## Esecuzione come processo

In produzione il servizio viene eseguito come processo Node gestito da systemd,
PM2, Docker o dal supervisor del cliente:

```bash
npm run accessi:serve:dist
# oppure
node dist/scripts/startAccessiService.js
```

Esempio systemd minimale:

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

Il readiness endpoint `/health/ready` va usato dal load balancer o dal
supervisore per decidere quando inviare traffico.

Per Docker, Nginx, Traefik e multi-tenant usa i template in
[`deploy/`](../deploy/README.md). Non contengono segreti e vanno adattati.

## Migrazioni e rollout

1. Fai un backup del database.
2. Esegui la migrazione con **un solo processo**:

   ```bash
   npm run db:update:accessi
   ```

3. Avvia le repliche con `autoUpdateDatabase: false`: verificano lo schema in
   sola lettura e non eseguono DDL concorrenti.
4. Attendi `/health/ready` prima di inviare traffico.
5. Ruota una replica alla volta. Il servizio chiude Nest e i pool Firebird su
   `SIGTERM`/`SIGINT`.

Non eseguire migrazioni DDL con più repliche o con traffico applicativo.

### Migrazioni e seed da ambiente

| Variabile | Default | Uso |
| --- | --- | --- |
| `ACCESSI_AUTO_UPDATE_DATABASE` | `true` | `false` sulle repliche: verifica lo schema in sola lettura |
| `ACCESSI_LEGACY_PASSWORD_MIGRATION` | `true` | Migrazione password legacy al bootstrap |
| `ACCESSI_SYSTEM_SEEDS_ENABLED` | `true` | Seed di sistema (menu e scope di base) |
| `ACCESSI_ADMIN_BOOTSTRAP_ENABLED` | `false` | Token monouso per creare il primo admin |

I booleani accettano `true/false`, `1/0`, `yes/no`, `on/off`; un valore diverso
blocca l'avvio indicando la variabile da correggere.

### Cookie, osservabilità e tenant da ambiente

| Variabile | Default | Uso |
| --- | --- | --- |
| `ACCESSI_AUTH_COOKIE_ENABLED` | assente = Bearer | Abilita la modalità cookie HttpOnly |
| `ACCESSI_AUTH_COOKIE_SECURE` | `true` | `false` solo in sviluppo HTTP |
| `ACCESSI_AUTH_COOKIE_SAME_SITE` | `lax` | `strict`, `lax`, `none` |
| `ACCESSI_AUTH_COOKIE_CSRF` | `double-submit` | `off` solo con protezione CSRF esterna |
| `ACCESSI_METRICS_ENABLED` | `true` | Metriche di dominio |
| `ACCESSI_METRICS_PREFIX` | `accessi` | Prefisso dei nomi |
| `ACCESSI_AUDIT_ENABLED` | `true` | Sink di audit |
| `ACCESSI_AUDIT_RETENTION_DAYS` | nessuna | Retention dei sink interrogabili |
| `ACCESSI_AUDIT_LOGGER` | `true` | Scrittura anche sul Logger strutturato |
| `ACCESSI_PUBLIC_REGISTRATION_ENABLED` | `false` | Registrazione pubblica opt-in |
| `ACCESSI_FEDERATED_AUTH_ENABLED` | `false` | API SSO generiche |
| `ACCESSI_FEDERATED_SELF_REGISTRATION` | `false` | Creazione utenti SSO senza master |
| `ACCESSI_SERVICE_TOKENS_ENABLED` | `true` | API dei service token |
| `ACCESSI_SERVICE_TOKENS_DEFAULT_TTL_DAYS` | nessuna scadenza | TTL predefinito dei service token |
| `ACCESSI_TENANT_ID` | assente | Label `tenant` su metriche e audit |
| `ACCESSI_CONSOLE_ENTRY_TTL_MS` | `60000` | TTL del ticket console |

Gli store Redis (rate limit, ticket, revoche, rotazione refresh, audit) restano
oggetti runtime: vanno collegati nel bootstrap applicativo con `createAccessiService`
o `AccessiModule.forRoot`, non tramite variabili d'ambiente.

### HTTP, proxy e rate limit da ambiente

| Variabile | Default | Uso |
| --- | --- | --- |
| `ACCESSI_HTTP_TRUST_PROXY` | `false` | `1` per un proxy, `2` per due hop, `loopback` o CIDR |
| `ACCESSI_CORS_ORIGINS` | assente | Lista separata da virgola; `*` solo senza credenziali |
| `ACCESSI_CORS_CREDENTIALS` | `false` | `true` obbligatorio con cookie HttpOnly |
| `ACCESSI_SECURITY_HEADERS` | `true` | Header di sicurezza e CSP |
| `ACCESSI_PUBLIC_RATE_LIMIT_ENABLED` | `true` | Rate limit degli endpoint pubblici |
| `ACCESSI_PUBLIC_RATE_LIMIT_WINDOW_MS` | default modulo | Finestra globale per tutti gli scope |
| `ACCESSI_PUBLIC_RATE_LIMIT_MAX_ATTEMPTS` | default modulo | Tentativi globali per tutti gli scope |
| `ACCESSI_PUBLIC_RATE_LIMIT_<SCOPE>_WINDOW_MS` | eredita il globale | Override per `LOGIN`, `REGISTER`, `REFRESH`, `TWO_FACTOR_VERIFY`, `CONSOLE_ENTRY`, ... |
| `ACCESSI_PUBLIC_RATE_LIMIT_<SCOPE>_MAX_ATTEMPTS` | eredita il globale | Override per lo stesso scope |
| `ACCESSI_EDGE_RATE_LIMIT_ENABLED` | `false` | Limite grossolano prima delle rotte Accessi |
| `ACCESSI_EDGE_RATE_LIMIT_WINDOW_MS` | `60000` | Finestra dell'edge rate limit |
| `ACCESSI_EDGE_RATE_LIMIT_MAX_ATTEMPTS` | `300` | Tentativi dell'edge rate limit |

Finestra e tentativi di uno stesso scope devono essere configurati insieme;
altrimenti l'avvio fallisce con il nome della variabile mancante.

## Store condivisi

In multi-istanza configura store condivisi:

- `consoleEntry.store` con `createRedisConsoleEntryStore`;
- `publicAuthRateLimit.store` e `serviceTokens.rateLimitStore` con `createRedisRateLimitStore`;
- `sessionRevocation.store`, `accessTokenRevocation.store` e `refreshTokenRotation.store`;
- `audit.store` o `audit.sinks`.

Senza store condivisi ticket, revoche e rate limit restano locali al processo.
Se Redis non è raggiungibile i controlli falliscono chiusi. Dettagli in
[WIKI.md](../WIKI.md#store-condivisi-e-multi-istanza).

## Generazione chiavi JWT

```bash
npm run accessi:generate-jwt-keys -- --algorithm RS256 --out ./keys
```

Genera:

- `jwt-private.pem`
- `jwt-public.pem`
- `jwks.json`
- `jwt-keys.json` con `algorithm` e `keyId`

Configura poi:

```env
ACCESSI_JWT_ALGORITHM=RS256
ACCESSI_JWT_PRIVATE_KEY=<contenuto jwt-private.pem>
ACCESSI_JWT_PUBLIC_KEY=<contenuto jwt-public.pem>
ACCESSI_JWT_KEY_ID=<keyId>
```

La rotazione senza downtime è descritta in [jwt-key-rotation.md](jwt-key-rotation.md).

## Revoca sessioni

```ts
import { createRedisSessionRevocationStore } from 'emilsoftware-utilities/accessi/server';

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

I resource server fratelli devono ricevere lo stesso store in `revocation.store`
oppure applicare la revoca tramite introspection.

## Console su dominio separato

Se la console è servita da un dominio diverso dall'API:

```ts
accessiOptions: {
  ...options,
  consoleApiBaseUrl: 'https://accessi.example.com',
}
```

Accessi inietta `window.__ACCESSI_API_BASE_URL__` nella pagina della console.

## CORS, proxy e header

```ts
accessiOptions: {
  ...options,
  http: {
    cors: {
      origin: ['https://app.example.com'],
      credentials: false,
    },
    trustProxy: 1, // load balancer/reverse proxy
    securityHeaders: true,
  },
}
```

- `cors: false` disabilita CORS.
- `trustProxy` è obbligatorio per rate limit e audit corretti dietro proxy.
- `securityHeaders` aggiunge header di sicurezza e CSP configurabile.
- Con Bearer non serve CSRF. Con cookie HttpOnly serve CSRF double-submit.

Dettagli: [proxy-ip.md](proxy-ip.md), [security-headers.md](security-headers.md)
e [gateway-rate-limit.md](gateway-rate-limit.md).

## Modalità cookie HttpOnly

Bearer resta il default. Per usare cookie `HttpOnly`:

```ts
accessiOptions: {
  ...options,
  authCookie: {
    enabled: true,
    secure: true,
    sameSite: 'lax',
  },
}
```

In questa modalità Accessi invia i token in cookie, non li restituisce nel body
(salvo `exposeTokens: true`) e richiede l'header CSRF sulle richieste che
modificano stato. CORS deve avere `credentials: true` e un origin esplicito.
Dettagli e flusso browser in [auth-cookies.md](auth-cookies.md).

## Checklist di produzione

- Con `NODE_ENV=production` il servizio fallisce se `ACCESSI_JWT_SECRET` o `ACCESSI_ENCRYPTION_KEY` mancano o usano i default locali.
- Database Accessi raggiungibile solo dal servizio.
- `encryptionKey`, SMTP e chiavi JWT da un secret manager.
- `issuer` e `audience` espliciti e diversi per ambiente.
- RS256/ES256 con JWKS; HS256 solo transitorio.
- `trustProxy` corretto, CORS con origin espliciti, CSP attiva.
- Store Redis condivisi in multi-istanza.
- Rate limit pubblico, service token ed edge configurati.
- Audit con retention e sink interrogabile.
- Backup e migrazioni collaudate.
- `/health/ready` usato dal load balancer e metriche su rete interna.
