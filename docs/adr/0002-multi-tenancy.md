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
  acme.environment.ts
  beta.environment.ts
```

Ogni file esporta un oggetto tipizzato `AccessiTenantEnvironment`; i segreti
possono essere letti da `process.env` o dal secret manager:

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
  },
  database: {
    host: 'db-acme',
    database: '/data/acme.fdb',
    user: process.env.ACME_DB_USER ?? 'SYSDBA',
    password: process.env.ACME_DB_PASSWORD!,
  },
  jwt: {
    secret: process.env.ACME_JWT_SECRET!,
    expiresIn: '1h',
    refreshExpiresIn: '30d',
    issuer: 'https://accessi.acme.example.com',
    audience: 'accessi-api',
  },
  email: {
    host: process.env.ACME_SMTP_HOST!,
    port: 587,
    secure: false,
    requireTLS: true,
    tls: { rejectUnauthorized: true },
    from: 'noreply@acme.example.com',
    auth: { user: process.env.ACME_SMTP_USER!, pass: process.env.ACME_SMTP_PASSWORD! },
  },
  encryptionKey: process.env.ACME_ENCRYPTION_KEY!,
  confirmationEmailUrl: 'https://accessi.acme.example.com',
  confirmationEmailReturnUrl: 'https://accessi.acme.example.com',
} satisfies AccessiTenantEnvironment);
```

`defineAccessiTenantEnvironment` è solo un helper di tipizzazione: non esegue
logica. Il loader usa jiti per eseguire il TypeScript anche nel pacchetto
compilato, quindi non serve compilare i file tenant separatamente.

Campi runtime come `store`, `sink`, `match`, `onDocument` e `logger` sono
volutamente esclusi dal tipo: vanno collegati dal backend ospitante. Il file
tenant descrive solo configurazione serializzabile.

La validazione controlla:

- `tenant.id` (o nome file) univoco, minuscole/numeri/`-`/`_`;
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
`node scripts/accessi-tenants.cjs --serve` avvia un figlio per ogni file `.environment.ts`
abilitato e passa `PORT`, `ACCESSI_TENANT_ENVIRONMENT` (path assoluto) e `ACCESSI_TENANT_ID`.

Questo evita di condividere:

- `AccessiModule.forRoot` e la DI Nest;
- il registry globale di audit e metriche;
- il pool Firebird e la cache delle migrazioni;
- la chiave JWT e l'issuer.

### Store condivisi

Se più tenant condividono lo stesso Redis, ogni store deve usare un prefisso
diverso. `createAccessiTenantStores({ tenantId, client, encryptionKey })` crea
rate limit, revoche, refresh rotation e ticket console con prefissi
`accessi:<tenantId>:` e li collega con `applyTo(options)`. I prefissi restano
personalizzabili con `prefix`/`prefixes`, ma non devono mai coincidere tra
tenant.

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
| Hot reload dei file `.environment.ts` | Nest non smonta moduli a caldo; il riavvio del supervisore è più semplice e sicuro. |

## Conseguenze

Positive:

- isolamento forte: database, chiavi e processi separati;
- nessuna migrazione dello schema esistente;
- aggiunta tenant = nuovo file `.environment.ts` + riavvio del supervisore;
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
   `tenants/<id>.environment.ts` dalla configurazione attuale, avviare in parallelo, spostare il DNS,
   spegnere il vecchio servizio.
4. **Fase 4 (opzionale)**: router in-process con `createAccessiTenantRouter`
   solo se il costo dei processi diventa un problema e dopo test di leakage
   dedicati; richiede audit/metriche per istanza, non globali.

## Migrazione

Vedi `docs/multi-tenancy.md` per la procedura operativa completa.
