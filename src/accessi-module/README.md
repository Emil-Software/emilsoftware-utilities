# Accessi Module

Modulo NestJS per la gestione degli accessi, autenticazione e autorizzazione degli utenti.

## Configurazione

### File .env
Aggiungere al file `.env` del progetto i seguenti parametri:

```env
# Database Accessi
DB_DATABASE_ACCESSI=percorso_al_db
DB_USERNAME_ACCESSI=SYSDBA
DB_PASSWORD_ACCESSI=xxx
DB_HOST_ACCESSI=xxx.xxx.x.xxx
DB_PORT_ACCESSI=3050

# Email Configuration
MAIL_USER=form@emilsoftware.it
MAIL_PASSWORD=your-password
MAIL_FROM=noreply@emilsoftware.it
MAIL_HOST=smtp.qboxmail.com
MAIL_PORT=465
MAIL_SECURE=true

# Accessi Configuration
ACC_CONFIRMATION_EMAIL_URL=https://mio.sito.it/esgestx
ACC_CONFIRMATION_RETURN_EMAIL_URL=https://mio.sito.it/esgestx/login
ACC_ENCRYPTION_KEY=your-encryption-key
ACC_MOCK_DEMO_USER=true
ACC_JWT_EXPIRES=24h
ACC_JWT_SECRET=your-secret-key
```

Come parametri opzionali ci sono:
```env
ACC_PASSWORD_EXPIRATION = true | false //se non c'è di default è false
ACC_CUSTOM_RESET_PAGE = http://mio.sito.it/#/percorso/pagina 
```



N.B impostando `ACC_CUSTOM_RESET_PAGE` viene completamente sovrascritta `ACC_CONFIRMATION_EMAIL_URL` che serve solemente in caso si voglia utilizzare la pagina che mette a disposizione di defualt la libreria

### db.config.js

Aggiungere

```js
export const accessiModuleOption = {
  confirmationEmailUrl: ENV.ACC_CONFIRMATION_EMAIL_URL,
  confirmationEmailReturnUrl: ENV.ACC_CONFIRMATION_RETURN_EMAIL_URL,
  confirmationEmailPrefix: ENV.CONFIRMATIONEMAILPREFIX,
  databaseOptions: optionsAccessi,
  encryptionKey: ENV.ACC_ENCRYPTION_KEY,
  mockDemoUser: ENV.ACC_MOCK_DEMO_USER,
  jwtOptions: {
    expiresIn: ENV.ACC_JWT_EXPIRES,
    secret: ENV.ACC_JWT_SECRET,
  },
  passwordExpiration: Boolean(ENV.ACC_PASSWORD_EXPIRATION) || false, //abilita o disabilita la scadenza della password
  emailOptions: emailOptions,
  customResetPage: ENV.ACC_CUSTOM_RESET_PAGE || undefined, //se non impostato non premde confirmationMailUrl e usa la pagina della libreria
  extensionFieldsOptions: [] 
};
```

### Server.js
Per inizializzare il modulo all'avvio del backend inserire:
```js
    await initApiServer(); //codice già presente

    await initEmilsoftwareModule(app, {
      accessiOptions: accessiModuleOption,
      allegatiOptions: null,
    });
```

### Creazione Service per Frontend
Una volta inizializzato il modulo per verificare che funzioni correttamente collegarsi a ``` 127.0.0.1:3000/swagger ``` per verificare che tutti gli endpoint siano configurati correttamente e funzionanti.

Se funziona tutto, con il backend attivo, spostarsi nel frontend e creare nella root del progetto il file ``` orval.config.ts ``` all'interno della root del progetto 

```ts
export default {
    api: {
        input: {
            target: 'http://localhost:3000/swagger-json', //indirizzo del file swagger
        },
        output: {
            target: './src/app/Service/orval-esu/orval-esu-services.ts', //cartella in cui crea i suoi file
            schemas: './src/app/Service/orval-esu/models', //cartella in cui crea i suoi modelli
            client: 'angular',
            mode: 'tags-split',
            override: {
                mutator: {
                    //tipo di mutator (nel nostro caso injectBaseUrl)
                    path: './src/app/Service/orval-esu/inject-base-url.ts',
                    name: 'injectBaseUrl',
                    default: true,
                },
            },
        },
        hooks: {
            onCreateOperationName: (operationName: string) => {
                return operationName.replace(/^[a-zA-Z]+Controller/, '');
            },
        },
    },
};
```

Lanciando da terminale il comando ``` npx orval@7.10.0 ``` creera automaticamente dei service in base alla configurazione dello swagger
