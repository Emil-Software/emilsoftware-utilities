# Autenticazione via cookie httpOnly e CSRF

Bearer resta il default: nessun comportamento cambia finché non si abilita
esplicitamente la modalità cookie.

```ts
const accessiOptions: AccessiOptions = {
  // ...
  authCookie: {
    enabled: true,
    secure: true,
    sameSite: 'lax',
  },
};
```

Con `authCookie` presente (e `enabled` diverso da `false`) Accessi:

- invia access e refresh token in cookie `HttpOnly`, con `Max-Age` derivato
  dalla scadenza reale del token;
- non restituisce più i token nel body JSON (salvo `exposeTokens: true`);
- accetta l'access token dal cookie su tutte le rotte Accessi, senza toccare
  guard, middleware e resource server già esistenti;
- emette un cookie CSRF leggibile dal client e richiede il relativo header sulle
  richieste che modificano stato;
- legge il refresh token dal cookie quando il body di `/auth/refresh` è vuoto;
- cancella i cookie a revoca del token corrente o di tutte le sessioni.

## Opzioni

| Opzione | Default | Note |
| --- | --- | --- |
| `enabled` | `true` se l'oggetto è presente | `false` disabilita |
| `secure` | `true` | disattivare solo in sviluppo HTTP |
| `sameSite` | `lax` | `none` richiede `secure: true` |
| `domain` | assente | impostare solo se serve la condivisione tra sottodomini |
| `accessTokenName` | `accessi_access` | |
| `refreshTokenName` | `accessi_refresh` | |
| `csrfTokenName` | `accessi_csrf` | non httpOnly, serve al double-submit |
| `accessPath` | `/api/accessi` | |
| `refreshPath` | `/api/accessi/auth` | |
| `csrfPath` | `/` | |
| `csrfHeaderName` | `x-csrf-token` | case-insensitive |
| `csrf` | `double-submit` | `off` solo con protezione CSRF esterna |
| `exposeTokens` | `false` | `true` reintroduce i token nel body |
| `refreshFromCookie` | `true` | |

I nomi dei tre cookie devono essere validi e distinti: la validazione
fail-fast lo controlla all'avvio.

## Flusso

1. `POST /api/accessi/auth/login` (eventuali passi passwordless/2FA inclusi)
   risponde con i profili utente e i `Set-Cookie` di access, refresh e CSRF.
   `Result.token` e `Result.refreshToken` sono assenti.
2. Il browser chiama le API con `credentials: 'include'`; il middleware copia il
   cookie access nell'header `Authorization` interno, quindi le guard esistenti
   funzionano invariate.
3. Per `POST`, `PUT`, `PATCH` e `DELETE` il client invia
   `x-csrf-token: <valore del cookie accessi_csrf>`. Token mancante o diverso
   produce `403 AUTH_CSRF_INVALID`.
4. `POST /api/accessi/auth/refresh` può essere chiamato con body `{}`: il refresh
   token viene letto dal cookie. I nuovi token ruotano i cookie.
5. `POST /api/accessi/auth/revoke-token` senza `jti` revoca il token corrente e
   cancella i cookie; `revoke-sessions` cancella tutti i cookie dell'utente.

### SPA

```ts
await fetch(`${base}/api/accessi/auth/login`, {
  method: 'POST',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});

const csrf = document.cookie
  .split('; ')
  .find((entry) => entry.startsWith('accessi_csrf='))
  ?.split('=')[1];

await fetch(`${base}/api/accessi/user/set-stato`, {
  method: 'POST',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
  body: JSON.stringify(payload),
});
```

Se la SPA e l'API sono su origini diverse servono `sameSite: 'none'`,
`secure: true`, CORS con `credentials: true` e `X-CSRF-Token` tra gli header
esposti. Il token CSRF è anche restituito nell'header di risposta
`X-CSRF-Token`, così una SPA su altra origine può leggerlo senza accedere al
cookie dell'API. Preferire, quando possibile, la stessa origine dietro un
reverse proxy.

## Endpoint esenti da CSRF

Sono le entry point che non hanno ancora una sessione: login, refresh, verifica e
reinvio 2FA, conferma reset password, invio email di reset, bootstrap admin,
scambio federated e registrazione pubblica. Tutte le altre richieste non sicure
autenticate via cookie richiedono l'header.

Se un host applica già una propria protezione CSRF può impostare `csrf: 'off'`;
la validazione emette il warning `ACCESSI_AUTH_COOKIE_CSRF_DISABLED`.

## Console amministrativa

La shell console riceve dal server i flag `__ACCESSI_AUTH_COOKIE__` e i nomi di
cookie/header CSRF; in modalità cookie usa `credentials: 'include'`, invia il
token CSRF e non richiede un JWT in `sessionStorage`. Il ticket di ingresso
console (`#entry=`) imposta i cookie al posto del token nel body.

## Note operative

- Non impostare `Cache-Control` pubblico sulle risposte di login/refresh: i
  `Set-Cookie` non devono essere condivisi.
- Con HTTPS terminato dal reverse proxy, inoltrare `X-Forwarded-Proto` e
  configurare `http.trustProxy` su Accessi.
- I cookie sono un'alternativa a Bearer, non un'aggiunta: se il client invia
  `Authorization`, quel token vince e il CSRF non viene applicato.
- La revoca per `jti` e la revoca sessioni restano valide anche con cookie: il
  cookie contiene lo stesso JWT emesso in modalità Bearer.
