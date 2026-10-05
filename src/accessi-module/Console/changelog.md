# Changelog Accessi

Novità e modifiche rilevanti della libreria `emilsoftware-utilities` (modulo Accessi).

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
