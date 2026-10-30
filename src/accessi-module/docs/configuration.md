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
- `sessionRevocation`: store memory/Redis per revocare tutte le sessioni di un utente
- `refreshTokenRotation`: store memory/Redis per rendere il refresh token monouso
- `validateAccessiOptions` / `assertValidAccessiOptions`: validazione fail-fast della configurazione
- `serviceTokens`: token macchina-a-macchina; lo scope `accessi:introspect` abilita l'introspection per i backend fratelli
- `emailOptions`: configurazione SMTP per le mail di reset
- `extensionFieldsOptions`: tabelle esterne opzionali da allegare al login
- `autoUpdateDatabase`: se `false`, disabilita le modifiche automatiche ma verifica comunque lo schema al boot e blocca avvii incompatibili; dettagli in [Aggiornamento database](database-update.md)

## Differenza tra modulo e updater

La configurazione completa serve al modulo `accessi` quando gira dentro il backend.

Lo script di aggiornamento database riusa la stessa struttura `AccessiOptions`, quindi legge anche variabili che non servono direttamente alla migrazione ma che fanno parte della configurazione completa del modulo.

Per il dettaglio vedi [Aggiornamento database](database-update.md).
