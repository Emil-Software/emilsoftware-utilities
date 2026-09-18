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
| `npm run typecheck` | Typecheck TypeScript in modalita `strict` |
| `npm test` | Typecheck + test unitari |
| `npm run test:unit` | Solo test unitari (`node --test`) |
| `npm run test:coverage` | Test unitari con report di copertura |
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

## Hardening e opzioni

- I log delle query **non includono i valori dei parametri** (segreti, credenziali, PII). Per riattivare esplicitamente i valori: `logQueryParameters: true` nelle `databaseOptions`.
- Pool di connessioni **opt-in**: `poolSize: n` nelle `databaseOptions`. Default `0`, che mantiene il comportamento storico (una connessione per query).
- I JWT sono verificati con algoritmo fissato a `HS256` ed e obbligatoria una scadenza (`expiresIn`) valida.
- La backdoor mock `admin`/`demo` non e mai attiva quando `NODE_ENV=production`.
- Gli allegati supportano un controllo di autorizzazione **opt-in** tramite `allegatiOptions.authorize`: se definito, ogni richiesta viene accettata solo se la callback restituisce `true` (altrimenti 403). Non definito = comportamento storico.
- Upload allegati: limite di 1 file / 90 MB applicato da Multer e validazione dei magic byte oltre al mimetype dichiarato.
