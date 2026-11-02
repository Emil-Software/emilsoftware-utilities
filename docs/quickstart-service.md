# Quickstart: backend che possiede Accessi

Questa guida è per il backend (o servizio) che possiede il database Accessi.
Se il tuo backend deve solo verificare i token emessi da un altro servizio, usa
il [quickstart resource server](quickstart-resource-server.md).

## Prerequisiti

- Node.js 18 o superiore.
- Firebird/InterBase 2.5 o superiore raggiungibile dal servizio.
- Un server SMTP: Accessi lo richiede per reset password, 2FA e inviti.
- Un secret manager o variabili d'ambiente per database, `encryptionKey`, SMTP e chiavi JWT.

## Installazione

```bash
npm install emilsoftware-utilities
```

## Configurazione minima

Con `NODE_ENV=production` il servizio rifiuta i segreti di default locali:
`ACCESSI_JWT_SECRET` e `ACCESSI_ENCRYPTION_KEY` devono essere presenti e diversi
dai valori di sviluppo. Anche `mockDemoUser` deve restare `false`.

```ts
import type { AccessiServerOptions } from 'emilsoftware-utilities/accessi/server';

const options: AccessiServerOptions = {
  databaseOptions: {
    host: process.env.ACCESSI_DB_HOST!,
    port: Number(process.env.ACCESSI_DB_PORT ?? 3050),
    database: process.env.ACCESSI_DB_DATABASE!,
    user: process.env.ACCESSI_DB_USER!,
    password: process.env.ACCESSI_DB_PASSWORD!,
  },
  encryptionKey: process.env.ACCESSI_ENCRYPTION_KEY!,
  confirmationEmailUrl: process.env.ACCESSI_CONFIRMATION_EMAIL_URL!,
  confirmationEmailReturnUrl: process.env.ACCESSI_CONFIRMATION_RETURN_EMAIL_URL!,
  emailOptions: {
    host: process.env.ACCESSI_EMAIL_HOST!,
    port: Number(process.env.ACCESSI_EMAIL_PORT ?? 587),
    secure: false,
    requireTLS: true,
    from: process.env.ACCESSI_EMAIL_FROM!,
    auth: {
      user: process.env.ACCESSI_EMAIL_USER!,
      pass: process.env.ACCESSI_EMAIL_PASSWORD!,
    },
  },
  jwtOptions: {
    secret: process.env.ACCESSI_JWT_SECRET!,
    expiresIn: process.env.ACCESSI_JWT_EXPIRES ?? '24h',
    refreshExpiresIn: process.env.ACCESSI_JWT_REFRESH_EXPIRES ?? '30d',
    issuer: process.env.ACCESSI_JWT_ISSUER ?? 'accessi',
    audience: process.env.ACCESSI_JWT_AUDIENCE ?? 'backend-app',
  },
  autoUpdateDatabase: true,
  mockDemoUser: false,
};
```

In produzione preferisci RS256/ES256 con JWKS:

```ts
jwtOptions: {
  algorithm: 'RS256',
  secret: process.env.ACCESSI_JWT_SECRET!,
  privateKey: process.env.ACCESSI_JWT_PRIVATE_KEY!,
  publicKey: process.env.ACCESSI_JWT_PUBLIC_KEY!,
  keyId: process.env.ACCESSI_JWT_KEY_ID!,
  issuer: 'https://accessi.example.com',
  audience: 'backend-app',
}
```

La rotazione delle chiavi è descritta in [jwt-key-rotation.md](jwt-key-rotation.md).

## Bootstrap su Express

```ts
import express from 'express';
import {
  initializeAccessiModule,
  authorizeAccessi,
} from 'emilsoftware-utilities/accessi/server';

const app = express();
app.use(express.json());

// Attendi il bootstrap prima di aprire la porta HTTP.
await initializeAccessiModule(app, options);

app.get('/api/ordini', authorizeAccessi, (req, res) => {
  res.json({ utente: req.user });
});

app.listen(3000);
```

`initializeAccessiModule` restituisce `{ nestApp, document }`: il documento
OpenAPI può essere unito a quello dell'host con `mergeOpenApiDocuments` di
`emilsoftware-utilities/accessi/openapi`.

## Bootstrap su Nest

```ts
import { Module } from '@nestjs/common';
import { AccessiModule } from 'emilsoftware-utilities/accessi/server';

@Module({
  imports: [AccessiModule.forRoot(options)],
})
export class AppModule {}
```

`AccessiModule` è `@Global()`: inizializzalo una sola volta per processo.

## Database e primo admin

Al primo avvio con `autoUpdateDatabase: true` Accessi riconcilia lo schema
Firebird. In produzione:

1. Esegui la migrazione con un solo processo:

   ```bash
   npm run db:update:accessi
   ```

2. Avvia le repliche con `autoUpdateDatabase: false`.
3. Crea il primo admin dalla console, abilitando temporaneamente `adminBootstrap`.
   Il token di bootstrap viene stampato all'avvio, è monouso e dura fino al riavvio.
4. Disabilita `adminBootstrap` dopo la creazione.

Per diagnostica:

```bash
npm run db:check:accessi
```

## Health e readiness

Se usi il servizio standalone, gli endpoint sono già presenti. In un host Nest:

```ts
import { createAccessiHealthModule } from 'emilsoftware-utilities/accessi/server';

@Module({
  imports: [
    AccessiModule.forRoot(options),
    createAccessiHealthModule({ accessiOptions: options, path: '/health' }),
  ],
})
export class AppModule {}
```

Endpoint:

- `GET /health/live`: processo vivo.
- `GET /health/ready`: bootstrap, database, schema e store pronti.
- `GET /health/metrics`: metriche Prometheus.

## Servizio standalone

Se non hai già un backend, avvia Accessi come servizio autonomo:

```ts
import { startAccessiService } from 'emilsoftware-utilities/accessi/server';

await startAccessiService({ port: 3000, healthPath: '/health', metrics: true });
```

Oppure:

```bash
npm run accessi:serve
```

Dettagli, systemd e Docker in [standalone-service.md](standalone-service.md).

## Multi-istanza

Con più repliche configura gli store Redis:

- `publicAuthRateLimit.store`
- `serviceTokens.rateLimitStore`
- `consoleEntry.store`
- `sessionRevocation.store`
- `accessTokenRevocation.store`
- `refreshTokenRotation.store`

Senza store condivisi ticket console, revoche e rate limit restano locali al
processo. Vedi [WIKI.md](../WIKI.md#store-condivisi-e-multi-istanza).

## Checklist di produzione

- `mockDemoUser: false`.
- `encryptionKey`, SMTP e chiavi JWT da un secret manager.
- `issuer` e `audience` espliciti e diversi per ambiente.
- `http.trustProxy` corretto per il numero di proxy.
- CORS con origin espliciti.
- Rate limit pubblico e service token configurati.
- Store Redis condivisi in multi-istanza.
- Audit con sink e retention.
- Backup del database e migrazione collaudata.
- `/health/ready` usato dal load balancer.

## Prossimi passi

- [WIKI.md](../WIKI.md#accessioptions-riferimento-completo) per tutte le opzioni.
- [WIKI.md](../WIKI.md#login-locale-e-jwt) per login, 2FA e reset password.
- [WIKI.md](../WIKI.md#authorizeaccessi-middleware) per policy e requisiti.
- [operazioni](../WIKI.md#deploy-del-servizio) per deploy, Redis e sicurezza.
- [multi-tenancy.md](multi-tenancy.md) se devi isolare più clienti.
