# Gateway rate limit per Accessi Service

Il rate limit applicativo di Accessi protegge login, 2FA, reset password, console entry e service token. Il gateway/API gateway resta utile per una protezione per IP, connessioni e bot prima che la richiesta raggiunga Node.

Regole consigliate:

- `/api/accessi/auth/*`: soglia bassa, burst contenuto
- `/api/accessi/console/entry/exchange`: soglia bassa
- `/api/accessi/*`: soglia media
- `/accessi/openapi*` e `/accessi/.well-known/jwks.json`: soglia alta o cache CDN

## Nginx

```nginx
limit_req_zone $binary_remote_addr zone=accessi_auth:10m rate=2r/s;
limit_req_zone $binary_remote_addr zone=accessi_api:10m rate=10r/s;
limit_conn_zone $binary_remote_addr zone=accessi_conn:10m;

server {
    # Se Accessi e dietro un proxy/load balancer, configura real_ip
    # prima di usare $binary_remote_addr.

    location /api/accessi/auth/ {
        limit_req zone=accessi_auth burst=10 nodelay;
        limit_conn accessi_conn 20;
        proxy_pass http://accessi_service;
    }

    location /api/accessi/ {
        limit_req zone=accessi_api burst=50 nodelay;
        limit_conn accessi_conn 20;
        proxy_pass http://accessi_service;
    }

    location /accessi/ {
        limit_req zone=accessi_api burst=50 nodelay;
        proxy_pass http://accessi_service;
    }
}
```

## Traefik

```yaml
http:
  middlewares:
    accessi-auth-ratelimit:
      rateLimit:
        average: 2
        burst: 10
        period: 1s
    accessi-api-ratelimit:
      rateLimit:
        average: 10
        burst: 50
        period: 1s
  routers:
    accessi-auth:
      rule: PathPrefix(`/api/accessi/auth/`)
      middlewares: [accessi-auth-ratelimit]
      service: accessi
    accessi-api:
      rule: PathPrefix(`/api/accessi/`) || PathPrefix(`/accessi/`)
      middlewares: [accessi-api-ratelimit]
      service: accessi
```

## Cloudflare

Regole di rate limiting:

- path `/api/accessi/auth/*`: 10 richieste/minuto per IP, azione `managed challenge`
- path `/api/accessi/console/entry/exchange`: 30 richieste/5 minuti per IP
- path `/api/accessi/*`: 300 richieste/minuto per IP, azione `block`
- path `/accessi/.well-known/jwks.json`: cache CDN, limite alto

Aggiungere bot fight mode/WAF secondo il piano disponibile.

## AWS WAF / API Gateway

- rate-based rule: 300 richieste/5 minuti per IP
- scope-down statement: `URI starts with /api/accessi`
- regola più severa su `/api/accessi/auth/*`
- AWS Shield/WAF Bot Control se disponibile

## Rapporto con `edgeRateLimit` della libreria

`edgeRateLimit` e un ultimo livello applicativo:

- usa lo stesso `RateLimitStore` Redis dei rate limit per account;
- copre Accessi anche se il gateway non ha regole specifiche;
- non sostituisce WAF, bot protection, limiti di connessione o protezione DDoS.

In produzione usare entrambi:

```text
Client -> CDN/WAF -> API gateway -> edgeRateLimit Accessi -> rate limit per account
```
