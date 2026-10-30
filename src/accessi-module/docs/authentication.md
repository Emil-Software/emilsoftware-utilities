# Autenticazione E Autorizzazione

Questa sezione copre login, JWT, middleware e controlli sui permessi.

## Login

Il login e' gestito da `AuthController` e `AuthService`.

Flusso principale:

1. cerca l'utente per email
2. verifica lo stato di registrazione
3. cifra la password con `CryptUtilities.encrypt(...)`
4. confronta il valore cifrato con `UTENTI_PWD.PWD`
5. se attivo, controlla la scadenza password
6. carica ruoli, permessi e filtri
7. aggiorna `DATLASTLOGIN`
8. carica eventuali `extensionFields`

## JWT

Il token generato dal login contiene:

```ts
{
  utente: userData.utente
}
```

Il middleware sa recuperare il `codiceUtente` anche da payload legacy.

La risposta di login espone `Result.token.expiresIn` sempre in **secondi** (per esempio `86400` per
`24h`), anche quando `jwtOptions.expiresIn` usa un formato leggibile. Il JWT contiene comunque le
claim standard `iat` ed `exp`.

## Middleware `authenticateGen`

`authenticateGen`:

- legge l'header `Authorization`
- verifica il token JWT
- recupera il codice utente
- se ci sono requisiti, carica i grants e li valuta
- salva il payload decodificato in `req.data`
- salva i grants in `req.userGrants` quando servono

Se il servizio non e' ancora inizializzato, il middleware risponde con `503` o `500` a seconda dello stato del bootstrap.

## Resource server e introspection

Un backend che non possiede il database Accessi non deve usare `authorizeAccessi` con i servizi locali. Usa `emilsoftware-utilities/accessi/resource-server`:

- `createAccessiAuthMiddleware` per Express;
- `createAccessiAuthGuard` per Nest;
- `createAccessiTokenVerifier` per la sola verifica JWT;
- `createAccessiIntrospectionClient` per leggere utente e grant correnti.

L'endpoint `POST /api/accessi/auth/introspect` richiede un service token con scope `accessi:introspect` e restituisce `active`, profilo e grant. Il resource server applica una cache breve ai risultati attivi e fallisce chiuso se Accessi Service non e raggiungibile.

Con RS/ES Accessi pubblica la JWKS su `/accessi/.well-known/jwks.json` (configurabile con `jwtOptions.jwksPath`). La JWKS include la chiave corrente e `previousPublicKeys`, cosi la rotazione non interrompe i token gia emessi. La verifica lato Accessi accetta anch'essa le chiavi precedenti; un token con `kid` sconosciuto produce l'evento `jwtOptions.onUnknownKeyId`. Il resource server aggiorna la cache JWKS al primo `kid` nuovo e segnala i `kid` assenti con `jwt.onUnknownKeyId`. Procedura operativa completa in `docs/jwt-key-rotation.md`.

I ticket di ingresso console sono in memoria per default. In multi-istanza configurare `consoleEntry.store` con `createRedisConsoleEntryStore`: il JWT viene cifrato, il TTL e applicato da Redis e il consume e atomico.

Anche i rate limit sono in memoria per default. In cluster configurare `publicAuthRateLimit.store` e `serviceTokens.rateLimitStore` con `createRedisRateLimitStore`: i contatori diventano condivisi e atomici tra le istanze.

Se un backend fratello valida un provider SSO proprio, può scambiare l'identità verificata con `POST /api/accessi/federated-auth/exchange` e service token scope `accessi:federated:exchange`. Accessi riceve solo `{ provider, subject }`, mai il token del provider.

La revoca sessioni per utente si configura con `sessionRevocation.store` e si attiva con `POST /api/accessi/auth/revoke-sessions` (JWT dell'utente). Il token corrente e tutti quelli emessi prima del cutoff vengono invalidati; i token emessi dopo restano validi. Resource server e guard controllano il cutoff tramite lo stesso store.

Con `jwtOptions.refreshExpiresIn` (es. `30d`) login, 2FA e SSO restituiscono anche `refreshToken`. `POST /api/accessi/auth/refresh` scambia il refresh token con una nuova coppia access+refresh. Il refresh token ha `typ: "refresh"` e non e accettato dai guard API.

Con `authCookie` Accessi puo emettere gli stessi token in cookie `HttpOnly` invece che nel body. In questa modalita il refresh avviene dal cookie, le richieste non sicure richiedono l'header CSRF double-submit e la console funziona senza token in `sessionStorage`. Bearer resta il default invariato; dettagli in `docs/auth-cookies.md`.

Con `refreshTokenRotation.store` il refresh token e monouso: ogni refresh lo consuma e ne emette uno nuovo. Due refresh concorrenti dello stesso token producono un solo successo.

## Requisiti

Il modulo espone un DSL per comporre i controlli:

- `accessiRequirement.permission(menuCode, minPermissionLevel)`
- `accessiRequirement.and(...)`
- `accessiRequirement.or(...)`
- `accessiRequirement.not(...)`
- `accessiRequirement.custom(key, payload?)`

Se usi solo `requirements`, il middleware li converte in una `and` di permessi.

## Livelli abilitazione

Definiti da `TipoAbilitazione`:

- `NESSUNA = 0`
- `LETTURA = 10`
- `SCRITTURA = 20`
- `SPECIAL = 30`

Il controllo confronta `codiceMenu` e `tipoAbilitazione >= soglia`.

## Guard JWT

`JwtSimpleGuard` e' una protezione semplice a livello NestJS.

Viene usato dal `ConfiguratorController` per le rotte di configurazione menu e gruppi. A ogni richiesta ricarica lo stato utente dal database, quindi una revoca (flag, stato, policy) e' immediata.

## Sessione console e auto-ingresso

La console amministrativa (`/api/accessi/console`) usa lo stesso JWT Accessi del frontend. Per entrare senza rifare il login:

1. `POST /api/accessi/console/entry` con `Authorization: Bearer <jwt>` (utente con accesso console) -> `Result.ticket` (monouso, valido 60s).
2. Apri `/api/accessi/console#entry=<ticket>`: la console scambia il ticket con la sessione e entra.

Il JWT non viene mai messo nell'URL; lo scambio (`POST /api/accessi/console/entry/exchange`) e' pubblico, protetto da rate limit (`publicAuthRateLimit.consoleEntry`) e il ticket e' monouso e legato all'utente. Il ticket vive in memoria del processo: con piu' istanze usare sticky session o far completare lo scambio dall'istanza che lo ha emesso. L'accesso richiede `FLGSUPER` o `FLGADMIN`.

Handoff 2FA: il backend puo' reindirizzare a `/api/accessi/console/#two-factor=<challengeId>` per completare la verifica sulla console (fragment opaco, rimosso subito; vedi [Codici di accesso, 2FA e SSO](two-factor.md)).

La gerarchia ADMIN > SUPER e i permessi di gestione sono descritti in [Utenti, ruoli e permessi](users-permissions.md).

## Login as (impersonazione temporanea)

Superutenti e admin possono generare un accesso temporaneo a un utente per entrare in un'altra
applicazione senza conoscerne la password. Dalla console, nella lista utenti, il pulsante **Login as**
apre il pannello con il campo URL e il pulsante "Genera URL di accesso".

Endpoint: `POST /api/accessi/user/login-as/:codiceUtente`

```http
POST /api/accessi/user/login-as/123
Content-Type: application/json
Authorization: Bearer <jwt amministratore>

{ "url": "https://app.example.com/dashboard" }
```

```json
{
  "Result": {
    "loginUrl": "https://app.example.com/dashboard?loginAsToken=eyJ...",
    "token": "eyJ...",
    "expiresInSeconds": 86400,
    "expiresAt": "2026-10-24T14:05:00.000Z"
  }
}
```

- Il token ha la **stessa durata della sessione Accessi standard** (`jwtOptions.expiresIn`) ed e' un access token Accessi con `amr: ["login_as"]`, `loginAs: true` e `act` con l'amministratore che lo ha generato.
- E' accettato da `get-user-by-token` e `authorizeAccessi` anche se l'utente target ha la 2FA attiva: l'attore ha gia' completato l'autenticazione amministrativa.
- Vale la gerarchia **ADMIN > SUPER**: un admin puo' impersonare chiunque, un superutente non puo' impersonare un admin.
- `buildLoginAsUrl(url, token)` (esportata dalla libreria) accetta solo URL assoluti `http`/`https` e conserva query e fragment esistenti.
- Accessi non consuma il token: l'applicazione di destinazione deve leggere `loginAsToken`, validarlo (per esempio con `POST /api/accessi/auth/get-user-by-token` o `authorizeAccessi`) e decidere cosa consentire.
- Il link e' una credenziale: non condividerlo, non salvarlo e non registrarlo nei log.
