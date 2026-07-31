# Aggiornamento Database

Il modulo include un updater idempotente per il database accessi.

## A cosa serve

Serve ad allineare lo schema del database alla versione supportata dal codice.

Le migrazioni sono pensate per essere:

- progressive
- ripetibili
- sicure da rilanciare

## Quando parte

`AccessiDatabaseUpdater` viene eseguito in `onModuleInit()`, salvo che:

- `accessiOptions.autoUpdateDatabase === false`

In quel caso l'aggiornamento automatico viene saltato.

## Come decide cosa applicare

Il flusso e':

1. verifica/crea la tabella `PARAMETRI`
2. legge la versione corrente da `VersioneDB` o `DBVERSION`
3. trova il primo step non ancora applicato
4. esegue gli step in ordine
5. salva la nuova versione dopo ogni step

Se la versione non e' riconosciuta, l'updater prova comunque a rieseguire gli step in modalita' idempotente.

## Versioni gestite

Le versioni presenti nel codice sono:

- `1.0.0 -> 1.1.0`
- `1.1.0 -> 1.1.1`
- `1.1.1 -> 1.1.2`
- `1.1.2 -> 1.1.3`
- `1.1.3 -> 1.1.4`
- `1.1.4 -> 1.1.5`
- `1.1.5 -> 1.1.6`

## Cosa puo' fare uno step

Uno step puo':

- aggiungere colonne
- creare sequence o trigger
- inserire record di configurazione
- aggiornare menu o tipi filtro

## Script standalone

Per aggiornare il database senza avviare il backend:

```bash
npm run db:update:accessi
```

Per usare la versione compilata:

```bash
npm run db:update:accessi:dist
```

### Perche' ci sono tante variabili ambiente

Lo script `runAccessiDbUpdate.ts` ricostruisce un oggetto `AccessiOptions` completo, non solo i parametri del database.

Quindi:

- `ACCESSI_DB_*` servono davvero per connettersi al database
- `ACCESSI_EMAIL_*`, `ACCESSI_JWT_*`, `ACCESSI_CONFIRMATION_*` e simili servono per completare la stessa configurazione usata dal modulo accessi

In altre parole, il tool di update riusa la configurazione del modulo intero.

## Riferimenti

- [Panoramica](overview.md)
- [Configurazione](configuration.md)
