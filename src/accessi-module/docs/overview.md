# Panoramica

Il modulo `accessi` gestisce:

- autenticazione con JWT
- autorizzazione basata su ruoli e permessi
- registrazione, reset password e GDPR
- accesso temporaneo **Login as** per superutenti e admin
- filtri utente
- abilitazione e disabilitazione di menu e gruppi
- aggiornamento automatico del database

## Inizializzazione

Il modulo si puo' inizializzare in due modi:

- `initializeAccessiModule(app, options)` se vuoi montare solo Accessi su una app Express esistente
- `initEmilsoftwareModule(app, options)` se usi il modulo unificato con eventuali allegati

`AccessiModule` e' `@Global()`, quindi i provider sono disponibili in tutta l'app dopo l'inizializzazione.

In una topologia con piu backend, solo il servizio che possiede il database Accessi deve usare `accessi/server`. Gli altri backend usano `accessi/resource-server` (guard/middleware e introspection) e `accessi/client`. Vedi `integration-prompt.md` nella root del repository.

## Punti di ingresso utili

- [Configurazione](configuration.md)
- [Autenticazione e autorizzazione](authentication.md)
- [Utenti, ruoli e permessi](users-permissions.md)
- [Aggiornamento database](database-update.md)
