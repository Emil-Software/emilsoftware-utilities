# Audit persistente

`auditAccessi` scrive un record strutturato per ogni evento di sicurezza. Di
default il record finisce nel log (`AccessiAudit`); con `audit.sinks` può essere
persistito su Redis, inoltrato a un collector HTTP o scritto su database e
OpenTelemetry tramite una callback.

```ts
const accessiOptions: AccessiOptions = {
  audit: {
    retentionDays: 90,
    logger: true,
    store: createRedisAccessiAuditSink({
      client: redisClient, // qualunque client con eval (ioredis, node-redis)
      maxRecords: 100_000,
      retentionMs: 90 * 24 * 60 * 60 * 1000,
    }),
    sinks: [
      createHttpAccessiAuditSink({
        url: 'https://siem.example.com/accessi/audit',
        headers: { Authorization: `Bearer ${process.env.SIEM_TOKEN}` },
      }),
    ],
  },
};
```

`store` è il sink interrogabile usato dagli endpoint amministrativi. Se non è
impostato, viene usato il primo sink con `query`/`purge` presente in `sinks`.
Senza sink interrogabile gli endpoint rispondono `501 ACCESSI_AUDIT_STORE_DISABLED`
e il log strutturato continua a funzionare.

## Cosa viene registrato

| Evento | Dettagli | Dove |
| --- | --- | --- |
| `login_succeeded` / `login_failed` | `codiceUtente`, `ip`, motivo | AuthController |
| `two_factor_succeeded` / `two_factor_failed` | `codiceUtente`, `ip` | AuthController |
| `refresh_succeeded` / `refresh_failed` | `ip`, motivo (`reuse`, `invalid`, ...) | AuthController |
| `accessi_refresh_token_reuse` | `codiceUtente`, `jti`, `familyId` | AuthService |
| `access_token_revoked` | utente, `jti`, self | AuthController |
| `accessi_sessions_revoked` | utente, cutoff, motivo | sessionRevocation |
| `public_rate_limited` / `edge_rate_limited` | scope, IP, retry | rate limit |
| `console_ticket_issued` / `console_ticket_consumed` / `console_ticket_failed` | utente o esito | ConsoleEntryController |
| `jwt_unknown_key_id` | `kid`, `purpose`, algoritmo | verifica JWT |

Non vengono registrati token, password, header `Authorization`, cookie o chiavi
private: la redazione è applicata prima del logger e di ogni sink.

## Redazione

`redactAccessiAuditValue` normalizza le chiavi (case-insensitive, ignora `-`,
`_` e spazi) e sostituisce con `[REDACTED]`:

`token`, `accessToken`, `refreshToken`, `idToken`, `bearer`, `jwt`,
`authorization`, `cookie`, `set-cookie`, `password`, `passwordHash`,
`hashedPassword`, `resetToken`, `secret`, `clientSecret`, `privateKey`,
`apiKey`, `csrf`, `csrfToken`.

Inoltre:

- le stringhe oltre 512 caratteri vengono troncate;
- gli array oltre 50 elementi e gli oggetti oltre 100 chiavi vengono limitati;
- oltre 4 livelli di profondità il valore diventa `[TRUNCATED]`;
- gli `Error` diventano `{ name, message }` senza stack.

Aggiungere chiavi specifiche dell'host:

```ts
audit: { redact: ['cardNumber', 'iban'] }
```

## Retention

`retentionDays` abilita la pulizia periodica (al massimo una volta all'ora,
pigra, al primo evento successivo) dei sink che implementano `purge`. I sink
in memoria hanno anche `maxRecords`. Il sink Redis usa `LTRIM` più `PEXPIRE`:

```ts
createRedisAccessiAuditSink({
  client: redisClient,
  maxRecords: 100_000,
  retentionMs: 90 * 24 * 60 * 60 * 1000,
});
```

La retention deve essere almeno pari agli obblighi di legge applicabili e alla
durata massima dei token, così un incidente resta ricostruibile.

## Endpoint amministrativi

Richiedono un JWT Accessi di un superutente o admin:

```http
GET /api/accessi/audit?event=login_failed&from=2026-01-01T00:00:00Z&limit=100
GET /api/accessi/audit/export?event=login_failed&from=2026-01-01T00:00:00Z
```

La query restituisce `{ records, total, limit, offset }`. L'export produce
NDJSON (`application/x-ndjson`) con gli stessi filtri, senza paginazione, fino a
100000 record per richiesta. I record sono già redatti.

## Sink disponibili

| Factory | Uso |
| --- | --- |
| `createMemoryAccessiAuditSink` | test, sviluppo, singola istanza |
| `createRedisAccessiAuditSink` | persistenza condivisa multi-istanza |
| `createHttpAccessiAuditSink` | SIEM/collector HTTP |
| `createCallbackAccessiAuditSink` | database applicativo, OpenTelemetry, coda |

Esempio database/OTel:

```ts
const dbSink = createCallbackAccessiAuditSink(async (record) => {
  await db.insert('AUDIT_EVENTS', {
    EVENT: record.event,
    OCCURRED_AT: record.timestamp,
    PAYLOAD: JSON.stringify(record),
  });
}, 'database');
```

La callback deve gestire i propri errori: un errore viene contato in
`accessi_audit_sink_errors_total{sink}` e non blocca la richiesta.

## Note

- I sink sono globali per processo: configurare un solo modulo Accessi per
  processo, come già avviene per il logger Accessi.
- `audit.enabled: false` disattiva i sink ma **non** il log strutturato; usare
  `logger: false` per silenziare anche quello.
- Non inserire payload applicativi completi nei dettagli degli eventi: la
  redazione è una rete di sicurezza, non un invito a loggare dati sensibili.
- L'audit non sostituisce le metriche: usare `docs/metrics.md` per gli alert in
  tempo reale.
