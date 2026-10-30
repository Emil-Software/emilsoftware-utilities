# Header di sicurezza e CSP

Accessi applica header di sicurezza alle proprie rotte (`/api/accessi/*`, JWKS e
documentazione OpenAPI). La configurazione avviene in `http.securityHeaders`:

```ts
const accessiOptions: AccessiOptions = {
  // ...
  http: {
    securityHeaders: {
      frameOptions: 'SAMEORIGIN',
      referrerPolicy: 'no-referrer',
      permissionsPolicy: 'camera=(), microphone=(), geolocation=()',
      cacheControl: 'no-store, max-age=0',
      contentSecurityPolicy: {
        reportOnly: false,
        connectSrc: ['https://api.example.com'],
        reportUri: 'https://csp.example.com/report',
        directives: {
          'img-src': ["'self'", 'data:', 'https:'],
        },
      },
    },
  },
};
```

`securityHeaders: false` disabilita tutto; `securityHeaders: true` (o l'omissione)
usa i default. La forma storica booleana resta valida.

## Default

| Header | Valore | Note |
| --- | --- | --- |
| `X-Content-Type-Options` | `nosniff` | sempre presente |
| `X-Frame-Options` | `SAMEORIGIN` | `false` per non inviarlo |
| `Referrer-Policy` | `no-referrer` | `false` per non inviarla |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` | `false` per non inviarla |
| `Cache-Control` (shell console) | `no-store, max-age=0` | `false` per non inviarlo |
| `Content-Security-Policy` | vedi sotto | `false` per disabilitarla |

La shell della console risponde sempre con `Cache-Control: no-store`,
`Referrer-Policy: no-referrer` e `X-Content-Type-Options: nosniff`, anche con
`securityHeaders: false`, per non regredire rispetto alle versioni precedenti.

## Content Security Policy

Direttive di base:

```
default-src 'self'
base-uri 'none'
object-src 'none'
frame-ancestors 'self'
form-action 'self'
img-src 'self' data:
font-src 'self'
style-src 'self'
script-src 'self'
connect-src 'self'
```

La policy cambia per superficie:

- **Console** (`/api/accessi/console*`): i due script inline della shell ricevono
  un nonce casuale per richiesta (`script-src 'self' 'nonce-...'`). Non viene mai
  usato `'unsafe-inline'`. Se la console chiama l'API su un'altra origine, quella
  origine viene aggiunta automaticamente a `connect-src` da
  `consoleApiBaseUrl`.
- **OpenAPI** (`/accessi/openapi*`): la UI Swagger genera script e stili inline a
  runtime, quindi la policy include `'unsafe-inline'` per `script-src` e
  `style-src`. È l'unica eccezione documentata; per rimuoverla impostare
  `contentSecurityPolicy.swaggerUnsafeInline: false` e servire una UI Swagger
  compatibile con nonce/hash.
- **API e JWKS**: policy stretta, senza `'unsafe-inline'`.

`directives` vince sui default: una direttiva impostata a `false` viene rimossa,
altrimenti i valori sostituiscono quelli predefiniti. `connectSrc` aggiunge
origini a `connect-src`; `reportUri` aggiunge `report-uri`.

### Rollout con Report-Only

1. Imposta `contentSecurityPolicy.reportOnly: true` e un `reportUri`.
2. Raccogli le violazioni per almeno un ciclo di utilizzo della console.
3. Aggiungi le origini legittime a `connectSrc` o alle direttive.
4. Passa a `reportOnly: false`.

## Reverse proxy

Accessi non imposta HSTS: va configurato sul terminatore TLS insieme ai
redirect HTTP→HTTPS.

### Nginx

```nginx
location / {
    proxy_pass http://accessi_upstream;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # Non rimuovere gli header CSP inviati da Accessi.
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
}
```

`add_header` di Nginx si aggiunge solo se la risposta non ha già un header con
lo stesso nome: non duplicare `Content-Security-Policy` a questo livello. Se il
proxy deve imporre una policy propria, disattiva quella di Accessi
(`contentSecurityPolicy: false`) e mantieni una sola policy, consapevole che la
console richiede il nonce (il proxy non può generarlo al posto dell'app).

### Traefik

```yaml
http:
  middlewares:
    accessi-headers:
      headers:
        stsSeconds: 31536000
        stsIncludeSubdomains: true
        contentTypeNosniff: true
        referrerPolicy: no-referrer
        customResponseHeaders:
          Permissions-Policy: "camera=(), microphone=(), geolocation=()"
```

Non aggiungere `Content-Security-Policy` in `customResponseHeaders` se Accessi la
invia già: due header CSP vengono applicati come intersezione e la console
smetterebbe di funzionare. Per una policy unica, gestiscila in un solo punto.

### Cloudflare

- Abilita "Always Use HTTPS" e HSTS nelle impostazioni TLS/Edge.
- Se usi Transform Rules per aggiungere header, escludi
  `Content-Security-Policy`: Cloudflare non può generare il nonce della console.
- Verifica che "Email Obfuscation" o altre feature che iniettano script inline
  siano disattivate sulle pagine della console, altrimenti violano la CSP.
- Con Cloudflare davanti alla JWKS, mantieni il TTL della cache allineato a
  `jwt.jwks.cacheTtlMs` (default 300 s): un TTL più alto ritarda la rotazione
  delle chiavi.

## Verifica

```bash
curl -sSI https://accessi.example.com/api/accessi/console | grep -i -E 'content-security|x-frame|referrer|permissions'
```

La CSP della console cambia a ogni risposta per via del nonce: due richieste
consecutive devono restituire policy diverse. Il nonce nell'header deve
coincidere con quello dei due script inline nella pagina.
