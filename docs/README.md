# Documentazione Accessi

Accessi è il servizio di identità di `emilsoftware-utilities`: autenticazione
JWT, autorizzazione per menu, utenti, ruoli, 2FA, SSO, token macchina-a-macchina
e console amministrativa.

Questa pagina è il punto di partenza. Scegli il tuo ruolo: ogni percorso indica
cosa leggere e quale entry point usare.

## Da dove iniziare

| Sei... | Parti da | Poi leggi |
| --- | --- | --- |
| Sviluppatore frontend | [Quickstart frontend](quickstart-frontend.md) | [WIKI.md](../WIKI.md#login-refresh-2fa-e-reset-password), [auth-cookies.md](auth-cookies.md) |
| Backend che possiede il database Accessi | [Quickstart servizio](quickstart-service.md) | [standalone-service.md](standalone-service.md), [WIKI.md](../WIKI.md#deploy-del-servizio) |
| Backend fratello (resource server) | [Quickstart resource server](quickstart-resource-server.md) | [WIKI.md](../WIKI.md#resource-server-e-introspection), [proxy-ip.md](proxy-ip.md) |
| Console o tool amministrativo | [WIKI.md](../WIKI.md#console-amministrativa) | [WIKI.md](../WIKI.md#utenti), [WIKI.md](../WIKI.md#ruoli-e-permessi) |
| Operations / SRE | [WIKI.md](../WIKI.md#deploy-del-servizio) | [standalone-service.md](standalone-service.md), [metrics.md](metrics.md), [audit.md](audit.md) |
| DBA | [WIKI.md](../WIKI.md#schema-e-aggiornamento-del-database) | [WIKI.md](../WIKI.md#catalog-migrations-sql) |
| Sicurezza / compliance | [WIKI.md](../WIKI.md#hardening-e-checklist-di-sicurezza) | [security-headers.md](security-headers.md), [jwt-key-rotation.md](jwt-key-rotation.md) |
| Multi-tenant | [WIKI.md](../WIKI.md#multi-tenancy-operativa) | [multi-tenancy.md](multi-tenancy.md), [deploy/README.md](../deploy/README.md) |
| Migrazione da V1 o da Accessi embedded | [import-migration.md](import-migration.md) | [WIKI.md](../WIKI.md#versioni-migrazioni-e-deprecazioni) |
| Agente AI | [WIKI.ai.md](../WIKI.ai.md) | [integration-prompt.md](../integration-prompt.md) |

## Come è organizzato il progetto

Accessi ha due livelli distinti:

| Livello | Percorso | Contenuto |
| --- | --- | --- |
| Facciata pubblica | `src/accessi/` | Entry point esportati: `server`, `client`, `contracts`, `resource-server`, `openapi`, `console`, `ui` |
| Implementazione | `src/accessi-service/` | Modulo Nest, controller, service, DTO, database, console, sicurezza, tenancy |

I consumer importano solo `emilsoftware-utilities/accessi/*`. Il codice
applicativo e i dettagli interni vivono in `src/accessi-service/`.
La regola completa è in [conventions.md](conventions.md#layout-di-accessi).

## Entry point

| Import | Quando usarlo |
| --- | --- |
| `emilsoftware-utilities/accessi/server` | Backend che possiede Accessi: modulo Nest, bootstrap Express, updater DB, migrazioni, console, health |
| `emilsoftware-utilities/accessi/resource-server` | Backend fratello: middleware Express, guard Nest, verifica JWT e introspection |
| `emilsoftware-utilities/accessi/client` | Client OpenAPI completo; strumenti interni e compatibilità |
| `emilsoftware-utilities/accessi/client/public` | Solo API pubbliche: login, refresh, 2FA, reset password, registrazione, ticket console |
| `emilsoftware-utilities/accessi/client/admin` | Solo API amministrative: utenti, ruoli, menu, filtri, SSO, schema, audit |
| `emilsoftware-utilities/accessi/client/service` | Solo API service-to-service: service token e introspezione. Mai nel browser |
| `emilsoftware-utilities/accessi/contracts` | Tipi, enum e helper puri browser-safe |
| `emilsoftware-utilities/accessi/contracts/dtos` | DTO Nest con `class-validator`; solo backend |
| `emilsoftware-utilities/accessi/openapi` | `setupOpenApi` e merge del documento OpenAPI |
| `emilsoftware-utilities/accessi/console` | URL console, ticket e handoff 2FA |
| `emilsoftware-utilities/accessi/ui` | Percorsi degli asset Web Component frameworkless |

Il root import `emilsoftware-utilities` e i deep import restano supportati fino
alla prossima major, ma sono legacy. La mappa di migrazione è in
[import-migration.md](import-migration.md).

## Regole non negoziabili

- Un solo Accessi Service possiede database, `encryptionKey`, SMTP, chiavi JWT e console.
- I backend fratelli non hanno credenziali del database Accessi: usano `accessi/resource-server`.
- Non montare `AccessiModule` in due backend puntati allo stesso database.
- In multi-servizio usa RS256/ES256 con JWKS; HS256 con segreto condiviso è solo transitorio.
- Configura `issuer` e `audience` espliciti per ambiente.
- Non inserire JWT, ticket console, service token, password o chiavi nei log e negli URL.
- Service token con lo scope minimo e mai nel browser.
- In multi-istanza configura gli store Redis: ticket, revoche e rate limit devono essere condivisi.
- Le richieste con introspection o JWKS non raggiungibili falliscono chiuse.

## Mappa dei documenti

| Documento | Contenuto | Pubblico |
| --- | --- | --- |
| [WIKI.md](../WIKI.md) | Guida completa generata dalla console: percorsi, bootstrap, configurazione, autenticazione, autorizzazione, frontend, dominio, console, operazioni, FAQ e glossario | Tutti |
| [WIKI.ai.md](../WIKI.ai.md) | Digest compatto in un blocco copiabile | Agenti AI |
| [integration-prompt.md](../integration-prompt.md) | Contesto completo e prompt operativi per backend, frontend e agenti | Integratori e AI |
| [quickstart-service.md](quickstart-service.md) | Bootstrap minimo del servizio che possiede Accessi | Backend owner |
| [quickstart-resource-server.md](quickstart-resource-server.md) | Proteggere un backend fratello | Backend fratelli |
| [quickstart-frontend.md](quickstart-frontend.md) | Login, refresh, 2FA e chiamate ai backend | Frontend |
| [standalone-service.md](standalone-service.md) | Avvio standalone, systemd, health, shutdown | Operations |
| [multi-tenancy.md](multi-tenancy.md) | Tenant, configurazione, supervisore, hot reload, router, store | Operations e architetti |
| [audit.md](audit.md) | Audit persistente, sink, retention, export | Sicurezza e operations |
| [metrics.md](metrics.md) | Metriche Prometheus e alert | Operations |
| [auth-cookies.md](auth-cookies.md) | Cookie HttpOnly, CSRF, CORS | Frontend e backend |
| [security-headers.md](security-headers.md) | Header di sicurezza e CSP | Backend e sicurezza |
| [jwt-key-rotation.md](jwt-key-rotation.md) | Rotazione chiavi e JWKS | Sicurezza e operations |
| [proxy-ip.md](proxy-ip.md) | IP reali, `trust proxy`, rate limit | Operations |
| [gateway-rate-limit.md](gateway-rate-limit.md) | Rate limit al gateway | Operations |
| [redis-load-testing.md](redis-load-testing.md) | Test di carico e concorrenza Redis | Sviluppatori e operations |
| [import-migration.md](import-migration.md) | Migrazione agli entry point e deprecazioni | Integratori |
| [conventions.md](conventions.md) | Naming, layout e pulizia del repository | Contributori |
| [adr/0001-split-package.md](adr/0001-split-package.md) | Decisione sullo split in pacchetti | Architetti |
| [adr/0002-multi-tenancy.md](adr/0002-multi-tenancy.md) | Decisione sulla multi-tenancy | Architetti |

## Compatibilità

- Node.js 18 o superiore.
- Firebird/InterBase 2.5 o superiore.
- Package CommonJS con export map esplicita; gli import ESM funzionano per interop.
- `sideEffects` limitato a root barrel, `firebirdCompat` e bundle console.
- Le versioni `2.0.0-dev.N` sono pubblicate su `@dev`; il merge su `main` produce la stabile.

## Verifiche prima di un rilascio

```bash
npm run typecheck
npm test
npm run build
npm run test:pack
npm run check:naming
npm run check:deploy
npm run check:accessi-openapi
```

Se modifichi intenzionalmente il contratto OpenAPI, aggiorna il fingerprint con
`npm run accessi:update-openapi-fingerprint` e includilo nel commit.
