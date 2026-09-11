# Codici di accesso, 2FA e SSO

La verifica email e **opzionale per utente**. Il flag esistente `flagDueFattori` / `UTENTI_CONFIG.FLG2FATT` la abilita; il default resta disattivo. La migrazione non attiva il flag sugli utenti. Eventuali utenti che lo avevano gia attivo iniziano a richiedere il codice.

| Configurazione | Accesso locale | Accesso SSO |
| --- | --- | --- |
| 2FA disattiva | Password, come prima | Provider, come prima |
| 2FA attiva | Password + codice email | Provider + codice email |
| 2FA e `passwordlessLoginEnabled` attivi | Solo codice email, senza chiedere password | Provider + codice email |

`passwordlessLoginEnabled` / `FLGPWDLESS` e una nuova opzione, disattiva per default. Richiede `flagDueFattori=true`. L'accesso con il solo codice e autenticazione tramite possesso della casella email, non due fattori distinti. `passwordLoginEnabled=false` conserva la policy SSO preesistente: da solo non abilita l'accesso tramite email. Solo l'opzione passwordless esplicita aggiunge tale possibilita. Non cambia i collegamenti SSO.

In console: **Utenti → Gestisci → Profilo e accesso → Verifica dell'accesso**. Solo un superutente puo modificare queste policy. Il modulo verifica che l'email sia valida e impedisce la combinazione passwordless senza codice. Disattivando 2FA dalla console si disattiva anche l'opzione passwordless. La modifica delle proprie impostazioni 2FA richiede un nuovo login.

## API di login

`POST /api/accessi/auth/login` accetta `{ "email": "utente@example.com" }` per un primo passo senza password. Restituisce `Result.passwordRequired=true` per gli account che richiedono password, oppure avvia il codice per gli account passwordless. I client esistenti possono continuare a inviare email e password insieme.

Quando serve il codice, il risultato contiene soltanto:

```json
{
  "Result": {
    "challenge": {
      "twoFactorRequired": true,
      "challengeId": "identificativo-opaco-di-64-caratteri-esadecimali",
      "method": "email",
      "expiresAt": "2026-09-11T14:00:00.000Z",
      "resendAfterSeconds": 60
    }
  }
}
```

Il wrapper include anche i normali campi `status`, `statusCode` e `severity`. Fino alla verifica **non sono presenti token, profilo, filtri o grant**. Il challenge non e un JWT e non puo essere usato nell'header Authorization.

- `POST /api/accessi/auth/two-factor/verify`: `{ "challengeId": "...", "code": "012345" }`. Restituisce il normale `LoginResponse`, incluso `Result.token`, solo a verifica completata.
- `POST /api/accessi/auth/two-factor/resend`: `{ "challengeId": "..." }`. Sostituisce il codice e restituisce il challenge; non estende la scadenza e non azzera i tentativi.

Il codice ha 6 cifre, dura 10 minuti, ammette 5 tentativi complessivi e al massimo 3 invii per challenge, distanziati di almeno 60 secondi. Sono consentiti al massimo 5 nuovi challenge per utente ogni 15 minuti. Si aggiungono i limiti HTTP esistenti: `publicAuthRateLimit.twoFactorVerify` e `twoFactorResend` sono configurabili come gli altri endpoint pubblici. I limiti database restano attivi anche disabilitando quelli HTTP.

## Integrazione SSO

Il backend continua a validare il provider esterno e a chiamare `FederatedAuthService.authenticate({ provider, subject })`. Nessun token esterno viene accettato dalle nuove API pubbliche. Quando il flag e disattivo, il risultato resta quello precedente. Quando e attivo, `result.login.challenge` e presente e **`result.token` e assente**:

```ts
const result = await federatedAuthService.authenticate(verifiedIdentity);
if (result.login.challenge) {
  // Restituire il challenge al proprio frontend, che usa two-factor/verify.
  return res.json({ challenge: result.login.challenge });
}
return res.json({ login: result.login, token: result.token });
```

Il backend puo anche indirizzare un amministratore alla console per completare la verifica:

```ts
const challenge = result.login.challenge;
if (challenge) {
  return res.redirect(`/api/accessi/console/#two-factor=${challenge.challengeId}`);
}
```

Il frammento viene rimosso subito dalla console e contiene solo l'identificativo del challenge. La console conserva il JWT solo dopo la verifica. La selezione del provider e il callback SSO restano responsabilita dell'applicazione ospitante.

Prima di emettere il JWT vengono ricontrollati stato utente, email e policy; per SSO anche provider e identita devono essere ancora attivi. Un token emesso prima dell'attivazione della 2FA non supera piu guard, middleware e `get-user-by-token`. I token completati riportano `amr` con `otp` e il metodo iniziale (`password`, `passwordless` o `federated`). La disattivazione di passwordless invalida le sessioni originate con quel metodo.

## Database e posta

La 2FA e stata introdotta nello schema 1.4.0; questa versione della libreria richiede lo schema generico **1.5.0**. L'updater riconcilia le strutture effettive e le verifica a ogni avvio, anche con aggiornamenti automatici disabilitati. Seguire [Aggiornamento database](database-update.md) per installazione, verifica e migrazione. Non e necessario abilitare SSO per usare i codici email.

La posta usa `AccessiOptions.emailOptions`, gia impiegato dal reset password. Il database conserva un HMAC del codice, non il codice in chiaro; `jwtOptions.secret` deve essere uguale fra le istanze del backend. Le scritture condizionali e le transazioni rendono persistenti i tentativi e impediscono il riuso concorrente. I challenge scaduti da oltre un giorno vengono eliminati quando ne viene creato uno nuovo. Non vengono registrati codice o challenge nelle query di log.

Le query `RETURNING` usano colonne senza alias e gestiscono anche la riga con valori NULL quando nessun record viene aggiornato, per compatibilita con [Firebird 2.5](https://firebirdsql.org/file/documentation/chunk/en/refdocs/fblangref25/fblangref25-dml-update.html).

## Verifica

`npm run test:accessi` esegue build e test di regressione. `npm run test:accessi-console` verifica il flusso nel browser con API isolate e un profilo temporaneo; usa Edge su Windows oppure `ACCESSI_TEST_BROWSER` per indicare un altro Chromium. Le prove non inviano email reali e non modificano database applicativi; SMTP e Firebird reali vanno verificati nell'ambiente di collaudo del deployment.
