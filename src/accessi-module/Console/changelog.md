# Changelog Accessi

Novità e modifiche rilevanti della libreria `emilsoftware-utilities` (modulo Accessi).

## Non rilasciato

### Cambiamenti
- Console: nuova funzione **Login as** per superutenti e admin. Dalla lista utenti si genera un URL verso l'applicazione scelta con `?loginAsToken=<jwt>`; il token dura 5 minuti, registra l'attore nelle claim `act`/`loginAs` e resta soggetto alla gerarchia ADMIN > SUPER. Endpoint: `POST /api/accessi/user/login-as/:codiceUtente`.
- Console: rimosse le sezioni **Filtri utente** e **Tipi filtro**. I filtri applicativi sono deprecati e non vengono più letti né scritti dalla console; le tabelle restano invariate e la gestione torna manuale sul database.
- Console: le conferme operative (es. "Ruoli aggiornati") ora compaiono come notifiche in alto a destra e scompaiono automaticamente.
- Console: il salvataggio del profilo non invia più i campi della tabella `FILTRI`, evitando payload rifiutati dal backend. `UserService` tocca `FILTRI` solo se il chiamante invia esplicitamente almeno un campo legacy.
- Console: scheda utente riorganizzata. "Indietro" resta nella barra superiore; stato registrazione, disattivazione ed eliminazione definitiva sono in un form coerente "Stato e sicurezza", con icone e tooltip allineati.
- Console: pagina Changelog a larghezza piena, con intestazioni di versione evidenziate e sezioni orizzontali leggibili.
- Seed `npm run accessi:seed-admin`: crea o aggiorna un admin completo (`FLGSUPER = 1` e `FLGADMIN = 1`) e corregge il nome colonna usato in precedenza (`FLGADMIN`).
- Console: la pagina di default nella scheda utente è ora un autocomplete con ricerca. Propone tutte le rotte del catalogo menu, si filtra scrivendo ed è ancora possibile inserire un valore libero.
- Autorizzazioni: i grant effettivi sommano ruoli e permessi diretti prendendo il livello massimo per menu. Un permesso diretto con livello inferiore (o 0) non annulla più il grant del ruolo.
- Ruoli legacy: un menu senza descrizione non viene più scartato e un `TIPABI` mancante viene letto come livello 10, evitando utenti con ruolo ma senza accesso.
- Grant dei ruoli arricchiti con i metadati di navigazione del catalogo menu (`pagina`, icona, gruppo, tipo): il frontend riceve gli stessi campi dei grant diretti e può costruire correttamente menu e rotte.
- Sicurezza: `GET /api/accessi/permission/grants/:codiceUtente` accetta solo un JWT Accessi valido e consente la lettura solo al proprietario o a chi può gestire quel target (gerarchia ADMIN > SUPER). Un superutente non può leggere i grant di un admin.

## 2.0.0-dev.50 (2026-10-15)

### Cambiamenti
- ORM: `Row` e `DbValue` sono i tipi predefiniti di `Orm.query` e `Orm.execute`; `transactionQuery` usa `Row[]`. Gli usi generici non devono più dichiarare `Record<string, unknown>`.
- Build: il contratto OpenAPI generato (`src/accessi-module/openapi/`) è ignorato da Git e viene rigenerato da `npm run generate:accessi-openapi`.

## 2.0.0-dev.49 (2026-10-15)

### Cambiamenti
- Documentazione HTTP rinominata da Swagger a **OpenAPI**: il modulo unificato espone `/accessi/openapi` e `/accessi/openapi.json`; `setupSwagger` usa `/openapi` come default.
- Il path è configurabile tramite `EmilsoftwareOptions.swagger` (utile per far convivere più documentazioni).
- Allineati log di avvio, Wiki e dispatch delle rotte del modulo.
- L'alias storico `<path>-json` resta supportato.

### Note
- I consumer che aprivano `/swagger` o `/accessi/swagger` devono aggiornare l'URL alla nuova documentazione OpenAPI.

## 2.0.0-dev.48 (2026-10-13)

### Correzioni
- `RestUtilities.sendErrorMessage` restituisce status HTTP specifici (400/401/403/4xx/5xx) e codici generici (`VALIDATION_ERROR`, `UNAUTHORIZED`, `FORBIDDEN`, `INTERNAL_ERROR`, `REQUEST_ERROR`), senza usare codici `ACCESSI_*` nel business helper.
- Il messaggio restituito è quello reale dell'eccezione; gli errori testuali di validazione vengono riconosciuti come 400.

## 2.0.0-dev.47 (2026-10-13)

### Correzioni
- Errore schema database reso generico: codice `DATABASE_SCHEMA_OUTDATED` e messaggio senza riferimenti specifici ad Accessi.

## 2.0.0-dev.46 (2026-10-12)

### Correzioni
- `sendBaseResponse` resta retro-compatibile quando il terzo argomento è un tag stringa invece dello status HTTP.
- Gestita la serializzazione dei `bigint`; gli errori di risposta vengono registrati con stack tramite `sendErrorMessage`.
- `AccessiHttpExceptionFilter` registra gli errori con stack per facilitare la diagnosi.

## 2.0.0-dev.45 (2026-10-12)

### Correzioni
- `set-gdpr` e l'aggiornamento di `flagGdpr` sono idempotenti: `UPDATE OR INSERT` su `UTENTI_GDPR` con `MATCHING (CODUTE, DATACC)`.
- Evitate violazioni di chiave primaria e risposte 500 quando il consenso GDPR viene registrato più volte nello stesso giorno.

## 2.0.0-dev.44

### Aggiunte
- Endpoint pubblico `GET /api/accessi/auth/bootstrap-admin/status` (`getAdminBootstrapStatus`): la console mostra la sezione "Crea utente admin" **solo** se `adminBootstrap.enabled` è `true`.

### Correzioni
- Rimossi i caratteri corrotti (mojibake UTF-8 ↔ Windows-1252) da DTO, servizi, controller, console, OpenAPI e client generato (es. "L'email è già associata a un utente Accessi.").

## 2.0.0-dev.43

### Cambiamenti
- Gerarchia dei ruoli formalizzata **ADMIN > SUPER > utente**: un superutente non puo' gestire un admin su `update-user`, `delete-user` (soft e hard), `set-password`, `force-password-reset`, `set-stato`, `assign-roles` e `assign-permissions` (`ensureCanManageTargetUser`, 403 se violato).
- Guard **ultimo admin attivo**: non puo' essere disattivato, bloccato, eliminato o privato del flag Admin (400), per evitare il lockout della console.
- Creazione utente (`create-managed-user` e registrazione pubblica) resa **atomica** rispetto all'invio email: fail-fast se SMTP non configurato e rollback dell'utente creato se l'invio fallisce (`ACCESSI_USER_INVITE_EMAIL_FAILED`).
- Console: form password separato (Invio imposta la password invece di salvare il profilo), scheda utente in sola lettura per target di rango superiore.
- SSO: anche il superutente puo' creare utenti SSO e gestirne identita/policy (`federated-auth/users/*`) sugli utenti non-admin; il catalogo dei provider SSO resta riservato agli admin.
- Coerenza: i filtri utente (`saveFiltriUtente`) rispettano la gerarchia; il flag GDPR impostato dal profilo allinea anche `DATGDPR`; la scheda in sola lettura disabilita anche il collegamento SSO.
- Eliminazione definitiva: se l'utente ha dati collegati (tabelle esterne/FK) risponde 400 con `code: ACCESSI_USER_DELETE_HAS_REFERENCES` e messaggio esplicito, suggerendo il soft delete (la hard delete resta invariata quando non ci sono vincoli).
- Consenso GDPR completo: `update-user` con `flagGdpr` scrive anche la riga storica `UTENTI_GDPR`; in console il pulsante "Registra consenso GDPR" usa `set-gdpr`.
- Console: aggiunto il pulsante "Invia reset password legacy" (super e admin).
- Console: **auto-ingresso dal frontend** tramite ticket monouso (`POST /api/accessi/console/entry` + apertura di `#entry=<ticket>`), senza JWT nell'URL; il ticket e' legato all'utente, dura 60s, e' monouso e lo scambio e' protetto da rate limit (`publicAuthRateLimit.consoleEntry`).

## 2.0.0-dev.42

### Aggiunte
- Gestione dei flag di privilegio dalla console Accessi:
  - un admin può assegnare o togliere sia `FLGADMIN` sia `FLGSUPER`;
  - un superutente senza `FLGADMIN` può gestire solo `FLGSUPER`;
  - i flag sono impostabili in creazione (utente locale o SSO) e in modifica profilo.
- Eliminazione utenti con due modalità:
  - soft delete (`delete-user`, `STAREG=DELETE`) per admin e superutenti;
  - eliminazione definitiva (`delete-user-permanent`, solo admin) che rimuove in transazione utente e record collegati.
- Gestione completa dell'utente dalla console (admin): anagrafica estesa (cellulare, lingua, avatar, metadata JSON), GDPR, scadenza password, tutti i filtri (`FILTRI`) e **impostazione diretta della password** (`POST /api/accessi/user/set-password/:codiceUtente`), senza accesso al database.
- Scritture utente idempotenti: `UTENTI_CONFIG` in `UPDATE OR INSERT ... MATCHING (CODUTE)`; i campi non inviati restano invariati.
- Policy password moderna quando si imposta una password (reset, set-password admin, bootstrap): minimo 8 caratteri con maiuscola, minuscola, cifra e carattere speciale, senza spazi e non comune. In caso di violazione risposta 400 con `code: ACCESSI_WEAK_PASSWORD` e `details`. La policy **non** si applica al login, così le password preesistenti deboli continuano a funzionare.

### Correzioni
- Il backend verifica i flag in base al ruolo dell'utente connesso (`ensurePrivilegeFlagChanges`): inviare un flag non consentito restituisce 403.

## 2.0.0-dev.33

### Cambiamenti
- Rimosse le logiche applicative residue dallo schema Accessi:
  - `MENU_GRP.NOMECAMPO`
  - `UTENTI.ENABLEIA`
  - `UTENTI_CONFIG.PAGDEF`
  - `UTENTI.CELLUTE`
- Telefono canonico: `UTENTI_CONFIG.CELLULARE` (allargato a `VARCHAR(30)`).
- Migrazione automatica: copia `UTENTI.CELLUTE` → `UTENTI_CONFIG.CELLULARE`, poi `DROP` delle colonne obsolete.
- Ruoli chiariti:
  - `FLGSUPER`: superutente, riceve **tutte** le abilitazioni al livello massimo (30) dopo il login; in console vede **solo** la sezione **Utenti**.
  - `FLGADMIN`: accede a **tutta** la console (catalogo, token, SSO, utenti) ma **non** influisce sulle abilitazioni.
- Aggiunta la sezione **Changelog** in console (sotto la Wiki).

### Note
- `FILTRI` e `FILTRI_TIPO` restano invariati (piano di migrazione futuro).
- I backend che usavano i campi rimossi devono gestirli in tabelle proprie.

## 2.0.0-dev.32

### Cambiamenti
- Rimosso il supporto ai flag applicativi in `UTENTI_CONFIG`: `FLGMOP`, `FLGPIANA`, `FLGADDETTI`, `FLGOSPITI`, `FLGPIANARFID`, `FLGCONTA`, `FLGCUBI`, `FLGCICLPASS`, `FLGDIPENDENTI`, `FLGINVENTARI`, `CAUMOV`, `NUMMAC`, `RAGSOCCLI`.
- Rinominata la colonna `FLGADMINCONFIG` in `FLGADMIN` (con copia dei valori e `DROP`).

## 2.0.0-dev.31

### Aggiunte
- Esposizione dei servizi Accessi all'host Express (`getAccessiModuleServices`) per delegare login, SSO e token senza reimplementarli.

### Correzioni
- `UserService.getUsers`: filtri estesi (`codiceUtente[]`, `numRep[]`, `codDipendente`, `cellulare`, `tipFil`, `flagSuper`).

## 2.0.0-dev.24

### Cambiamenti (breaking)
- Chiavi JWT derivate per scopo (`access`, `reset`, `2fa`) e claim `typ` obbligatorio: gli access token precedenti non sono più validi.
- Endpoint Allegati protetti di default.
- Pool di connessioni attivo di default (`poolSize` 5).

### Aggiunte
- Service token macchina-a-macchina (gestione, guard, console).
- CRUD completo dei cataloghi dalla console Accessi.
- Supporto Firebird 2.5 nel migrator e nei test di integrazione.
