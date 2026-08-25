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

## Endpoint correlati

- vedere [Autenticazione e autorizzazione](authentication.md)
- vedere [Configurazione](configuration.md)
