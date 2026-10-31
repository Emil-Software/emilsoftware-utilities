# Template di deployment multi-tenant

File pronti da adattare. Non contengono segreti reali: usare `<placeholder>` o
variabili d'ambiente/secret manager.

| Percorso | Uso |
| --- | --- |
| `systemd/accessi-tenant@.service` | unità template, una istanza per tenant |
| `systemd/tenant.secrets.example` | soli segreti, permessi `0600` |
| `docker/docker-compose.yml` | due tenant con volumi config read-only |
| `nginx/accessi-tenants.conf` | routing per host e variante path |
| `traefik/dynamic.yml` | routing host, header e health check |

## Flusso

1. Creare `tenants/<id>.environment.ts` (vedi `docs/multi-tenancy.md`).
2. Validare: `npm run accessi:tenants -- --dir ./tenants --check`.
3. Preparare i segreti fuori dal repository (`/etc/accessi/tenants/<id>.secrets`
   o `secrets/<id>.env` con permessi `0600`).
4. Avviare il processo con `ACCESSI_TENANT_ENVIRONMENT` e, se serve,
   `PORT`/`ACCESSI_TENANT_ID`.
5. Configurare il proxy sull'host o sul path del tenant.
6. Verificare `/health/live`, `/health/ready` e `/health/metrics`.

La porta predefinita è `tenant.port`; `PORT` ha precedenza. I template non
pubblicano le porte interne: il proxy è l'unico punto esposto.

## Variante path

Per `tenant.path = '/acme'` il proxy deve rimuovere `/acme` prima di inoltrare
(vedi `nginx/accessi-tenants.conf` e `traefik/dynamic.yml`). In alternativa
servire ogni tenant su un host dedicato.

## Sicurezza

- Non committare `.secrets`/`secrets/*.env`.
- Montare la cartella configurazione in read-only.
- `read_only: true`, `no-new-privileges`, utente non root (immagine
  personalizzata) e `ProtectSystem=strict` nell'unità systemd.
- Non usare l'header `x-accessi-tenant` dal client: solo il proxy può
  impostarlo, con `allowHeader: true` lato router.
- Un processo per tenant: non condividere `AccessiModule` tra tenant diversi.

La CI esegue `npm run check:deploy` per verificare presenza e coerenza dei
template e l'assenza di segreti.
