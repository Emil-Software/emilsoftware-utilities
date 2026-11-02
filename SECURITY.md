# Security policy

Accessi gestisce identità, password, token e chiavi di firma: segnalazioni di
sicurezza sono benvenute e vanno trattate in modo riservato.

## Versioni supportate

| Versione | Supporto |
| --- | --- |
| Ultima `2.x` stabile | Sì, con priorità |
| Ultima `2.0.0-dev.N` su `@dev` | Sì, per problemi introdotti di recente |
| Versioni precedenti o fork | Best effort |

Le correzioni di sicurezza vengono pubblicate prima su `@dev` e poi nella
prossima versione stabile.

## Come segnalare una vulnerabilità

Non aprire una issue pubblica per una vulnerabilità non ancora corretta.

1. Usa la funzione **Report a vulnerability** nella scheda Security del
   repository GitHub (private vulnerability reporting).
2. Includi:
   - versione del package e commit;
   - topologia (servizio standalone, embedded, resource server, multi-tenant);
   - configurazione rilevante **senza segreti**;
   - passi di riproduzione, impatto e prerequisiti;
   - eventuale proof of concept minimo.
3. Non allegare database reali, token, password, chiavi private o file `.env`.
   Usa valori fittizi.
4. Indica se il problema è già pubblico o sfruttato.

Se il canale privato non è disponibile, contatta i maintainer indicati in
`package.json` senza divulgare dettagli sfruttabili.

## Cosa aspettarsi

- Conferma di ricezione appena possibile.
- Valutazione di impatto e gravità.
- Aggiornamenti periodici fino alla correzione.
- Credito nella release, se desiderato.

## Ambito

Sono particolarmente rilevanti:

- bypass di autenticazione o autorizzazione;
- furto, riuso o revoca incompleta di token e refresh token;
- esposizione di segreti, token o dati tra tenant;
- CSRF, XSS o bypass di rate limit;
- path traversal o esposizione della console;
- injection SQL o comandi negli script di migrazione;
- errori di configurazione che indeboliscono la sicurezza in produzione.

Non sono vulnerabilità del progetto:

- configurazioni esplicitamente insicure documentate come solo per sviluppo;
- servizi di terze parti non aggiornati dal deploy;
- mancanza di hardening del sistema operativo o del reverse proxy non
  documentata come responsabilità di Accessi.

## Segnalazioni non sensibili

Per bug funzionali, domande o miglioramenti usa le issue pubbliche e allega
solo log redatti. La guida alla risoluzione dei problemi è in
[`WIKI.md`](WIKI.md#problemi-comuni-e-come-risolverli).
