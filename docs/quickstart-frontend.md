# Quickstart: frontend

Questa guida è per SPA, app mobile web o qualsiasi client browser che deve
autenticare l'utente su Accessi e chiamare i backend con il JWT.

Regola principale: il frontend usa **solo** `accessi/client/public`. Non importa
`accessi/server`, `accessi/client/admin` o `accessi/client/service` e non vede
mai il database, `encryptionKey`, SMTP o chiavi JWT.

## Installazione

```bash
npm install emilsoftware-utilities
```

## Configurazione

```ts
import { configureAccessiClient } from 'emilsoftware-utilities/accessi/client/public';

configureAccessiClient({
  baseUrl: 'https://accessi.example.com',
});
```

Se il token cambia nel tempo, usa un provider invece di un valore statico:

```ts
configureAccessiClient({
  baseUrl: 'https://accessi.example.com',
  getToken: () => authStore.getAccessToken(),
});
```

## Login

```ts
import { login } from 'emilsoftware-utilities/accessi/client/public';

const response = await login({ email, password });
const result = response.data.Result;

if (result.challenge?.twoFactorRequired) {
  // Login incompleto: chiedi il codice e chiama verifyTwoFactor.
  return showTwoFactorForm(result.challenge);
}

if (!result.token) {
  // Può succedere con passwordless o configurazioni particolari:
  // leggi result.passwordRequired e completa il flusso richiesto.
  throw new Error('Login incompleto');
}

authStore.setAccessToken(result.token.value);
authStore.setRefreshToken(result.refreshToken?.value ?? null);
```

Campi principali della risposta:

| Campo | Significato |
| --- | --- |
| `Result.token.value` | Access token JWT |
| `Result.token.expiresIn` | Durata in secondi |
| `Result.refreshToken` | Refresh token, se `refreshExpiresIn` è configurato |
| `Result.challenge` | Challenge 2FA: il login non è completo |
| `Result.passwordRequired` | Passo password richiesto dal flusso passwordless |
| `Result.utente` | Profilo utente |
| `Result.userGrants` | Ruoli e abilitazioni per la UI |

## 2FA

```ts
import { verifyTwoFactor, resendTwoFactor } from 'emilsoftware-utilities/accessi/client/public';

const verified = await verifyTwoFactor({
  challengeId: challenge.challengeId,
  code,
});
const result = verified.data.Result;
authStore.setAccessToken(result.token!.value);
authStore.setRefreshToken(result.refreshToken?.value ?? null);
```

La challenge è un identificativo opaco, non un JWT: non usarla come Bearer e non
conservarla come sessione. `resendTwoFactor` rispetta `resendAfterSeconds`.

## Refresh e chiamate ai backend

Il token va inviato ai backend, non solo ad Accessi:

```ts
async function apiFetch(input: RequestInfo, init: RequestInit = {}) {
  const token = authStore.getAccessToken();
  const response = await fetch(input, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${token}` },
  });

  if (response.status !== 401) return response;

  const refreshToken = authStore.getRefreshToken();
  if (!refreshToken) throw new Error('Sessione scaduta');

  const refreshed = await refreshAccessToken({ refreshToken });
  authStore.setAccessToken(refreshed.data.Result.token.value);
  authStore.setRefreshToken(refreshed.data.Result.refreshToken?.value ?? null);

  // Un solo retry: se fallisce di nuovo, torna al login.
  return fetch(input, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${authStore.getAccessToken()}` },
  });
}
```

```ts
import { refreshAccessToken } from 'emilsoftware-utilities/accessi/client/public';
```

Il refresh token ha `typ: "refresh"` e non è accettato dai backend come Bearer.

## Reset password

```ts
import {
  sendPasswordResetEmail,
  resetPassword,
} from 'emilsoftware-utilities/accessi/client/public';

await sendPasswordResetEmail({ email });

// Il token arriva dal link inviato per email.
await resetPassword(tokenFromLink, { newPassword });
```

La password deve avere almeno 8 caratteri, una maiuscola, una minuscola, una
cifra e un carattere speciale. Se non è conforme l'API risponde 400 con
`ACCESSI_WEAK_PASSWORD`.

## Logout e revoca

```ts
import { revokeToken, revokeSessions } from 'emilsoftware-utilities/accessi/client/public';

await revokeToken({});          // revoca il token corrente
await revokeSessions();        // revoca tutte le sessioni dell'utente
authStore.clear();
```

La revoca per token richiede `accessTokenRevocation.store` configurato su Accessi
Service; la revoca di tutte le sessioni richiede `sessionRevocation.store`.

## Console

```ts
import { buildAccessiConsoleUrl } from 'emilsoftware-utilities/accessi/console';

const url = buildAccessiConsoleUrl('https://accessi.example.com', {
  entryTicket: ticket, // da POST /api/accessi/console/entry
});
window.location.assign(url);
```

Il ticket è monouso e dura 60 secondi. Il JWT non va mai nell'URL.

## Più Accessi Service o più tenant

```ts
import { createAccessiPublicClient } from 'emilsoftware-utilities/accessi/client/public';

const milano = createAccessiPublicClient({ baseUrl: 'https://accessi-milano.example.com' });
const roma = createAccessiPublicClient({
  baseUrl: 'https://accessi-roma.example.com',
  token: tokenRoma,
});
```

Le istanze non condividono base URL né token: sono sicure anche con richieste
concorrenti.

## Modalità cookie HttpOnly

Se Accessi Service è configurato con `authCookie`, i token viaggiano in cookie
`HttpOnly` e il browser non li legge da JavaScript. In questa modalità:

- le richieste usano `credentials: 'include'`;
- le richieste `POST`, `PUT`, `PATCH`, `DELETE` inviano `x-csrf-token` letto dal cookie `accessi_csrf`;
- il client generato attiva il comportamento quando `window.__ACCESSI_AUTH_COOKIE__` è `true`;
- non serve conservare il token in `localStorage`.

Dettagli e limiti in [auth-cookies.md](auth-cookies.md).

## Errori

| HTTP / codice | Comportamento consigliato |
| --- | --- |
| 401 `AUTH_TOKEN_MISSING` / `AUTH_TOKEN_INVALID` | Prova refresh; se fallisce, torna al login |
| 401 `AUTH_USER_DISABLED` | Logout e messaggio dedicato |
| 403 `AUTH_INSUFFICIENT_PERMISSIONS` | Non fare logout: mostra permessi insufficienti |
| 403 `AUTH_CSRF_INVALID` | Cookie mode: rileggi il cookie CSRF e ripeti |
| 429 | Rispetta `Retry-After`, non ritentare in loop |
| 503 `AUTH_INTROSPECTION_UNAVAILABLE` / `AUTH_JWKS_UNAVAILABLE` | Riprova con backoff; non cancellare la sessione |

## Sicurezza

- Non mettere JWT, refresh token, ticket console o service token nell'URL, nei log o nei messaggi di errore.
- Non importare mai il client admin o service nel bundle pubblico.
- Valuta token in memoria più refresh in storage sicuro; se non è possibile, usa la modalità cookie HttpOnly.
- Configura CSP e header di sicurezza lato backend.
- Non fidarti dei dati di autorizzazione presenti nel token per decisioni sensibili: il backend deve verificare i grant correnti con introspection.

## Prossimi passi

- [WIKI.md](../WIKI.md#login-refresh-2fa-e-reset-password) per il flusso completo.
- [WIKI.md](../WIKI.md#modalità-cookie-httponly-e-csrf) per cookie e CSRF.
- [auth-cookies.md](auth-cookies.md) per la configurazione server.
- [quickstart-resource-server.md](quickstart-resource-server.md) se stai integrando anche il backend.
