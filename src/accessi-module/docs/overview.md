# Panoramica

Il modulo `accessi` gestisce:

- autenticazione con JWT
- autorizzazione basata su ruoli e permessi
- registrazione, reset password e GDPR
- filtri utente
- abilitazione e disabilitazione di menu e gruppi
- aggiornamento automatico del database

## Inizializzazione

Il modulo si puo' inizializzare in due modi:

- `initializeAccessiModule(app, options)` se vuoi montare solo Accessi su una app Express esistente
- `initEmilsoftwareModule(app, options)` se usi il modulo unificato con eventuali allegati

`AccessiModule` e' `@Global()`, quindi i provider sono disponibili in tutta l'app dopo l'inizializzazione.

## Punti di ingresso utili

- [Configurazione](configuration.md)
- [Autenticazione e autorizzazione](authentication.md)
- [Utenti, ruoli e permessi](users-permissions.md)
- [Aggiornamento database](database-update.md)
