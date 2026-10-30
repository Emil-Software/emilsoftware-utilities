# Rotazione delle chiavi JWT

Accessi firma gli access token (e i refresh token, se abilitati) con una chiave
corrente e pubblica le chiavi pubbliche nella JWKS. La rotazione non deve
invalidare i token gia emessi: durante il rollout la JWKS contiene la chiave
nuova e quelle precedenti, e la verifica accetta entrambe.

Riferimenti:

- `jwtOptions.keyId`, `jwtOptions.previousPublicKeys`, `jwtOptions.onUnknownKeyId`
- `generate-accessi-jwt-keys.cjs` (prima generazione)
- `rotate-accessi-jwt-keys.cjs` (rotazione)

## Modello

| Elemento | Ruolo |
| --- | --- |
| `jwtOptions.privateKey` / `publicKey` | chiave corrente: firma i nuovi token |
| `jwtOptions.keyId` | `kid` pubblicato nell'header e nella JWKS |
| `jwtOptions.previousPublicKeys` | chiavi pubbliche ancora accettate in verifica |
| `ACCESSI_JWT_PREVIOUS_PUBLIC_KEYS` | le stesse chiavi lette da env, in JSON |
| `jwtOptions.onUnknownKeyId` | alert quando un token usa un `kid` sconosciuto |

Senza `keyId`, Accessi usa il fingerprint SHA-256 della chiave pubblica
(`base64url`, primi 16 caratteri). Lo stesso valore viene usato dallo script di
rotazione e dal resource server.

## Configurazione da env

```bash
ACCESSI_JWT_ALGORITHM=RS256
ACCESSI_JWT_PRIVATE_KEY="$(cat jwt-private.pem)"
ACCESSI_JWT_PUBLIC_KEY="$(cat jwt-public.pem)"
ACCESSI_JWT_KEY_ID=2026-10
ACCESSI_JWT_PREVIOUS_PUBLIC_KEYS='[
  { "keyId": "2026-04", "publicKey": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----" }
]'
```

Forme accettate nell'array:

- stringa PEM;
- oggetto `{ "publicKey": "<PEM>", "keyId": "<kid>", "algorithm": "RS256" }`.

`keyId` e `algorithm` sono opzionali. Le sequenze `\n` letterali vengono
convertite in newline, cosi il valore resta su una riga nel secret manager. Un
JSON malformato o una chiave non PEM bloccano il boot (`ACCESSI_JWT_PREVIOUS_KEY_INVALID`),
invece di lasciare token non verificabili in produzione.

Con `HS256` le chiavi precedenti sono ignorate: la rotazione HMAC richiede di
cambiare `jwtOptions.secret`, che invalida tutti i token. Per una rotazione
senza interruzioni usare RS256 o ES256.

## Procedura di rotazione

1. **Genera la nuova coppia** con lo script, passando la chiave corrente come
   precedente:

   ```bash
   npm run accessi:rotate-jwt-keys -- \
     --out ./keys-2026-10 \
     --current-public-key-file ./keys-2026-04/jwt-public.pem \
     --current-key-id 2026-04
   ```

   Lo script scrive `jwt-private.pem`, `jwt-public.pem`, `jwks.json` e
   `rotation.json` (contiene i valori `ACCESSI_*` da mettere nel secret manager).
   Con `--previous-file` o `--previous` importa le chiavi precedenti gia in uso;
   `--retain N` limita quante mantenerne (default 3).

2. **Consumatori con JWKS**: nessuna azione. Al primo token con `kid` nuovo il
   resource server forza un refresh della JWKS (throttle default 5 s,
   `jwt.jwks.minRefreshIntervalMs`) e continua a verificare i token vecchi con le
   chiavi precedenti.

3. **Consumatori con `publicKey` statica**: distribuisci prima la nuova chiave
   pubblica (o passa a `jwt.jwks`), poi cambia la chiave di firma. Chi usa la
   sola chiave statica non puo conoscere in anticipo la chiave nuova.

4. **Deploy di Accessi** con i nuovi valori. La JWKS pubblica subito nuova
   chiave + precedenti, quindi i token emessi prima restano validi.

5. **Verifica il rollout**:

   ```bash
   node scripts/rotate-accessi-jwt-keys.cjs --out ./keys-2026-10 \
     --check https://accessi.example.com/api/accessi/.well-known/jwks.json --only-check
   ```

   Il comando fallisce se un `kid` del documento non e pubblicato. Esegui la
   verifica su ogni istanza dietro il load balancer (o sull'endpoint pubblico)
   prima di considerare conclusa la rotazione.

6. **Rimuovi le chiavi precedenti** solo dopo la durata massima dei token:
   `max(jwtOptions.expiresIn, jwtOptions.refreshExpiresIn)`. Finche restano in
   `previousPublicKeys` i refresh token firmati con la vecchia chiave continuano
   a funzionare.

## Rollback

Se il deploy della nuova chiave va storto, ripristina i valori precedenti di
`privateKey`, `publicKey`, `keyId` e `previousPublicKeys`: i token firmati con la
chiave nuova smettono di essere validi, quelli vecchi tornano a esserlo. Per
questo la vecchia chiave privata va conservata nel secret manager finche la
rotazione non e conclusa.

## Alert su `kid` sconosciuto

Un `kid` assente da chiave corrente e precedenti indica una rotazione incompleta
o un token manomesso. Collega l'evento al tuo sistema di allerta:

```ts
const accessiOptions: AccessiOptions = {
  // ...
  jwtOptions: {
    // ...
    onUnknownKeyId: ({ keyId, algorithm, purpose }) => {
      logger.warn({ keyId, algorithm, purpose }, 'JWT kid sconosciuto');
      metrics.increment('accessi_jwt_unknown_kid');
    },
  },
};

// Resource server con JWKS remoto
const jwtOptions: AccessiResourceServerJwtOptions = {
  jwks: { url: 'https://accessi.example.com/api/accessi/.well-known/jwks.json' },
  onUnknownKeyId: ({ kid, algorithm, source }) => {
    logger.warn({ kid, algorithm, source }, 'kid non presente nella JWKS');
  },
};
```

L'evento non cambia l'esito dell'autenticazione: l'eccezione di un logger o di
un webhook non trasforma un `401` in un `500`.

## Cache e tempi

- La JWKS Accessi risponde con `Cache-Control: public, max-age=300`.
- Il resource server usa `cacheTtlMs` (default 300000) e, su `kid` sconosciuto,
  un solo refresh forzato non piu frequente di `minRefreshIntervalMs` (default
  5000). Un flood di `kid` inventati non puo martellare la JWKS.
- Con CDN o reverse proxy davanti alla JWKS, non impostare un TTL superiore a
  `cacheTtlMs`: la rotazione resterebbe invisibile fino alla scadenza della cache.
