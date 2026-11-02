# Configurazione

Il modulo non legge direttamente il file `.env`: riceve un oggetto `AccessiOptions`.

## Campi principali

- `databaseOptions`: connessione Firebird/InterBase
- `confirmationEmailUrl`: base URL usata per il reset password
- `customResetPage`: pagina custom che sostituisce il flusso HTML incluso nella libreria
- `confirmationEmailReturnUrl`: URL di ritorno passato alla pagina di reset
- `confirmationEmailPrefix`: prefisso opzionale per il return URL
- `encryptionKey`: chiave usata per cifrare la password
- `mockDemoUser`: abilita gli utenti demo hardcoded `demo` e `admin`
- `passwordExpiration`: abilita il controllo sulla scadenza password
- `jwtOptions.secret`: segreto JWT (obbligatorio anche con algoritmi asimmetrici, per reset e 2FA)
- `jwtOptions.expiresIn`: durata JWT
- `jwtOptions.algorithm`, `issuer`, `audience`, `privateKey`, `publicKey`, `keyId`: firma e verifica degli access token. Default `HS256`; usare RS/ES in una topologia multi-servizio
- `jwtOptions.refreshExpiresIn`: abilita refresh token di lunga durata (es. `30d`)
- `jwtOptions.jwksPath`, `previousPublicKeys`: JWKS pubblica e rotazione chiavi con algoritmi asimmetrici. Le chiavi precedenti sono accettate anche in verifica e leggibili da `ACCESSI_JWT_PREVIOUS_PUBLIC_KEYS`; `onUnknownKeyId` emette l'alert per `kid` non riconosciuti
- `openapi`: path, titolo, descrizione e `enabled` della documentazione OpenAPI
- `consoleEntry.ttlMs`, `consoleEntry.store`: TTL e store condiviso dei ticket console; usare `createRedisConsoleEntryStore` in multi-istanza
- `publicAuthRateLimit.store`, `serviceTokens.rateLimitStore`: rate limit condiviso con `createRedisRateLimitStore` in cluster; default in memoria
- `edgeRateLimit`: limite grossolano per IP davanti alle rotte Accessi, con store condiviso opzionale
- `http`: opzioni CORS, `trustProxy` e header di sicurezza (`securityHeaders`, con CSP a nonce per la console, `'unsafe-inline'` documentato solo per Swagger UI, `Report-Only` e direttive personalizzabili; vedi `docs/security-headers.md`)
- `authCookie`: modalita opzionale con cookie `HttpOnly` e CSRF double-submit; Bearer resta il default. Vedi `docs/auth-cookies.md`
- `metrics`: metriche Prometheus di dominio per login, 2FA, refresh, rate limit, introspection, JWKS, revoche, ticket console e store Redis; `enabled: false` le disattiva, `sink` invia a un sistema esterno. Vedi `docs/metrics.md`
- `audit`: audit persistente con sink Redis/HTTP/callback, redazione di token e segreti, retention e endpoint admin `GET /api/accessi/audit` e `/audit/export`. Vedi `docs/audit.md`
- `tenantId`: identificativo del tenant quando la configurazione arriva da un file `*.environment.ts`; aggiunge il label `tenant` a metriche e audit. Vedi `docs/multi-tenancy.md`
- `sessionRevocation`: store memory/Redis per revocare tutte le sessioni di un utente
- `accessTokenRevocation`: store memory/Redis per revocare singoli access token tramite `jti`
- `refreshTokenRotation`: store memory/Redis per rendere il refresh token monouso e revocare le famiglie sospette
- `validateAccessiOptions` / `assertValidAccessiOptions`: validazione fail-fast della configurazione
- `serviceTokens`: token macchina-a-macchina, TTL, rate limit e scope; `accessi:introspect` abilita l'introspection per i backend fratelli
- `emailOptions`: configurazione SMTP per le mail di reset, 2FA e inviti
- `extensionFieldsOptions`: tabelle esterne opzionali da allegare al login
- `adminBootstrap`: bootstrap del primo admin con token monouso stampato all'avvio; disabilitarlo dopo la creazione
- `publicBaseUrl`, `consoleApiBaseUrl`: URL pubblici per link email e console su dominio separato
- `federatedAuthentication`: provider SSO, self-registration e scambio identità service-to-service
- `publicRegistration`: abilitazione e policy della registrazione pubblica
- `catalogScripts`: migrazioni SQL idempotenti per menu, ruoli e cataloghi applicativi
- `legacyPasswordMigrationOnStartup`: migrazione delle password legacy al primo avvio
- `autoUpdateDatabase`: se `false`, disabilita le modifiche automatiche ma verifica comunque lo schema al boot e blocca avvii incompatibili; dettagli in [Aggiornamento database](database-update.md)

## Differenza tra modulo e updater

La configurazione completa serve al modulo `accessi` quando gira dentro il backend.

Lo script di aggiornamento database riusa la stessa struttura `AccessiOptions`, quindi legge anche variabili che non servono direttamente alla migrazione ma che fanno parte della configurazione completa del modulo.

Per il dettaglio vedi [Aggiornamento database](database-update.md).

## Vedi anche

- [Indice per ruolo](../../../docs/README.md)
- [Quickstart servizio](../../../docs/quickstart-service.md)
- [Deploy e variabili d'ambiente](../../../docs/standalone-service.md)
- [WIKI completa](../../../WIKI.md#accessioptions-riferimento-completo)
