# Accessi Module

Documentazione divisa per argomenti, per renderla piu' leggibile e facile da aggiornare.

## Indice

- [Panoramica](docs/overview.md)
- [Configurazione](docs/configuration.md)
- [Autenticazione e autorizzazione](docs/authentication.md)
- [Utenti, ruoli e permessi](docs/users-permissions.md)
- [Aggiornamento database](docs/database-update.md)

## Flussi per gli integratori

- **Bootstrap Express**: chiamare `initializeAccessiModule(app, options)` prima di aprire la porta HTTP. Il middleware esportato `authorizeAccessi` diventa disponibile al termine del bootstrap.
- **Rotta protetta**: applicare `authorizeAccessi` con `accessiRequirement` per verificare JWT, stato utente e grant. Il middleware popola `req.user`; con una policy popola anche `req.userGrants`.
- **Login locale**: usare `POST /api/accessi/auth/login`. Un utente configurato solo SSO riceve `PASSWORD_LOGIN_DISABLED` e il frontend deve avviare il flusso SSO del backend.
- **Login SSO**: il backend valida token, issuer, audience e firma del proprio provider; poi passa solo `{ provider, subject }` a `FederatedAuthService.authenticate`. Accessi non riceve token esterni e resta l'unica fonte per ruoli e grant.
- **Provisioning SSO**: di default lo esegue un superutente tramite le API federate. La self-registration e disabilitata finche `federatedAuthentication.allowSelfRegistration` non viene attivato esplicitamente.
- **Ruoli e grant**: le API `assignRolesToUser`, `assignPermissionsToUser` e l'aggiornamento ruolo sono sostitutive. Inviare quindi la lista completa desiderata, non solo le differenze.

I commenti JSDoc sulle API pubbliche descrivono precondizioni, effetti sul database e compatibilita; Swagger documenta invece il contratto HTTP generato.

## Come leggerla

Se devi integrare il modulo, parti da [Panoramica](docs/overview.md) e poi vai alla sezione che ti serve.

Se stai cercando solo il tema database, leggi direttamente [Aggiornamento database](docs/database-update.md).

## Autenticazione opzionale con codice email

La 2FA per utente, l'accesso con solo codice e la combinazione con SSO sono descritti in [Codici di accesso, 2FA e SSO](docs/two-factor.md). Le impostazioni sono gestibili dalla console e richiedono lo schema Accessi 1.4.0. Il flag 2FA resta disattivo per default.

Per le correzioni su permessi, reset password e log giornalieri: [revisione Accessi e logging](docs/review-accessi-logging.md).
