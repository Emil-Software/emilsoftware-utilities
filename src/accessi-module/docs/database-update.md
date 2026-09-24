# Aggiornamento e verifica del database Accessi

La libreria richiede lo schema generico **1.5.0** e Firebird **2.5 o successivo**. Lo schema necessario e dichiarato in `database-updates/accessiSchema.ts`; l'updater confronta questa definizione con i metadati reali del database a ogni avvio.

Su Firebird 2.5 i generatori sono creati con `CREATE GENERATOR` (in 2.5 non esiste `CREATE SEQUENCE`), mentre da Firebird 3.0 si usa `CREATE SEQUENCE`. Il resto del DDL, le query e la verifica dei metadati sono comuni: l'updater non usa funzionalita introdotte dopo la 2.5 (niente window function, `RDB$RELATION_TYPE` o `NEXT VALUE FOR`).

## Avvio del modulo

- `autoUpdateDatabase: true` (default): riconcilia gli oggetti mancanti e verifica il risultato prima di completare `onModuleInit()`.
- `autoUpdateDatabase: false`: esegue la stessa verifica in **sola lettura**. Se lo schema non e compatibile, l'inizializzazione fallisce con l'elenco degli oggetti da correggere. Non crea tabelle, non aggiorna versioni e non esegue migrazioni.

Il controllo vale per Nest diretto, `initializeAccessiModule` e `initEmilsoftwareModule`. L'applicazione ospitante deve attendere il bootstrap prima di accettare traffico. Il servizio SSO attende la stessa inizializzazione: non esiste piu un secondo percorso DDL concorrente. `federatedAuthentication.autoUpdateSchema` e deprecato; la configurazione autorevole e `autoUpdateDatabase`. La creazione delle strutture SSO/2FA non abilita queste funzionalita per gli utenti.

La generazione OpenAPI ispeziona soltanto i decorator e non avvia il ciclo di vita del modulo o una connessione al database.

## Database di versioni diverse

La versione registrata non decide quali controlli saltare. Sono gestiti database vuoti, storici, privi di versione o aggiornati solo in parte, anche se riportano gia l'ultima versione.

L'updater:

1. Controlla i tipi esistenti prima di eseguire modifiche. Accetta CHAR/VARCHAR compatibili, stringhe piu lunghe, interi di capacita sufficiente e TIMESTAMP al posto di DATE; verifica i character set espliciti di SSO/2FA.
2. Crea le tabelle e le colonne generiche mancanti. Ripristina i default richiesti e aggiunge NOT NULL dove necessario, usando il default per eventuali valori nulli. Conserva i valori gia impostati, inclusi i flag 2FA e password.
3. Verifica chiavi primarie, riferimenti e regole di cancellazione, check SSO, indici attivi, sequence e trigger necessari. Chiavi e indici equivalenti possono avere nomi diversi. Per i trigger riconosce anche i nomi alternativi quando tabella, evento e operazioni previste sono presenti nel sorgente; non riscrive trigger personalizzati.
4. Porta avanti le sequence degli utenti e dei ruoli se inferiori al massimo identificativo presente, senza azzerarle. Importa nel catalogo SSO soltanto i namespace gia usati dalle identita storiche.
5. Rilegge e verifica lo schema completo. Solo dopo il successo registra `PARAMETRI.AccessiVersion = 1.5.0` (riga con `CODPAR = 'AccessiVersion'`).

Le vecchie chiavi `VersioneDB` e `DBVERSION` restano inalterate: possono appartenere al software ospitante. Una versione **AccessiVersion** piu recente di quella supportata blocca l'aggiornamento, senza tentare downgrade.

## Incompatibilita e aggiornamenti interrotti

L'updater non elimina dati, colonne o vincoli e non converte automaticamente tipi incompatibili. Se manca una colonna obbligatoria senza un default su una tabella popolata, occorre un backfill esplicito. Duplicati, riferimenti orfani, vincoli differenti e trigger personalizzati non riconosciuti richiedono una correzione del DBA; l'errore identifica l'oggetto o l'istruzione SQL coinvolta.

Le operazioni DDL sono progressive, non una transazione unica: un errore puo lasciare parte delle aggiunte applicate, ma non avanza la versione. Dopo la correzione si rilancia lo stesso updater, che riconosce quanto gia esiste. Prima degli aggiornamenti usare un backup e collaudare una copia rappresentativa.

Le chiamate nello stesso processo sono serializzate per database. In presenza di piu backend o container, eseguire la migrazione con **un solo processo**, prima del rollout, poi avviare le istanze con `autoUpdateDatabase: false`. Non eseguire migrazioni DDL concorrenti con traffico applicativo.

## Personalizzazioni applicative

Le migrazioni non creano piu menu RFID, tipi filtro postazione/vettore, colonne macchina o altri campi di dominio, utenti predefiniti o GRANT verso utenti specifici/PUBLIC. Le personalizzazioni gia presenti non vengono cancellate ne sovrascritte.

Il nucleo di `FILTRI` contiene `CODUTE`, `PROG` e `TIPFIL`. I campi legacy aggiuntivi, compresi `IDXPOS`, `CODVET`, `NUMREP` e gli altri campi mappati nel DTO, sono letti e scritti solo quando esistono. Lo stesso vale per `UTENTI_CONFIG.NUMMAC` e `RAGSOCCLI`. Le letture restituiscono null quando una dimensione non e installata; una scrittura valorizzata su una colonna assente produce un errore esplicito prima della modifica del profilo. I valori nulli restituiti dalla console non creano colonne applicative.

L'applicativo deve possedere le migrazioni delle proprie estensioni e dei propri cataloghi. Per altri dati esterni resta disponibile `extensionFieldsOptions`.

## Esecuzione manuale e diagnostica

```bash
npm run db:update:accessi
npm run db:check:accessi
```

Usare `ACCESSI_DB_HOST`, `ACCESSI_DB_PORT`, `ACCESSI_DB_DATABASE`, `ACCESSI_DB_USER`, `ACCESSI_DB_PASSWORD` (sono accettati anche gli alias `ACCESSI_FIREBIRD_*`). Il comando di verifica non modifica il database e restituisce un codice di uscita non zero se incompatibile.

Da un backend:

```ts
await AccessiDatabaseUpdater.run(options); // aggiornamento esplicito
const report = await AccessiDatabaseUpdater.inspectSchema(options); // sola lettura
await AccessiDatabaseUpdater.assertCompatible(options); // solleva errore se incompatibile
```

`docs/accessi.sql` e uno snapshot generico per un database **vuoto**, senza CREATE DATABASE o credenziali. Gli script storici in `database-updates/scripts` documentano i vecchi passaggi e non sono un motore di riconciliazione: su database esistenti usare l'updater. I passaggi esclusivamente applicativi sono mantenuti come file senza operazioni.

## Test

```powershell
$env:ACCESSI_TEST_DB_DIRECTORY = 'C:\percorso\database-test'
$env:ACCESSI_TEST_DB_PORT = '33059'
npm run test:accessi-schema
```

Usare un server Firebird locale dedicato ai test. La suite crea database con nomi univoci e li rimuove al termine; non usa le connessioni degli applicativi. La password SYSDBA di test e configurabile con `ACCESSI_TEST_DB_PASSWORD`. Senza directory di test le prove di integrazione sono segnalate come saltate.

I controlli dei metadati e le operazioni NOT NULL seguono la [documentazione Firebird](https://firebirdsql.org/file/documentation/html/en/refdocs/fblangref30/firebird-30-language-reference.html). I controlli sui trigger sono strutturali e riconoscono le operazioni storiche note: non sostituiscono una revisione di SQL arbitrario aggiunto dall'applicativo.
