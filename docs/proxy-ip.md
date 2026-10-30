# IP reali dietro proxy

Rate limit, audit e revoca usano `req.ip`. Se il servizio sta dietro un load balancer o un reverse
proxy, `req.ip` e l'indirizzo del proxy finche `http.trustProxy` non e configurato correttamente:

- tutti i client finiscono nello stesso bucket → il rate limit blocca utenti legittimi;
- oppure un header non fidato diventa la chiave → il rate limit si aggira cambiando
  `X-Forwarded-For` a ogni richiesta;
- i log di audit riportano l'IP del proxy invece del client.

`http.trustProxy` viene applicato sia all'host sia al sotto-app Accessi (`app.set('trust proxy', …)`)
e accetta la stessa sintassi di Express: `false`, numero di hop, `true`, `'loopback'`, CIDR.

## Valore consigliato

| Deploy | `http.trustProxy` | Note |
| --- | --- | --- |
| Servizio esposto direttamente | `false` (default) | `X-Forwarded-For` viene ignorato: nessun bypass via header |
| Un proxy davanti (Nginx, Traefik, ALB) | `1` | Il proxy deve **accodare** l'IP reale in `X-Forwarded-For` |
| Due proxy (Cloudflare + Nginx, CDN + ingress) | `2` | Contare solo i proxy che il servizio vede davvero |
| Solo proxy locali | `'loopback'` | Fidarsi di `127.0.0.1`/`::1`, non di altre reti |
| Rete privata dedicata ai proxy | `'loopback, 10.0.0.0/8'` | Elencare le CIDR dei proxy, non usare `true` |
| `trustProxy: true` | **sconsigliato** | Fidarsi di tutti gli hop rende scegliibile dal client il valore piu a sinistra |

`npm run test:proxy-ip` verifica questi comportamenti su Express: senza trust proxy l'header non
cambia `req.ip`; con `1` il client reale e l'ultimo hop; un header anteposto dal client non sposta il
bucket; con `true` il valore piu a sinistra (falsificabile) vince.

## Regola d'oro: il proxy deve accodare, non fidarsi

`X-Forwarded-For` e una lista `client, proxy1, proxy2`. Il client puo inviare il proprio header con
qualsiasi valore: il proxy deve **accodare** (`$proxy_add_x_forwarded_for`) o **sovrascrivere**
(`$remote_addr`). Con `trustProxy` numerico Express parte da destra e si ferma dopo N hop fidati,
quindi i valori anteposti dal client vengono ignorati.

Non usare `X-Real-IP` da solo: se il servizio e raggiungibile direttamente, e falsificabile quanto
`X-Forwarded-For`.

## Nginx

```nginx
location /api/accessi/ {
    proxy_pass http://accessi_service;

    # Un solo proxy: sovrascrivere l'header e evitare valori del client.
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Host $host;
}
```

Con piu proxy davanti a Nginx usare `$proxy_add_x_forwarded_for` e impostare `trustProxy` al numero
totale di hop fidati.

## Traefik

Traefik aggiunge `X-Forwarded-For` per impostazione predefinita. Con un solo Traefik davanti al
servizio usare `trustProxy: 1`. Se Traefik e dietro un altro ingress, contare anche quello.

## Cloudflare

Cloudflare invia `CF-Connecting-IP` e accoda `X-Forwarded-For`. Due opzioni sicure:

1. il servizio e raggiungibile **solo** da Cloudflare (firewall/authenticated origin pulls):
   `trustProxy: 1`, perche l'unico hop e Cloudflare;
2. c'e anche un ingress/Nginx tra Cloudflare e il servizio: `trustProxy: 2`.

Non impostare `trustProxy: true`: chi raggiunge l'origin direttamente potrebbe falsificare l'IP.
Se serve `CF-Connecting-IP`, va letto solo dopo aver verificato che la richiesta arrivi da un IP
Cloudflare.

## Configurazione

```ts
export const accessiOptions: AccessiOptions = {
  // ...
  http: {
    trustProxy: 1, // un solo proxy davanti
  },
  edgeRateLimit: {
    enabled: true,
    windowMs: 60_000,
    maxAttempts: 300,
  },
};
```

## Verifica in produzione

1. Da un client esterno, chiamare un endpoint pubblico con un header inventato:

   ```bash
   curl -H 'X-Forwarded-For: 6.6.6.6' https://accessi.example.com/api/accessi/auth/login
   ```

2. Controllare che l'audit (`accessi_rate_limited`, `edge_rate_limited`) riporti l'IP reale del
   client e non `6.6.6.6`.
3. Superare il limite da due IP diversi: se il secondo IP e bloccato subito, il bucket e condiviso e
   `trustProxy` e troppo basso. Se cambiando header si sblocca, `trustProxy` e troppo alto.
