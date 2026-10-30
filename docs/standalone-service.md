# Accessi Service standalone

Accessi puo girare come servizio autonomo, senza un backend ospitante.

## Avvio da codice

```ts
import { startAccessiService } from "emilsoftware-utilities/accessi/server";

await startAccessiService({
  port: Number(process.env.PORT ?? 3000),
  healthPath: "/health",
  metrics: true,
});
```

`startAccessiService`:

- valida `AccessiOptions` con `assertValidAccessiOptions`
- crea l'app Express
- monta `/health/live`, `/health/ready`, `/health/metrics`
- inizializza Accessi
- avvia il server
- registra `SIGTERM`/`SIGINT` per lo shutdown graceful
- chiude Nest e i pool Firebird

Per un controllo manuale usare `createAccessiService`, che restituisce `start()` e `stop()`.

## Avvio da CLI

```bash
npm run accessi:serve
npm run accessi:serve:dist
```

La configurazione viene letta da `createAccessiOptionsFromEnv()`.

## Health

```text
GET /health/live      -> 200 se il processo e vivo
GET /health/ready     -> 200 se DB e store configurati sono pronti
GET /health/metrics   -> metriche Prometheus testuali
```

`/health/ready` controlla:

- bootstrap completato
- database Accessi raggiungibile e schema inizializzato
- `healthCheck()` degli store Redis configurati
- `readinessChecks` aggiuntivi passati dal chiamante

### Host Nest con `AccessiModule.forRoot`

Un'app Nest che monta Accessi in-process ottiene gli stessi endpoint con il modulo di health:

```ts
import { AccessiModule, createAccessiHealthModule } from "emilsoftware-utilities/accessi/server";

@Module({
  imports: [
    AccessiModule.forRoot(accessiOptions),
    createAccessiHealthModule({
      accessiOptions,
      readinessChecks: [{ name: "coda", check: async () => queue.isReady() }],
      path: "/health", // default
    }),
  ],
})
export class AppModule {}
```

Il contratto e identico al servizio standalone (200/503, `checks` con `bootstrap`, `database`,
store configurati e check aggiuntivi). Per un uso programmatico (senza controller) ci sono
`checkAccessiReadiness(accessiOptions, checks)`, `createAccessiLiveReport()` e
`readinessHttpStatus(report)`.

## Esecuzione come processo

In produzione il servizio viene eseguito come processo Node gestito da systemd, PM2 o dal supervisor del cliente:

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

Il readiness endpoint `/health/ready` va usato dal load balancer o dal supervisore per decidere quando inviare traffico.

## Configurazione consigliata

- `ACCESSI_DB_*`
- `ACCESSI_ENCRYPTION_KEY`
- `ACCESSI_JWT_SECRET`
- `ACCESSI_JWT_ISSUER`
- `ACCESSI_JWT_AUDIENCE`
- `ACCESSI_JWT_ALGORITHM`, `ACCESSI_JWT_PRIVATE_KEY`, `ACCESSI_JWT_PUBLIC_KEY`, `ACCESSI_JWT_KEY_ID` per RS/ES
- `ACCESSI_JWKS_PATH`
- SMTP
- `PORT`

Per Redis, passare gli store nel bootstrap applicativo:

```ts
import { createRedisRateLimitStore, createRedisConsoleEntryStore } from "emilsoftware-utilities/accessi/server";
```

## Generazione chiavi JWT

```bash
npm run accessi:generate-jwt-keys -- --algorithm RS256 --out ./keys
```

Genera:

- `jwt-private.pem`
- `jwt-public.pem`
- `jwks.json`
- `jwt-keys.json` con `algorithm` e `keyId`

Configurare poi:

```env
ACCESSI_JWT_ALGORITHM=RS256
ACCESSI_JWT_PRIVATE_KEY=<contenuto jwt-private.pem>
ACCESSI_JWT_PUBLIC_KEY=<contenuto jwt-public.pem>
ACCESSI_JWT_KEY_ID=<keyId>
```

## Revoca sessioni

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

I resource server fratelli devono ricevere lo stesso store in `revocation.store`.

## Console su dominio separato

Se la console è servita da un dominio diverso dall’API:

```ts
accessiOptions: {
  ...options,
  consoleApiBaseUrl: "https://accessi.example.com",
}
```

Accessi inietta `window.__ACCESSI_API_BASE_URL__` nella pagina della console.

## CORS e proxy

```ts
accessiOptions: {
  ...options,
  http: {
    cors: {
      origin: ["https://app.example.com"],
      credentials: false,
    },
    trustProxy: 1, // load balancer/reverse proxy
    securityHeaders: true,
  },
}
```

Con Bearer token non serve CSRF. Se in futuro si passasse a cookie httpOnly, aggiungere CSRF e configurazione cookie same-site.
