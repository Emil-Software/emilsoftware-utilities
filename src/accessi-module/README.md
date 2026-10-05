# Accessi Module

> **Wiki completa**: [WIKI.md](../../WIKI.md) (indice, esempi corretti e antipattern) · versione compatta per l'IA: [WIKI.ai.md](../../WIKI.ai.md).
> Sono generate da `Console/wiki.ts` e rigenerate con `npm run generate:accessi-wiki`.

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

## Flag di privilegio e gestione utenti

Due flag in `UTENTI_CONFIG` governano l'accesso alla console:

- `FLGSUPER` (`flagSuper`): riceve tutte le abilitazioni al livello massimo (30) dopo il login; vede solo la sezione Utenti.
- `FLGADMIN` (`flagAdmin`): accede a tutta la console (catalogo, token, SSO, utenti) ma non conferisce abilitazioni.

Regole di modifica (applicate dalla console e dal backend):

- un admin puo' assegnare o togliere sia `flagSuper` sia `flagAdmin` (checkbox Admin + Superutente);
- un superutente senza `flagAdmin` puo' gestire solo `flagSuper`;
- i flag si impostano in creazione (utente locale o SSO) e in modifica profilo; inviare un flag non consentito restituisce 403 (`ensurePrivilegeFlagChanges`).

### Controllo completo del profilo (admin)

Dalla scheda utente della console un admin modifica **tutti i campi Accessi** senza toccare il database:

- anagrafica: `nome`, `cognome`, `email`, `cellulare`, `avatar`, `codiceLingua`, `paginaDefault`, `jsonMetadata`;
- sicurezza: `flagDueFattori`, `passwordlessLoginEnabled`, `passwordLoginEnabled`, `dataScadenzaPassword` e **password diretta** (`POST /api/accessi/user/set-password/:codiceUtente`, hash + scadenza, nessuna email);
- privilegi: `flagSuper`, `flagAdmin`; stato: `statoRegistrazione`; GDPR: `flagGdpr`;
- filtri (`FILTRI`): `numRep`, `idxPers`, `codCliSuper`, `codAge`, `codCliCol`, `codClienti`, `tipFil`, `idxPos`, `codDip`, `codVet`;
- ruoli e grant diretti (sezioni dedicate).

Le scritture sono idempotenti (`UPDATE OR INSERT ... MATCHING (CODUTE)` su `UTENTI_CONFIG`) e validate dal backend: inviare il valore corrente non produce effetti collaterali. I campi di sistema (`CODUTE`, `DATINS`, `DATLASTLOGIN`, `KEYREG`) restano gestiti dalla libreria.

### Policy password

Quando si **imposta** una password (reset, `set-password` admin, bootstrap) valgono i requisiti moderni:

- almeno 8 caratteri (massimo 100);
- almeno una maiuscola, una minuscola, una cifra e un carattere speciale;
- nessuno spazio e non deve essere una password comune.

Se non conforme l'API risponde **400** con `code: ACCESSI_WEAK_PASSWORD` e `details` con i requisiti mancanti (`security/passwordPolicy.ts`). La policy **non** si applica al login: le password preesistenti eventualmente deboli continuano ad autenticare e vengono migrate senza blocco (`setPassword(..., { enforcePolicy: false })` nei flussi legacy).

### Eliminazione utenti

- **Soft delete**: `DELETE /api/accessi/user/delete-user/:codiceUtente` imposta `STAREG = DELETE` (reversibile). Disponibile per admin e superutenti.
- **Eliminazione definitiva**: `DELETE /api/accessi/user/delete-user-permanent/:codiceUtente` rimuove in transazione l'utente e i record collegati (`UTENTI_CONFIG`, `UTENTI_PWD`, `UTENTI_OLDPWD`, `UTENTI_GDPR`, `UTENTI_RUOLI`, `ABILITAZIONI`, `FILTRI`, `UTENTI_IDENTITA_EXT`, `ACCESSI_2FA`). Solo admin; non e' consentito eliminare definitivamente il proprio utente.

## Come leggerla

Se devi integrare il modulo, parti da [Panoramica](docs/overview.md) e poi vai alla sezione che ti serve.

Se stai cercando solo il tema database, leggi direttamente [Aggiornamento database](docs/database-update.md).

## Autenticazione opzionale con codice email

La 2FA per utente, l'accesso con solo codice e la combinazione con SSO sono descritti in [Codici di accesso, 2FA e SSO](docs/two-factor.md). Le impostazioni sono gestibili dalla console e richiedono lo schema Accessi corrente 1.5.0, verificato a ogni avvio (vedi [migrazioni](docs/database-update.md)). Il flag 2FA resta disattivo per default.

Per le correzioni su permessi, reset password e log giornalieri: [revisione Accessi e logging](docs/review-accessi-logging.md).
