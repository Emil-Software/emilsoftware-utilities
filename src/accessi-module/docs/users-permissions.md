# Utenti, Ruoli E Permessi

Questa sezione copre anagrafica utenti, flag di privilegio, gerarchia, ruoli, permessi, filtri e configurazione menu.

## Utenti

`UserService` gestisce:

- recupero utenti
- registrazione
- aggiornamento profilo
- soft delete tramite `STAREG = DELETE`
- eliminazione definitiva (hard delete) degli utenti e dei record collegati
- consenso GDPR
- upsert dei filtri

### Stati registrazione

Gli stati validi sono:

- `NULL = 0`
- `INSERT = 5`
- `INVIO = 10`
- `CONF = 20`
- `DELETE = 50`
- `BLOCC = 99`

Nel login:

- `BLOCC` e `DELETE` bloccano l'accesso
- `INVIO` richiede rinnovo password
- solo `CONF` e' considerato valido

## Flag di privilegio

Due flag in `UTENTI_CONFIG` governano l'accesso alla console:

- `FLGSUPER` (`flagSuper`): riceve tutte le abilitazioni al livello massimo (30)
  dopo il login; in console vede solo la sezione Utenti e gestisce utenti, ruoli
  e grant.
- `FLGADMIN` (`flagAdmin`): accede a tutta la console (catalogo, token di
  servizio, SSO e utenti) ma non conferisce abilitazioni.

Regole di modifica, applicate sia dalla console sia dal backend:

- un `flagAdmin` può assegnare o togliere sia `flagAdmin` sia `flagSuper`;
- un superutente senza `flagAdmin` può gestire solo `flagSuper`;
- i flag si possono impostare in creazione (utente locale o SSO) e in
  aggiornamento profilo;
- inviare un flag non consentito restituisce 403 (`ensurePrivilegeFlagChanges`).

## Gerarchia ADMIN > SUPER

Ranghi: admin (2) > superutente (1) > utente comune (0). Un attore gestisce solo
utenti di rango **pari o inferiore** (`ensureCanManageTargetUser`): un superutente
amministra totalmente utenti comuni e superutenti — profilo, password, flag,
ruoli, grant, stato, eliminazione, filtri e identità/utenti SSO — ma **non** può
toccare un admin; un admin gestisce chiunque. Il vincolo è applicato dal backend
su `update-user`, `delete-user` (soft e hard), `set-password`,
`force-password-reset`, `set-stato`, `assign-roles`, `assign-permissions`,
`saveFiltriUtente` e sugli endpoint `federated-auth` per gli utenti (403 se
violato). La gestione del **catalogo provider SSO** resta riservata agli admin.

L'**ultimo admin attivo** non può essere disattivato, bloccato, eliminato o
privato di `flagAdmin`: l'operazione risponde 400 (`assertNotLastActiveAdmin`)
finché non viene promosso un altro admin.

## Controllo completo del profilo (admin)

Dalla scheda utente della console un admin modifica **tutti i campi Accessi**
senza toccare il database:

- anagrafica: `nome`, `cognome`, `email`, `cellulare`, `avatar`,
  `codiceLingua`, `paginaDefault`, `jsonMetadata`;
- sicurezza: `flagDueFattori`, `passwordlessLoginEnabled`,
  `passwordLoginEnabled`, `dataScadenzaPassword` e **password diretta**
  (`POST /api/accessi/user/set-password/:codiceUtente`, hash + scadenza, nessuna
  email);
- privilegi: `flagSuper`, `flagAdmin`; stato: `statoRegistrazione`; GDPR:
  `flagGdpr`;
- filtri (`FILTRI`): `numRep`, `idxPers`, `codCliSuper`, `codAge`, `codCliCol`,
  `codClienti`, `tipFil`, `idxPos`, `codDip`, `codVet`;
- ruoli e grant diretti (sezioni dedicate).

Le scritture sono idempotenti (`UPDATE OR INSERT ... MATCHING (CODUTE)` su
`UTENTI_CONFIG`) e validate dal backend: inviare il valore corrente non produce
effetti collaterali. I campi di sistema (`CODUTE`, `DATINS`, `DATLASTLOGIN`,
`KEYREG`) restano gestiti dalla libreria.

## Policy password

Quando si **imposta** una password (reset, `set-password` admin, bootstrap,
creazione) valgono i requisiti moderni:

- almeno 8 caratteri (massimo 100);
- almeno una maiuscola, una minuscola, una cifra e un carattere speciale;
- nessuno spazio e non deve essere una password comune.

Se non conforme l'API risponde **400** con `code: ACCESSI_WEAK_PASSWORD` e
`details` con i requisiti mancanti (`security/passwordPolicy.ts`). La policy
**non** si applica al login: le password preesistenti eventualmente deboli
continuano ad autenticare e vengono migrate senza blocco
(`setPassword(..., { enforcePolicy: false })` nei flussi legacy).

## Creazione utente

La creazione con invito (`create-managed-user` e registrazione pubblica) è
**atomica** rispetto all'invio email: se SMTP non è configurato fallisce prima di
scrivere, e se l'invio fallisce l'utente creato viene annullato con
`code: ACCESSI_USER_INVITE_EMAIL_FAILED`. In alternativa un admin crea l'utente e
imposta la password dal form dedicato.

## Consenso GDPR

Il pulsante **"Registra consenso GDPR"** della console (endpoint `set-gdpr`)
completa il processo: imposta `FLGGDPR`/`DATGDPR` e scrive la riga storica in
`UTENTI_GDPR`. Anche `flagGdpr` via `update-user` completa il processo con la
stessa riga storica.

## Eliminazione utenti

- **Soft delete** (`DELETE /api/accessi/user/delete-user/:codiceUtente`):
  imposta `STAREG = DELETE` senza cancellare i dati. Disponibile per admin e
  superutenti (`ensureUserManagement`) ed e' reversibile cambiando lo stato.
- **Eliminazione definitiva**
  (`DELETE /api/accessi/user/delete-user-permanent/:codiceUtente`): rimuove in
  transazione utente e record collegati (`UTENTI_CONFIG`, `UTENTI_PWD`,
  `UTENTI_OLDPWD`, `UTENTI_GDPR`, `UTENTI_RUOLI`, `ABILITAZIONI`, `FILTRI`,
  `UTENTI_IDENTITA_EXT`, `ACCESSI_2FA`). Riservata agli admin (`ensureAdmin`);
  non e' consentito eliminare definitivamente il proprio utente. Se l'utente ha
  dati collegati in altre tabelle (per esempio `extensionFieldsOptions` del
  backend) l'operazione fallisce con `code: ACCESSI_USER_DELETE_HAS_REFERENCES`
  e messaggio esplicito: in quel caso usare il soft delete.

## Ruoli E Permessi

Tabelle coinvolte:

- `RUOLI`
- `RUOLI_MNU`
- `UTENTI_RUOLI`
- `ABILITAZIONI`
- `MENU`
- `MENU_GRP`

Regole principali:

- i ruoli hanno una lista di menu con `tipoAbilitazione`
- i permessi diretti dell'utente hanno priorita' nel `grants` finale
- `updateOrInsertRole` crea o aggiorna il ruolo e riscrive i menu associati
- `assignRolesToUser` sostituisce i ruoli dell'utente
- `assignPermissionsToUser` sostituisce i permessi diretti dell'utente

## Filtri

`FiltriService` gestisce:

- `FILTRI_TIPO`
- `FILTRI`

Campi supportati:

- `progressivo`
- `numRep`
- `idxPers`
- `codCliSuper`
- `codAge`
- `codCliCol`
- `codClienti`
- `tipFil`
- `idxPos`
- `codDip`
- `codVet`

Per la logica di salvataggio usa `UPDATE OR INSERT ... MATCHING (CODUTE)`.

## Configurazione Menu

`ConfiguratorService` aggiorna:

- `MENU.FLGENABLED`
- `MENU_GRP.FLGENABLED`

Le rotte sono protette da JWT e accessibili agli utenti con `FLGSUPER` o
`FLGADMIN`.

## Gestione catalogo (CRUD)

`PermissionService` espone la gestione completa del catalogo di configurazione,
riservata agli admin (`ensureAdmin`). I codici (`CODMNU`, `CODGRP`,
`CODTIP`, `TIPFIL`) sono chiavi primarie immutabili: valorizzati in creazione,
passati come path in modifica.

Rotte (`/api/accessi/permission`):

- `GET menu-types` — catalogo tipi menu
- `POST menus` / `PUT menus/:codiceMenu` / `DELETE menus/:codiceMenu`
- `POST menu-groups` / `PUT menu-groups/:codiceGruppo` / `DELETE menu-groups/:codiceGruppo`
- `POST menu-types` / `PUT menu-types/:codiceTipo` / `DELETE menu-types/:codiceTipo`

Vincoli di integrita' applicati prima della delete, per restituire messaggi
amministrativi chiari invece dell'errore di foreign key:

- un menu elimina in transazione anche `ABILITAZIONI` e `RUOLI_MNU` collegati
- un gruppo e' eliminabile solo se non contiene menu
- un tipo menu e' eliminabile solo se nessun menu lo usa

I tipi filtro (`FILTRI_TIPO`) sono gestiti da `FiltriService` con
`POST tipi`, `PUT tipi/:tipFil` e `DELETE tipi/:tipFil`; la delete e' consentita
solo se nessun filtro utente lo referenzia.

La console (`/api/accessi/console/menu-e-gruppi` e `/filtri`) espone gli stessi
CRUD, oltre a modifica/eliminazione di ruoli e provider SSO e alla gestione
dello stato di registrazione utente.

## Endpoint correlati

- vedere [Autenticazione e autorizzazione](authentication.md)
- vedere [Configurazione](configuration.md)
