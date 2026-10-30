# Multi-tenancy operativa

Accessi supporta più tenant con **un database per tenant** e un processo di
servizio per tenant. La configurazione sta in una cartella di file `.env`; la
decisione architetturale è in `docs/adr/0002-multi-tenancy.md`.

## Layout

```
tenants/
  acme.env
  beta.env
```

`acme.env`:

```dotenv
ACCESSI_TENANT_HOSTS=accessi.acme.example.com,*.acme.example.com
ACCESSI_TENANT_PATH=/acme
ACCESSI_TENANT_PORT=3201
ACCESSI_TENANT_ENABLED=true

ACCESSI_DB_HOST=db-acme
ACCESSI_DB_PORT=3050
ACCESSI_DB_DATABASE=/data/acme.fdb
ACCESSI_DB_USER=SYSDBA
ACCESSI_DB_PASSWORD=...

ACCESSI_PUBLIC_BASE_URL=https://accessi.acme.example.com
ACCESSI_CONFIRMATION_EMAIL_URL=https://accessi.acme.example.com
ACCESSI_CONFIRMATION_RETURN_EMAIL_URL=https://accessi.acme.example.com

ACCESSI_JWT_ALGORITHM=RS256
ACCESSI_JWT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
ACCESSI_JWT_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
ACCESSI_JWT_KEY_ID=acme-2026-10
ACCESSI_JWT_ISSUER=https://accessi.acme.example.com
ACCESSI_JWT_AUDIENCE=accessi-api
ACCESSI_JWT_EXPIRES=1h
ACCESSI_JWT_REFRESH_EXPIRES=30d

ACCESSI_ENCRYPTION_KEY=...32+ caratteri casuali...
ACCESSI_EMAIL_HOST=smtp.acme.example.com
ACCESSI_EMAIL_USER=...
ACCESSI_EMAIL_PASSWORD=...
ACCESSI_EMAIL_FROM=noreply@acme.example.com
```

Regole:

- `ACCESSI_TENANT_ID` è opzionale: se assente vale il nome del file.
- Almeno uno tra `ACCESSI_TENANT_HOSTS` e `ACCESSI_TENANT_PATH`.
- `ACCESSI_TENANT_HOSTS` accetta più host separati da virgola e wildcard
  `*.example.com`.
- `ACCESSI_TENANT_PATH` è un prefisso (`/acme`), non un host.
- Ogni tenant deve avere chiave JWT e database propri. La validazione blocca
  chiavi condivise: un token di un tenant non deve essere accettato da un altro.
- I file contengono segreti: non committarli. Permessi `0600`, secret manager o
  volumi montati a runtime.

## Validazione

```bash
npm run accessi:tenants -- --dir ./tenants --check
npm run accessi:tenants -- --dir ./tenants --list
npm run accessi:tenants -- --dir ./tenants --resolve accessi.acme.example.com /api/accessi
```

`--check` esce con codice 1 e stampa tutti gli errori (file, variabile,
duplicati, chiavi condivise). `--list` stampa un summary **senza segreti**:
host, path, database, issuer, audience, algoritmo e porta.

La validazione avviene prima di aprire qualsiasi connessione: un tenant rotto
non deve avviarsi a metà.

## Avvio

### Supervisore incluso

```bash
npm run accessi:tenants -- --dir ./tenants --serve --base-port 3200
```

Avvia un processo figlio per ogni tenant abilitato:

- `ACCESSI_TENANT_PORT` se presente, altrimenti `base-port + indice`;
- passa `PORT`, `ACCESSI_TENANT_ID` e tutte le variabili del file;
- inoltra `SIGTERM`/`SIGINT` e termina i figli dopo 10 secondi;
- non riavvia automaticamente un figlio: un loop su configurazione rotta è
  peggio di un processo che resta giù; usare systemd/docker/Kubernetes.

Il supervisore legge la cartella all'avvio: **aggiungere o rimuovere un tenant
richiede un riavvio**. Non c'è hot reload (Nest non smonta moduli a caldo).

### systemd (consigliato in produzione)

Un'unità template, una istanza per tenant:

```ini
# /etc/systemd/system/accessi@.service
[Unit]
Description=Accessi Service tenant %i
After=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/accessi
EnvironmentFile=/etc/accessi/tenants/%i.env
Environment=PORT=%i
# assegnare una porta per tenant in un drop-in o in un file separato
ExecStart=/usr/bin/node dist/scripts/startAccessiService.js
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

Con `PORT` derivato dal nome istanza non è possibile: usare un file
`/etc/accessi/ports/%i` o un drop-in `Environment=PORT=3201`. In alternativa
lasciare che il supervisore includa gestisca le porte.

### Docker Compose

```yaml
services:
  accessi-acme:
    image: emilsoftware/accessi:2
    env_file: ./tenants/acme.env
    environment:
      PORT: "3201"
      ACCESSI_TENANT_ID: acme
    volumes:
      - ./secrets/acme:/run/secrets:ro
    ports:
      - "127.0.0.1:3201:3201"

  accessi-beta:
    image: emilsoftware/accessi:2
    env_file: ./tenants/beta.env
    environment:
      PORT: "3202"
      ACCESSI_TENANT_ID: beta
    ports:
      - "127.0.0.1:3202:3202"
```

## Reverse proxy

Il proxy instrada per host o path e **sovrascrive** l'header tenant se lo usa.
Non fidarsi di un header inviato dal client.

### Nginx (host)

```nginx
map $host $accessi_upstream {
    accessi.acme.example.com  http://127.0.0.1:3201;
    accessi.beta.example.com  http://127.0.0.1:3202;
    default                   http://127.0.0.1:3201; # o 444
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

Con `ACCESSI_TENANT_PATH=/acme`, il proxy deve rimuovere il prefisso prima di
inoltrare (Accessi non lo conosce) oppure il tenant deve essere servito alla
radice. Esempio Nginx:

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

e avviare Accessi con `allowHeader: true` solo nel router che si fida del proxy.

## Store Redis condivisi

Con Redis condiviso ogni tenant deve avere un prefisso distinto. Nel codice che
costruisce gli store:

```ts
const prefix = getAccessiTenantRedisPrefix(tenant.id); // accessi:acme:
const options: AccessiOptions = {
  ...tenant.options,
  publicAuthRateLimit: {
    store: createRedisRateLimitStore({ client, keyPrefix: `${prefix}rate:` }),
  },
  sessionRevocation: {
    store: createRedisSessionRevocationStore({ client, keyPrefix: `${prefix}session:` }),
  },
  refreshTokenRotation: {
    store: createRedisRefreshTokenRotationStore({ client, keyPrefix: `${prefix}refresh:` }),
    enabled: true,
  },
  accessTokenRevocation: {
    store: createRedisAccessTokenRevocationStore({ client, keyPrefix: `${prefix}jti:` }),
  },
};
```

Senza prefisso due tenant condividerebbero rate limit, revoche e refresh: è un
leakage. La validazione non può verificarlo (gli store sono codice host), quindi
va testato.

## Metriche e audit

- Ogni processo espone `/health/metrics` sulla propria porta: Prometheus può
  scrapare per tenant oppure usare un label `tenant` aggiunto dai child process.
- `countAccessiMetric` aggiunge `tenant` quando `options.tenantId` è presente.
- `audit.tenantId` aggiunge `tenant` a ogni record; configurare un sink per
  tenant o un sink condiviso che conserva il label.
- Log: includere `ACCESSI_TENANT_ID` nel formato del logger dell'host.

## Aggiungere, rimuovere, ruotare

**Aggiungere un tenant**

1. Creare `tenants/<id>.env` con DB e chiavi propri.
2. `npm run accessi:tenants -- --dir ./tenants --check`.
3. Creare il database, eseguire le migrazioni (`db:update:accessi`,
   `db:catalog:accessi`) con l'env del tenant.
4. Avviare/riavviare il supervisore o l'unità systemd del tenant.
5. Aggiungere la rotta al proxy e verificare `/health/ready`.

**Rimuovere un tenant**

1. Rimuovere la rotta dal proxy (il traffico si ferma).
2. Disabilitare `ACCESSI_TENANT_ENABLED=false` e riavviare.
3. Conservare database e backup secondo la retention; solo dopo eliminare il
   file `.env` e i segreti.

**Ruotare le chiavi**

Ogni tenant ha la propria rotazione (`docs/jwt-key-rotation.md`). Non copiare
chiavi tra tenant; la validazione blocca chiavi JWT condivise.

## Migrazione da single-tenant

1. Copiare il `.env` attuale in `tenants/<id>.env`; aggiungere
   `ACCESSI_TENANT_HOSTS`/`ACCESSI_TENANT_PATH` e `ACCESSI_TENANT_ID`.
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
