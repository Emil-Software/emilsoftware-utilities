# Multi-tenancy operativa

Accessi supporta più tenant con **un database per tenant** e un processo di
servizio per tenant. La configurazione sta in una cartella di file
`*.environment.ts` tipizzati; la decisione architetturale è in
`docs/adr/0002-multi-tenancy.md`.

## Layout

```
tenants/
  acme.environment.ts
  beta.environment.ts
```

`acme.environment.ts`:

```ts
import type { AccessiTenantEnvironment } from 'emilsoftware-utilities/accessi/server';
import { defineAccessiTenantEnvironment } from 'emilsoftware-utilities/accessi/server';

export default defineAccessiTenantEnvironment({
  tenant: {
    id: 'acme',
    hosts: ['accessi.acme.example.com', '*.acme.example.com'],
    path: '/acme',
    port: 3201,
    enabled: true,
    description: 'Tenant ACME',
  },

  database: {
    host: 'db-acme',
    port: 3050,
    database: '/data/acme.fdb',
    user: 'SYSDBA',
    password: process.env.ACME_DB_PASSWORD!,
  },

  jwt: {
    algorithm: 'RS256',
    secret: process.env.ACME_JWT_SECRET!,
    privateKey: process.env.ACME_JWT_PRIVATE_KEY!,
    publicKey: process.env.ACME_JWT_PUBLIC_KEY!,
    keyId: 'acme-2026-10',
    issuer: 'https://accessi.acme.example.com',
    audience: 'accessi-api',
    expiresIn: '1h',
    refreshExpiresIn: '30d',
  },

  email: {
    host: process.env.ACME_SMTP_HOST!,
    port: 587,
    secure: false,
    requireTLS: true,
    tls: { rejectUnauthorized: true },
    from: 'noreply@acme.example.com',
    auth: {
      user: process.env.ACME_SMTP_USER!,
      pass: process.env.ACME_SMTP_PASSWORD!,
    },
  },

  encryptionKey: process.env.ACME_ENCRYPTION_KEY!,
  confirmationEmailUrl: 'https://accessi.acme.example.com',
  confirmationEmailReturnUrl: 'https://accessi.acme.example.com',
  publicBaseUrl: 'https://accessi.acme.example.com',

  // Opzionali, tutti tipizzati da AccessiTenantEnvironment:
  http: { trustProxy: 1 },
  authCookie: { enabled: true, secure: true, sameSite: 'lax' },
  publicAuthRateLimit: { login: { windowMs: 900_000, maxAttempts: 10 } },
  metrics: { enabled: true, prefix: 'accessi' },
  audit: { retentionDays: 90, logger: true },
} satisfies AccessiTenantEnvironment);
```

Regole:

- `tenant.id` è obbligatorio (minuscole, numeri, `-`, `_`, max 63). Non serve
  derivarlo dal nome file, ma dovrebbe coincidere per leggibilità.
- Almeno uno tra `tenant.hosts` e `tenant.path`.
- `tenant.hosts` accetta host esatti e wildcard `*.example.com`.
- `tenant.path` è un prefisso (`/acme`), non un host.
- Ogni tenant deve avere database, chiave JWT e `encryptionKey` propri. La
  validazione blocca chiavi JWT condivise: un token di un tenant non deve essere
  accettato da un altro.
- I segreti vanno letti da `process.env` o dal secret manager: il file
  `.environment.ts` può essere versionato senza contenere credenziali.
- `store`, `sink`, `match`, `onDocument` e `logger` non sono nel tipo: sono
  oggetti runtime e vanno collegati dal backend ospitante.

Il loader usa **jiti** per eseguire TypeScript anche dal pacchetto compilato:
non serve compilare i file tenant separatamente.

## Validazione

```bash
npm run accessi:tenants -- --dir ./tenants --check
npm run accessi:tenants -- --dir ./tenants --list
npm run accessi:tenants -- --dir ./tenants --resolve accessi.acme.example.com /api/accessi
```

`--check` esce con codice 1 e stampa tutti gli errori (file, campo, duplicati,
chiavi condivise). `--list` stampa un summary **senza segreti**: host, path,
database, issuer, audience, algoritmo e porta.

La validazione avviene prima di aprire qualsiasi connessione: un tenant rotto
non deve avviarsi a metà.

## Avvio

### Supervisore incluso

```bash
npm run accessi:tenants -- --dir ./tenants --serve --base-port 3200
```

Avvia un processo figlio per ogni tenant abilitato:

- `tenant.port` se presente, altrimenti `base-port + indice`;
- passa `PORT`, `ACCESSI_TENANT_ENVIRONMENT` (path assoluto del file) e
  `ACCESSI_TENANT_ID`;
- inoltra `SIGTERM`/`SIGINT` e termina i figli dopo 10 secondi;
- non riavvia automaticamente un figlio: un loop su configurazione rotta è
  peggio di un processo che resta giù; usare systemd/docker/Kubernetes.

Il supervisore legge la cartella all'avvio: **aggiungere o rimuovere un tenant
richiede un riavvio**. Non c'è hot reload (Nest non smonta moduli a caldo).

### systemd (consigliato in produzione)

```ini
# /etc/systemd/system/accessi@.service
[Unit]
Description=Accessi Service tenant %i
After=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/accessi
EnvironmentFile=/etc/accessi/%i.secrets
Environment=ACCESSI_TENANT_ENVIRONMENT=/etc/accessi/tenants/%i.environment.ts
Environment=PORT=3201
ExecStart=/usr/bin/node dist/scripts/startAccessiTenantService.js
Restart=on-failure
RestartSec=5
User=accessi
Group=accessi
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/var/lib/accessi

[Install]
WantedBy=multi-user.target
```

`EnvironmentFile` contiene solo i segreti (`ACME_DB_PASSWORD`, ...), non il
manifest: il manifest tipizzato resta nel file `.environment.ts`.

### Docker Compose

```yaml
services:
  accessi-acme:
    image: emilsoftware/accessi:2
    environment:
      ACCESSI_TENANT_ENVIRONMENT: /config/acme.environment.ts
      PORT: "3201"
    env_file: ./secrets/acme.env
    volumes:
      - ./tenants:/config:ro
    ports:
      - "127.0.0.1:3201:3201"
```

## Template pronti

In `deploy/` ci sono esempi copiabili:

- `deploy/systemd/accessi-tenant@.service` e `tenant.secrets.example`;
- `deploy/docker/docker-compose.yml`;
- `deploy/nginx/accessi-tenants.conf`;
- `deploy/traefik/dynamic.yml`.

La CI esegue `npm run check:deploy` per verificare presenza, coerenza e assenza
di segreti nei template.

## Reverse proxy

Il proxy instrada per host o path e **sovrascrive** l'header tenant se lo usa.
Non fidarsi di un header inviato dal client.

### Nginx (host)

```nginx
map $host $accessi_upstream {
    accessi.acme.example.com  http://127.0.0.1:3201;
    accessi.beta.example.com  http://127.0.0.1:3202;
    default                   http://127.0.0.1:3201;
}

server {
    listen 443 ssl http2;
    server_name accessi.acme.example.com accessi.beta.example.com;
    location / {
        proxy_pass $accessi_upstream;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Traefik (host)

```yaml
http:
  routers:
    acme:
      rule: Host(`accessi.acme.example.com`)
      service: acme
    beta:
      rule: Host(`accessi.beta.example.com`)
      service: beta
  services:
    acme:
      loadBalancer:
        servers:
          - url: http://127.0.0.1:3201
    beta:
      loadBalancer:
        servers:
          - url: http://127.0.0.1:3202
```

### Path

Con `tenant.path = '/acme'`, il proxy deve rimuovere il prefisso prima di
inoltrare (Accessi non lo conosce) oppure il tenant deve essere servito alla
radice:

```nginx
location /acme/ {
    rewrite ^/acme/(.*)$ /$1 break;
    proxy_pass http://127.0.0.1:3201;
}
```

Se si usa la risoluzione via header, impostarlo solo nel proxy:

```nginx
proxy_set_header X-Accessi-Tenant acme;
```

e avviare il router con `allowHeader: true` solo nel servizio che si fida del
proxy.

## Store Redis condivisi

Con Redis condiviso usare l'helper: crea tutti gli store con prefissi
`accessi:<tenantId>:` e li collega alle opzioni.

```ts
import { createAccessiTenantStores } from 'emilsoftware-utilities/accessi/server';

const stores = createAccessiTenantStores({
  tenantId: tenant.id,
  client: redisClient,
  encryptionKey: tenant.options.encryptionKey,
});
const options: AccessiOptions = stores.applyTo(tenant.options);
```

`applyTo` collega `publicAuthRateLimit`, `serviceTokens`,
`sessionRevocation`, `accessTokenRevocation`, `refreshTokenRotation` e
`consoleEntry`, preservando le altre opzioni. I prefissi sono disponibili in
`stores.prefixes`; `getAccessiTenantStorePrefixes(tenantId)` li espone anche
senza creare gli store.

Senza prefisso due tenant condividerebbero rate limit, revoche e refresh: è un
leakage. I test di integrazione Redis verificano l'isolamento.

## Metriche e audit

- Ogni processo espone `/health/metrics` sulla propria porta: Prometheus può
  scrapare per tenant.
- `countAccessiMetric` aggiunge `tenant` quando `options.tenantId` è presente.
- `audit.tenantId` aggiunge `tenant` a ogni record; configurare un sink per
  tenant o un sink condiviso che conserva il label.
- Log: includere `ACCESSI_TENANT_ID` nel formato del logger dell'host.

## Aggiungere, rimuovere, ruotare

**Aggiungere un tenant**

1. Creare `tenants/<id>.environment.ts` con DB e chiavi propri.
2. `npm run accessi:tenants -- --dir ./tenants --check`.
3. Creare il database, eseguire le migrazioni (`db:update:accessi`,
   `db:catalog:accessi`) con la configurazione del tenant.
4. Avviare/riavviare il supervisore o l'unità systemd del tenant.
5. Aggiungere la rotta al proxy e verificare `/health/ready`.

**Rimuovere un tenant**

1. Rimuovere la rotta dal proxy (il traffico si ferma).
2. Impostare `tenant.enabled: false` e riavviare.
3. Conservare database e backup secondo la retention; solo dopo eliminare il
   file `.environment.ts` e i segreti.

**Ruotare le chiavi**

Ogni tenant ha la propria rotazione (`docs/jwt-key-rotation.md`). Non copiare
chiavi tra tenant; la validazione blocca chiavi JWT condivise.

## Migrazione da single-tenant

1. Creare `tenants/<id>.environment.ts` partendo dal `.env` attuale, usando
   `process.env` per i segreti.
2. Validare con `--check`.
3. Avviare il tenant sulla nuova porta mantenendo il servizio vecchio.
4. Verificare login, refresh, JWKS, console, health e metriche sul nuovo.
5. Spostare il DNS/rotta del proxy sul nuovo servizio.
6. Spegnere il vecchio processo e mantenere il rollback per almeno un ciclo di
   token (`max(expiresIn, refreshExpiresIn)`).

Il database non cambia: la migrazione è di configurazione e deployment, non di
schema.

## Limiti

- Un processo per tenant: più RAM, più pool Firebird, più connessioni SMTP.
- Nessun hot reload: aggiunta/rimozione richiede restart.
- Migrazioni e backup per database.
- La risoluzione via header è ammessa solo dietro proxy fidato; il client non
  deve poter scegliere il tenant.
- Un tenant con path `/` senza host non può convivere con altri (validazione).
- I file `.environment.ts` sono eseguiti: trattarli come codice fidato e non
  caricarli da input HTTP.
