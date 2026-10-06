# Changelog Accessi

Novità e modifiche rilevanti della libreria `emilsoftware-utilities` (modulo Accessi).

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
