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

## Middleware `authenticateGen`

`authenticateGen`:

- legge l'header `Authorization`
- verifica il token JWT
- recupera il codice utente
- se ci sono requisiti, carica i grants e li valuta
- salva il payload decodificato in `req.data`
- salva i grants in `req.userGrants` quando servono

Se il servizio non e' ancora inizializzato, il middleware risponde con `503` o `500` a seconda dello stato del bootstrap.

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
