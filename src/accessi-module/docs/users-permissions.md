# Utenti, Ruoli E Permessi

Questa sezione copre anagrafica utenti, ruoli, permessi, filtri e configurazione menu.

## Utenti

`UserService` gestisce:

- recupero utenti
- registrazione
- aggiornamento profilo
- soft delete tramite `STAREG = DELETE`
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

Le rotte sono protette da JWT e accessibili agli utenti con `flagSuper` o
`flagAdminConfigurator`.

## Gestione catalogo (CRUD)

`PermissionService` espone la gestione completa del catalogo di configurazione,
riservata al superutente (`ensureSuperUser`). I codici (`CODMNU`, `CODGRP`,
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
