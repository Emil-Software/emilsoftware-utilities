# Esempio Accessi locale

Backend Express minimo che integra solo Accessi dalla copia locale della libreria.
La dipendenza `file:../..` punta direttamente alla root del repository: non pubblica e non scarica il pacchetto da npm.

## Avvio

1. Dalla root eseguire `npm run build`.
2. Entrare in `test/accessi-example` ed eseguire `npm install`.
3. Verificare il file locale `.env`; non viene tracciato da Git. Per ricrearlo usare `.env.example`.
4. Eseguire `npm start`.

Aprire `http://localhost:3001/api/accessi/console` e autenticarsi con un superutente gia presente nel database Accessi.

Swagger e disponibile su `http://localhost:3001/accessi/swagger`; il JSON su `http://localhost:3001/accessi/swagger.json`.

`ACCESSI_FIREBIRD_WIRE_CRYPT` viene passato come valore numerico quando valorizzato. `ACCESSI_FIREBIRD_AUTH_PLUGIN` resta nel file di configurazione per compatibilita con i deployment, ma la versione di `node-firebird` usata dalla libreria non espone quell'opzione e l'esempio lo segnala, senza inviarlo al driver.

## SSO

L'esempio abilita lo schema SSO ma non ne crea automaticamente le tabelle: applicare prima lo script opzionale `src/accessi-module/database-updates/scripts/V1.2.0_federated_auth_optional.sql`, oppure impostare `ACCESSI_FEDERATED_AUTO_UPDATE_SCHEMA=true` solo su un database di prova.

Questo server non espone endpoint che accettano token Azure, Google o Apple. In produzione il backend deve validare il token del provider e invocare `FederatedAuthService.authenticate({ provider, subject })` con i soli identificativi gia verificati.
