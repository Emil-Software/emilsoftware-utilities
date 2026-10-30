# Metriche e alert

Accessi espone metriche di dominio in formato Prometheus. Il servizio standalone
le include in `/health/metrics` insieme alle metriche HTTP di base; un host
Nest/Express può montare `renderAccessiMetrics()` su una propria rotta protetta.

```ts
import { renderAccessiMetrics } from 'emilsoftware-utilities/accessi/server';

app.get('/internal/accessi-metrics', (_req, res) => {
  res.type('text/plain; version=0.0.4').send(renderAccessiMetrics());
});
```

Le metriche sono attive per default. Per disattivarle:

```ts
const accessiOptions: AccessiOptions = {
  // ...
  metrics: { enabled: false },
};
```

Per inviarle a OpenTelemetry, StatsD o un altro sistema:

```ts
const accessiOptions: AccessiOptions = {
  metrics: {
    prefix: 'accessi',
    sink: {
      increment: (name, value, labels) => meter.createCounter(name).add(value, labels),
      observe: (name, valueMs, labels) => histogram.record(valueMs, labels),
    },
  },
};
```

`prefix` (default `accessi`) si applica alle metriche emesse dai controller; gli
store Redis usano il registry globale, sempre renderizzabile con
`renderAccessiMetrics()`.

## Metriche di dominio

| Metrica | Tipo | Label | Significato |
| --- | --- | --- | --- |
| `accessi_auth_login_total` | counter | `result` = `success`, `failure`, `challenge`, `password_required`, `password_expired`, `sso_only`, `rate_limited`, `error` | esito del login |
| `accessi_auth_login_duration_ms` | histogram | — | durata del login |
| `accessi_auth_two_factor_total` | counter | `action` = `verify`/`resend`, `result` | verifica e reinvio 2FA |
| `accessi_auth_two_factor_duration_ms` | histogram | `action` | durata verifica 2FA |
| `accessi_auth_refresh_total` | counter | `result` = `success`, `invalid`, `reuse`, `family_revoked`, `store_unavailable`, `rate_limited` | esito del refresh |
| `accessi_auth_refresh_duration_ms` | histogram | — | durata del refresh |
| `accessi_refresh_reuse_total` | counter | `user_sessions_revoked` | riuso di refresh token oltre la grace |
| `accessi_refresh_family_revoked_total` | counter | `reason` | famiglie revocate |
| `accessi_rate_limit_blocked_total` | counter | `scope`, `layer` = `public`/`edge`/`service_token` | richieste bloccate dal rate limit |
| `accessi_introspection_total` | counter | `result` = `active`, `inactive`, `bad_request`, `error` | introspection service-to-service |
| `accessi_introspection_duration_ms` | histogram | — | durata introspection |
| `accessi_jwks_requests_total` | counter | `result` = `ok`, `unavailable` | richieste JWKS |
| `accessi_jwt_unknown_key_id_total` | counter | `purpose`, `source`, `algorithm` | token con `kid` non riconosciuto |
| `accessi_sessions_revoked_total` | counter | `reason` = `manual`, `password_change`, `disabled`, `deleted`, `refresh_token_reuse`, ... | revoche sessioni |
| `accessi_console_ticket_total` | counter | `action` = `create`/`exchange`, `result` | ticket di ingresso console |
| `accessi_store_errors_total` | counter | `store` | errori degli store Redis |
| `accessi_store_operation_duration_ms` | histogram | `store` | latenza degli script Lua Redis |

Gli store strumentati sono `rate_limit`, `edge_rate_limit`, `service_token_rate_limit`,
`console_entry`, `session_revocation`, `access_token_revocation` e
`refresh_token_rotation`.

## Alert suggeriti

Esempio di regole Prometheus. Le soglie vanno tarate sul traffico reale.

```yaml
groups:
  - name: accessi
    rules:
      - alert: AccessiLoginErrorRate
        expr: |
          sum(rate(accessi_auth_login_total{result=~"failure|error"}[5m]))
            /
          clamp_min(sum(rate(accessi_auth_login_total[5m])), 0.001)
            > 0.3
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Oltre il 30% dei login fallisce da 10 minuti"

      - alert: AccessiRefreshReuse
        expr: increase(accessi_refresh_reuse_total[5m]) > 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Riuso di refresh token rilevato: verificare possibili furti"

      - alert: AccessiRateLimitSpike
        expr: sum(rate(accessi_rate_limit_blocked_total[5m])) > 20
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Molte richieste bloccate dal rate limit: possibile brute force"

      - alert: AccessiUnknownJwtKid
        expr: increase(accessi_jwt_unknown_key_id_total[5m]) > 0
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Token con kid sconosciuto: rotazione chiavi incompleta?"

      - alert: AccessiRedisStoreDown
        expr: increase(accessi_store_errors_total[5m]) > 3
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Errori Redis: revoca, rotazione o rate limit non affidabili"

      - alert: AccessiStoreLatency
        expr: |
          histogram_quantile(
            0.95,
            sum by (le, store) (rate(accessi_store_operation_duration_ms_bucket[5m]))
          ) > 50
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "p95 degli script Redis sopra 50 ms per {{ $labels.store }}"

      - alert: AccessiIntrospectionErrors
        expr: |
          sum(rate(accessi_introspection_total{result="error"}[5m]))
            /
          clamp_min(sum(rate(accessi_introspection_total[5m])), 0.001)
            > 0.05
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Errori di introspection oltre il 5%"
```

## Note

- Non usare label ad alta cardinalità (email, `jti`, IP): le metriche Accessi
  non le includono.
- `accessi_jwt_unknown_key_id_total` collega la rotazione chiavi descritta in
  `docs/jwt-key-rotation.md`: un aumento dopo un deploy segnala che un
  consumatore non ha aggiornato la JWKS o la chiave statica.
- Le metriche non sostituiscono l'audit: per gli eventi di sicurezza usare
  `auditAccessi` e la sua persistenza.
