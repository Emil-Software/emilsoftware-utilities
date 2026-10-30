# ADR 0002 - Multi-tenancy con database separati

- **Stato**: accettato
- **Data**: 2026-10-30
- **Contesto**: issue #10

## Contesto

Accessi nasce single-tenant: un database Firebird, un issuer JWT, un set di
store e una console. Due tenant richiedono isolamento esplicito di dati, chiavi
e osservabilità. Il modello dati non ha una colonna tenant e tutte le query
assumono un solo insieme di utenti e menu.

Vincoli:

- Firebird/InterBase: non esistono schema o `search_path` per tenant; un
  database separato è l'unità di isolamento naturale.
- Le migrazioni e le seed sono per database.
- `AccessiModule.forRoot` registra una configurazione globale nel contenitore
  Nest: due tenant nello stesso processo condividerebbero DI, audit e logger.
- L'isolamento richiesto dall'issue è "nessun dato o token di un tenant visibile
  a un altro".

## Decisione

**Un database per tenant, nessuna colonna `TENANT`, nessuna modifica allo
schema.** Un tenant è una cartella di configurazione:

```
tenants/
  acme.env
  beta.env
```

Ogni file contiene le normali variabili `ACCESSI_*` già lette da
`createAccessiOptionsFromEnv`, più un manifest minimo:

```dotenv
ACCESSI_TENANT_HOSTS=accessi.acme.example.com,*.acme.example.com
ACCESSI_TENANT_PATH=/acme
ACCESSI_TENANT_PORT=3201
ACCESSI_TENANT_ENABLED=true

ACCESSI_DB_HOST=db-acme
ACCESSI_DB_DATABASE=/data/acme.fdb
ACCESSI_JWT_ISSUER=https://accessi.acme.example.com
ACCESSI_JWT_AUDIENCE=accessi-api
ACCESSI_JWT_SECRET=...
ACCESSI_ENCRYPTION_KEY=...
```

`loadAccessiTenants({ directory })` valida l'intera cartella prima di avviare
qualsiasi cosa:

- `ACCESSI_TENANT_ID` (o nome file) univoco, minuscole/numeri/`-`/`_`;
- almeno host o path; host e path non duplicati;
- chiave JWT distinta per tenant (un token non deve valere su due tenant);
- issuer/audience condivisi producono un warning;
- un tenant con path `/` e senza host non può convivere con altri;
- errori aggregati con nome file, senza stampare segreti.

La risoluzione runtime è **host → path → header**:

1. host esatto o wildcard `*.example.com`;
2. prefisso path più lungo;
3. header `x-accessi-tenant`, **solo** se `allowHeader: true` e quindi solo
   dietro un proxy/API gateway che lo sovrascrive.

Nessun fallback implicito: una richiesta senza tenant valido viene rifiutata
dal router, non servita dal "primo" tenant.

### Processo per tenant

Ogni tenant gira in un **processo Accessi separato** con il proprio environment,
database, pool, chiavi, store Redis e logger. Il supervisore
`node scripts/accessi-tenants.cjs --serve` avvia un figlio per ogni file `.env`
abilitato e passa `PORT`, `ACCESSI_TENANT_ID` e le variabili del file.

Questo evita di condividere:

- `AccessiModule.forRoot` e la DI Nest;
- il registry globale di audit e metriche;
- il pool Firebird e la cache delle migrazioni;
- la chiave JWT e l'issuer.

### Store condivisi

Se più tenant condividono lo stesso Redis, ogni store deve usare un prefisso
diverso:

```ts
const prefix = getAccessiTenantRedisPrefix('acme'); // accessi:acme:
createRedisRateLimitStore({ client, keyPrefix: `${prefix}rate:` });
createRedisSessionRevocationStore({ client, keyPrefix: `${prefix}session:` });
```

La configurazione del tenant espone `options.tenantId`, utile per comporre i
prefissi e per le etichette di metriche e audit.

### Osservabilità

- Metriche: `countAccessiMetric` e `observeAccessiMetric` aggiungono
  automaticamente il label `tenant` quando `options.tenantId` è impostato.
- Audit: `configureAccessiAudit` aggiunge `tenant` a ogni record quando il
  modulo è avviato con `tenantId`.
- Log: il processo figlio ha il proprio `ACCESSI_TENANT_ID`; includerlo nel
  formato del logger dell'host.
- Health: ogni processo espone `/health/live`, `/health/ready` e
  `/health/metrics` sulla propria porta interna.

## Alternative scartate

| Alternativa | Perché no |
| --- | --- |
| Colonna `TENANT` su tutte le tabelle | Migrazione invasiva, rischio di dimenticare un filtro, chiavi primarie e vincoli da rifare. Non necessaria con DB separati. |
| Schema per tenant | Firebird non offre schema/search_path; sarebbe un database separato con altro nome. |
| Due `AccessiModule` nello stesso processo | La configurazione Nest è globale; audit/metriche/logger condividono stato. |
| Selezione tenant da header non fidato | Permetterebbe a un client di cambiare tenant e tentare leakage; consentito solo dietro proxy che sovrascrive l'header. |
| Hot reload dei file `.env` | Nest non smonta moduli a caldo; il riavvio del supervisore è più semplice e sicuro. |

## Conseguenze

Positive:

- isolamento forte: database, chiavi e processi separati;
- nessuna migrazione dello schema esistente;
- aggiunta tenant = nuovo file `.env` + riavvio del supervisore;
- rollback per tenant indipendente.

Negative:

- più processi e pool Firebird da dimensionare;
- migrazioni/seed da eseguire per ogni database;
- backup, monitoring e rotazione chiavi per tenant;
- l'header di risoluzione richiede disciplina sul proxy;
- il supervisore deve essere gestito da systemd/docker/Kubernetes.

## Piano

1. **Fase 1 (questa)**: loader cartella, validazione isolamento, CLI
   `accessi:tenants` (`--check`, `--list`, `--resolve`, `--serve`), documentazione
   e test.
2. **Fase 2**: template systemd/docker e reverse proxy host/path; health check
   per tenant nel supervisore.
3. **Fase 3**: migrazione del deployment single-tenant esistente: creare
   `tenants/<id>.env` dal `.env` attuale, avviare in parallelo, spostare il DNS,
   spegnere il vecchio servizio.
4. **Fase 4 (opzionale)**: router in-process con `createAccessiTenantRouter`
   solo se il costo dei processi diventa un problema e dopo test di leakage
   dedicati; richiede audit/metriche per istanza, non globali.

## Migrazione

Vedi `docs/multi-tenancy.md` per la procedura operativa completa.
