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
