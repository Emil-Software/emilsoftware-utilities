# Panoramica

Accessi è il servizio di identità di `emilsoftware-utilities`. Gestisce:

- autenticazione con JWT (HS256 transitorio, RS256/ES256 consigliato);
- autorizzazione basata su menu, ruoli e abilitazioni;
- registrazione, reset password, 2FA e passwordless;
- SSO generico e scambio identità service-to-service;
- accesso temporaneo **Login as** per superutenti e admin;
- filtri utente, menu, gruppi e tipi menu;
- token macchina-a-macchina con scope;
- console amministrativa e aggiornamento automatico dello schema Firebird.

## Ruoli e topologia

La documentazione completa per ruolo è in
[`docs/README.md`](../../../docs/README.md). In sintesi:

- il **backend proprietario** monta `AccessiModule` o chiama
  `initializeAccessiModule` e usa `emilsoftware-utilities/accessi/server`;
- i **backend fratelli** usano `emilsoftware-utilities/accessi/resource-server`
  e non hanno credenziali del database Accessi;
- i **frontend** usano `emilsoftware-utilities/accessi/client/public` e chiamano
  i backend con il JWT Accessi;
- la **console** è centralizzata su Accessi Service.

Quickstart:

- [Servizio](../../../docs/quickstart-service.md)
- [Resource server](../../../docs/quickstart-resource-server.md)
- [Frontend](../../../docs/quickstart-frontend.md)

## Inizializzazione

- `initializeAccessiModule(app, options)` monta Accessi su un'app Express
  esistente.
- `AccessiModule.forRoot(options)` integra Accessi in un'app Nest.
- `startAccessiService(options)` avvia Accessi come servizio autonomo.

`AccessiModule` è `@Global()`: inizializzalo una sola volta per processo. Attendi
sempre il bootstrap prima di aprire la porta HTTP.

## Punti di ingresso utili

- [Configurazione](configuration.md)
- [Autenticazione e autorizzazione](authentication.md)
- [Codici di accesso, 2FA e SSO](two-factor.md)
- [Utenti, ruoli e permessi](users-permissions.md)
- [Aggiornamento database](database-update.md)
- [WIKI completa](../../../WIKI.md)
- [Indice per ruolo](../../../docs/README.md)
