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
- `jwtOptions.secret`: segreto JWT
- `jwtOptions.expiresIn`: durata JWT
- `emailOptions`: configurazione SMTP per le mail di reset
- `extensionFieldsOptions`: tabelle esterne opzionali da allegare al login
- `autoUpdateDatabase`: se `false`, disabilita le migrazioni automatiche al boot

## Differenza tra modulo e updater

La configurazione completa serve al modulo `accessi` quando gira dentro il backend.

Lo script di aggiornamento database riusa la stessa struttura `AccessiOptions`, quindi legge anche variabili che non servono direttamente alla migrazione ma che fanno parte della configurazione completa del modulo.

Per il dettaglio vedi [Aggiornamento database](database-update.md).
