# Test di concorrenza e carico su Redis

`npm run test:load:redis` verifica che rate limit, ticket console e refresh
rotation restino corretti con più istanze Accessi sullo stesso Redis, e produce
un report di throughput e latenza.

```bash
ACCESSI_TEST_REDIS_URL=redis://127.0.0.1:6379 npm run test:load:redis
```

La suite è opt-in: senza `ACCESSI_TEST_REDIS_URL` i test vengono saltati. In CI
si imposta `ACCESSI_TEST_REQUIRE_REDIS=1` per far fallire il job se Redis non è
raggiungibile. Usare un database Redis dedicato (es. `redis://127.0.0.1:6379/5`):
tutte le chiavi hanno un prefisso per processo e vengono cancellate a fine suite,
ma un database separato evita sorprese con Redis condivisi.

## Scenari

| Scenario | Cosa dimostra |
| --- | --- |
| Burst login/reset/2FA | il limite globale per IP è rispettato anche se le richieste sono distribuite su due store (due istanze) |
| Ticket console | due istanze consumano lo stesso ticket: una sola ottiene il record, l'altra riceve `null` |
| Refresh rotation | due istanze consumano lo stesso `jti`: una sola vince; la revoca di famiglia è visibile all'altra istanza |
| Misure | throughput, p50, p95 e massimo per ogni scenario |

Le "due istanze" sono simulate con due connessioni Redis indipendenti e due
oggetti store distinti. La correttezza dipende dagli script Lua atomici degli
store: il test non testa il processo Node in sé, ma il comportamento condiviso
su Redis.

## Parametri

| Variabile | Default | Note |
| --- | --- | --- |
| `ACCESSI_TEST_REDIS_URL` | assente | abilita la suite |
| `ACCESSI_TEST_REQUIRE_REDIS` | `0` | `1` trasforma lo skip in errore (CI) |
| `ACCESSI_TEST_LOAD_ITERATIONS` | `200` | operazioni per refresh rotation |
| `ACCESSI_TEST_LOAD_CONCURRENCY` | `50` | richieste concorrenti |
| `ACCESSI_TEST_REPORT_FILE` | assente | path del report Markdown |

Esempio con carico maggiore:

```bash
ACCESSI_TEST_REDIS_URL=redis://127.0.0.1:6379/5 \
ACCESSI_TEST_LOAD_ITERATIONS=1000 \
ACCESSI_TEST_LOAD_CONCURRENCY=100 \
ACCESSI_TEST_REPORT_FILE=redis-load-report.md \
npm run test:load:redis
```

## Report

Il report viene sempre stampato a fine suite:

```
| Scenario | Operazioni | Errori | Throughput (ops/s) | p50 (ms) | p95 (ms) | max (ms) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| rate limit login | 60 | 0 | 3200.0 | 12.10 | 24.30 | 41.00 |
| console ticket (2 istanze) | 100 | 0 | 2800.0 | 14.00 | 30.10 | 55.00 |
| refresh rotation (2 istanze) | 200 | 0 | 3000.0 | 13.00 | 27.00 | 48.00 |
```

Con `ACCESSI_TEST_REPORT_FILE` viene scritto anche su file; la CI lo pubblica
come artifact `redis-load-report`.

Le asserzioni verificano correttezza e un limite di sicurezza sulla latenza
(p95 sotto 1–2 secondi), non un throughput minimo: il throughput dipende
dall'hardware del runner e non deve rendere la CI instabile. Per una valutazione
di capacità usare un ambiente dedicato e confrontare i numeri tra release.

## Interpretazione

- **Errori > 0**: Redis irraggiungibile o script Lua in errore; il test fallisce.
- **p95 molto alto con throughput basso**: rete verso Redis o Redis saturo;
  controllare `latency monitor` lato Redis e il pool di connessioni.
- **Più di un consumo riuscito**: violazione dell'atomicità; non distribuire la
  release.
- **Limite per IP superato**: due istanze non stanno condividendo lo store o
  stanno usando prefissi diversi.

## Limiti

- Non misura il costo del database Firebird né il flusso HTTP completo: per
  quello usare i test di integrazione Firebird e un ambiente di staging.
- I tempi includono il client Redis di test (RESP2 minimale) e il round-trip di
  rete: sono un limite superiore, non un benchmark dell'applicazione.
- Non usare questo test contro un Redis di produzione: scrive e cancella chiavi
  con prefisso, ma è comunque carico reale.
