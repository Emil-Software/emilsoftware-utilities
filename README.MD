Convenzioni per i Commit Message

1. feat:
Descrizione: Nuova feature
Esempio: feat: aggiunta endpoint per notifiche
Trigger: MINOR release (es. 1.3.0 -> 1.4.0)
Su dev: 1.4.0-dev.0

2. fix:
Descrizione: Correzione di bug
Esempio: fix: gestione errore null in login
Trigger: PATCH release (es. 1.3.1)
Su dev: 1.3.1-dev.0

3. BREAKING CHANGE:
Descrizione: Cambiamento che rompe la compatibilità all'indietro
Esempio:
feat!: rimozione supporto legacy
BREAKING CHANGE: cambia lo schema JWT
Trigger: MAJOR release (es. 1.0.0 -> 2.0.0)

4. Altri tipi di commit
Esempi: chore:, docs:, test:, refactor:
Descrizione: Non triggerano una release di default, a meno che non siano configurati esplicitamente nel commit-analyzer.
Esempio: chore: aggiorna dipendenze

5. Forzare una Release
Descrizione: Utile in caso di merge o altre operazioni.
Comandi:
git commit --allow-empty -m "feat: trigger test release"
Poi:
git push origin dev
Oppure:
git push origin main

## Accessi

La documentazione operativa del modulo accessi si trova in [src/accessi-module/README.md](src/accessi-module/README.md).

## Test e qualita

| Comando | Descrizione |
| --- | --- |
| `npm run typecheck` | Typecheck TypeScript in modalita `strict` (piu flag di igiene) |
| `npm run lint` | Lint dependency-free (no `any`, no `@ts-ignore`, no `console.*` fuori dal logger) |
| `npm test` | Typecheck + lint + test unitari |
| `npm run test:unit` | Solo test unitari (`node --test`) |
| `npm run test:coverage` | Test unitari con report e **soglie minime** di copertura |
| `npm run test:integration` | Integration test su Firebird reale (default: porta 3055) |
| `npm run test:integration:fb5` / `:fb3` | Integration test su Firebird 5 / 3 |
| `npm run test:accessi-console` | Test end-to-end della console (richiede un browser Chromium e la build) |

### Integration test su Firebird reale

Avvia i database di test (Firebird 5 sulla 3055, Firebird 3 sulla 3056) e lancia la suite:

```bash
docker compose -f docker-compose.test.yml up -d
npm run test:integration:fb5
npm run test:integration:fb3
docker compose -f docker-compose.test.yml down -v
```

Il database viene creato dal test stesso (`attachOrCreate`) e lo schema costruito dal migrator
della libreria (`AccessiDatabaseUpdater`), quindi gli integration test validano anche migrazione e
compatibilita dello schema. Senza un Firebird raggiungibile i test vengono marcati come `skip`; con
`ACCESSI_TEST_REQUIRE_DB=1` falliscono invece di essere saltati (usato dalla CI).

Variabili: `ACCESSI_TEST_DB_HOST`, `ACCESSI_TEST_DB_PORT`, `ACCESSI_TEST_DB_DATABASE`,
`ACCESSI_TEST_DB_USER`, `ACCESSI_TEST_DB_PASSWORD`, `ACCESSI_TEST_DB_WIRE_CRYPT`,
`ACCESSI_TEST_DB_AUTH_PLUGIN`.

I container usano le porte host **3055** e **3056** per non entrare in conflitto con un Firebird
locale spesso in ascolto sulla 3050. Per cambiare porta/percorso, modifica i mapping in
`docker-compose.test.yml` e passa `ACCESSI_TEST_DB_PORT` / `ACCESSI_TEST_DB_DATABASE`.

La CI (`.github/workflows/ci.yml`) esegue typecheck, test con coverage e build, piu un job di
integration test in matrice su Firebird 5 e 3. Il workflow di release (`publish.yml`) esegue
typecheck e test prima di build e pubblicazione.

## Service token (macchina-a-macchina)

Credenziali di servizio per chiamate tecniche, **non legate a un utente** e senza login giornaliero.
Sostituiscono l'uso di un `secret` nel body: si inviano con `Authorization: Bearer <token>`.

- Formato: `st_<id>.<segreto>`. Il segreto e mostrato **una sola volta** alla creazione/rotazione.
- Storage: tabella `ACCESSI_SERVICE_TOKEN` (schema Accessi, migrazione automatica `1.7.0`). Il segreto e salvato solo come hash SHA-256 e confrontato a tempo costante.
- Metadati e audit: descrizione, scope, creazione/scadenza, ultimo utilizzo con **IP** (`lastUsedIp`), revoca con **autore** (`revokedBy`).
- Rate limit anti-abuso per IP sulla verifica (HTTP 429).
- API amministrative (solo superutente): `POST /api/accessi/service-token`, `GET /api/accessi/service-token` (`includeRevoked=true`), `DELETE /api/accessi/service-token/:tokenId`, `POST /api/accessi/service-token/:tokenId/rotate`.
- Console: sezione **Token di servizio** (crea, ruota, revoca; copia il token una sola volta).
- Utilizzo lato consumer: guard `ServiceTokenGuard` con `@RequireServiceTokenScopes('ia')`; il token verificato e disponibile con `getAccessiServiceToken(req)`.
- Opzione: `serviceTokens: { enabled?: boolean; defaultTtlDays?: number }` in `AccessiOptions`.

```ts
import { Module } from '@nestjs/common';
import { ServiceTokenGuard, RequireServiceTokenScopes } from 'emilsoftware-utilities';

@UseGuards(ServiceTokenGuard)
@RequireServiceTokenScopes('ia')
@Controller('ia')
export class IaController {}
```

## Hardening e opzioni

- I log delle query **non includono i valori dei parametri** (segreti, credenziali, PII). Per riattivare esplicitamente i valori: `logQueryParameters: true` nelle `databaseOptions`.
- Pool di connessioni **attivo di default** (`poolSize` default `5`); `poolSize: 0` disabilita e torna a una connessione per query. Gli script di breve durata devono chiamare `await Orm.closePools()` prima di uscire.
- I JWT sono verificati con algoritmo fissato a `HS256` ed e obbligatoria una scadenza (`expiresIn`) valida.
- **Chiavi JWT separate per scopo** (`access`, `reset`, `2fa`), derivate dal segreto configurato; il claim `typ: 'access'` e **obbligatorio** per gli access token.
- La backdoor mock `admin`/`demo` non e mai attiva quando `NODE_ENV=production`.
- Gli allegati sono **protetti di default**: senza `allegatiOptions.authorize` le richieste rispondono 403. Per la migrazione da versioni precedenti impostare `requireAuthorization: false` (sconsigliato in produzione).
- Upload allegati: limite di 1 file / 90 MB applicato da Multer e validazione dei magic byte oltre al mimetype dichiarato.

## Integrazione

| Scenario | API |
| --- | --- |
| Backend Express esistente | `await initializeAccessiModule(app, accessiOptions)` monta le rotte `/api/accessi` su un host Nest isolato |
| Applicazione NestJS | importa `AccessiModule.forRoot(accessiOptions)` (e/o `AllegatiModule.forRoot(allegatiOptions)`) |
| Accessi + Allegati insieme | `EmilsoftwareModule.forRoot({ accessiOptions, allegatiOptions })` |

Tutta la configurazione e riservata al backend: segreti JWT/SMTP/DB non devono mai raggiungere il browser.

## Riferimento `AccessiOptions`

| Campo | Tipo | Note |
| --- | --- | --- |
| `databaseOptions` | `Options` | Connessione Firebird (`DatabaseUtilities.createOption`). Supporta `logQueryParameters`, `poolSize`, `wireCrypt`, `pluginName`. |
| `confirmationEmailUrl` / `confirmationEmailReturnUrl` | `string` | URL per le email di reset. |
| `customResetPage` / `confirmationEmailPrefix` | `string?` | Pagina di reset personalizzata. |
| `encryptionKey` | `string` | Solo compatibilita/migrazione password legacy cifrate. |
| `mockDemoUser` | `boolean` | Utenti fittizi `admin`/`demo`; **mai** attivi in produzione. |
| `passwordExpiration` / `passwordExpirationDays` | `boolean?` / `number?` | Scadenza password (default 90 giorni). |
| `legacyPasswordMigrationOnStartup` | `boolean?` | Migrazione password legacy al bootstrap (default `true`). |
| `autoUpdateDatabase` | `boolean?` | Riconcilia lo schema al bootstrap (default `true`); con `false` verifica in sola lettura. |
| `jwtOptions` | `{ secret: string; expiresIn: string }` | HS256 con scadenza obbligatoria. |
| `emailOptions` | `EmailOptions` | SMTP per reset e codici 2FA. |
| `publicAuthRateLimit` | `PublicAuthRateLimitOptions?` | Limiti degli endpoint pubblici (default attivi). |
| `publicRegistration` | `{ enabled?: boolean }?` | Registrazione pubblica opt-in. |
| `federatedAuthentication` | `{ enabled?; allowSelfRegistration? }?` | SSO provider-agnostico. |
| `extensionFieldsOptions` | `ExtensionFieldsOptions[]?` | Campi applicativi estesi. |
| `serviceTokens` | `{ enabled?: boolean; defaultTtlDays?: number }?` | Token macchina-a-macchina (default abilitati). |

## Riferimento `AllegatiOptions`

| Campo | Tipo | Note |
| --- | --- | --- |
| `databaseOptions` | `Options` | Connessione Firebird. |
| `authorize` | `(req) => boolean \| Promise<boolean>?` | Controllo di autorizzazione applicato a ogni richiesta; `false` → 403. |
| `requireAuthorization` | `boolean?` | **Default `true`**: senza `authorize` le richieste sono rifiutate con 403 (secure by default). `false` ripristina il comportamento storico (endpoint aperti) durante la migrazione. |

## Contratto risposte ed errori

- Successo generico: `RestUtilities.sendOKMessage` → `{ severity, status, statusCode, message }`.
- Payload: `RestUtilities.sendBaseResponse` → `{ Status: { errorCode, errorDescription }, Result, Message }`.
- Errore: `{ severity: 'error', status, statusCode, code, message, error, details? }`, con `code` stabile (es. `ACCESSI_UNAUTHORIZED`, `ACCESSI_INVALID_CREDENTIALS`, `PASSWORD_EXPIRED`, `ACCESSI_DATABASE_SCHEMA_OUTDATED`, `ACCESSI_SERVICE_TOKEN_RATE_LIMITED`). Lo status deriva dalla `HttpException` (validazione → 400); errori di schema DB → 503. SQL, stack e dati sensibili non vengono mai esposti.

## Migrazioni e schema

- Lo schema Accessi e versionato in `accessiSchema.ts` (`ACCESSI_SCHEMA_VERSION`) e riconciliato in modo **idempotente e ripartibile** da `AccessiDatabaseUpdater` (nessun DDL distruttivo, FK/indici/trigger verificati, sequence avanzate solo in avanti).
- La versione viene aggiornata **solo dopo** `assertCompatible`; su errore la migrazione si puo rieseguire.
- Firebird non rende utilizzabili gli oggetti creati nella stessa transazione, quindi il DDL non e racchiuso in un'unica transazione: la robustezza e data da idempotenza + verifica finale.
- Con `autoUpdateDatabase: false` la libreria verifica lo schema in sola lettura e blocca l'avvio se incompatibile (`AccessiDatabaseUpdater.inspectSchema`).

## Osservabilita

- `Logger` strutturato (console colorata + file JSON giornaliero), condiviso per directory.
- Livello minimo configurabile per istanza (`new Logger(tag, { level: 'info' })`) o globalmente con la variabile `LOG_LEVEL` (default `database` = tutto).
- Redazione automatica dei campi sensibili (`password`, `token`, `secret`, ...) e serializzazione degli `Error` con stack.
- I log delle query non contengono i valori dei parametri (salvo `logQueryParameters: true`).
