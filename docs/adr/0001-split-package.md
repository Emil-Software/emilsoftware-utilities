# ADR 0001 — Split in pacchetti separati: contracts, client, resource-server, server

- **Stato:** accettato
- **Data:** 2026-10-30
- **Issue:** #9
- **Ambito:** packaging e rilascio di `emilsoftware-utilities`

## Contesto

Il package espone gia entry point separati (`accessi/server`, `accessi/resource-server`,
`accessi/client` con gli scope `public`/`admin`/`service`, `accessi/contracts`, `accessi/openapi`,
`accessi/console`, `accessi/ui`). Hanno però un unico `package.json`, un unico numero di versione e
un unico ciclo di rilascio, mentre i consumer reali hanno esigenze diverse:

- i frontend usano solo `contracts` e `client/public` e non devono scaricare Nest, Firebird o SMTP;
- i backend fratelli usano `resource-server` e `client/service`;
- solo il backend proprietario usa `server` (database, migrazioni, console).

Oggi il tarball contiene tutto (~950 KB) e una modifica server-side obbliga un bump che i frontend
devono comunque recepire. Lo split è però un cambio invasivo per i consumer e per la release.

## Opzioni valutate

| Opzione | Pro | Contro |
| --- | --- | --- |
| **A. Pacchetto singolo con entry point per scope (attuale)** | Zero migrazioni; un solo `npm ci`; types condivisi per costruzione; release unica e semplice; il tree-shaking elimina il codice non importato | Il tarball contiene dipendenze server anche per i frontend; versione unica per domini diversi |
| **B. Monorepo npm workspaces con 4 pacchetti** | Versioning indipendente; dipendenze minime per pacchetto; build/publish selettivi | Richiede cambiare toolchain, CI e release; 4 tarball da pubblicare; gestione versioni incrociate (`contracts` → `client`); migrazione dei consumer |
| **C. Pacchetti in repository separati** | Massima indipendenza | Frammentazione, PR incrociate, release coordinate manualmente, overhead alto per un team piccolo |

## Decisione

Si adotta **l'opzione A** nel breve periodo, rafforzata dagli entry point per scope introdotti
nell'issue #7 e verificati dal test `npm run test:pack`.

Motivazioni:

1. **Nessuna regressione:** gli import esistenti (`emilsoftware-utilities`,
   `.../accessi/client`, ...) restano identici; una migrazione forzata avrebbe costo alto e
   beneficio non dimostrato.
2. **Tipi condivisi per costruzione:** un solo set di modelli generati da OpenAPI evita divergenze
   tra client e contracts, che con pacchetti separati andrebbero versionati insieme.
3. **Bundle:** i consumer browser usano `accessi/client/public` e `accessi/contracts`; con
   `sideEffects` limitato ai soli moduli con effetti, i bundler eliminano il resto.
4. **Release riproducibile:** `npm ci && npm run build && npm run test:pack` produce e verifica lo
   stesso tarball; semantic-release pubblica un solo artefatto.

Lo split resta un'opzione futura, non un rifiuto: le soglie che lo giustificherebbero sono elencate
sotto.

## Quando rivalutare

Riaprire la decisione (ADR successivo) se si verifica almeno una di queste condizioni:

- i frontend richiedono un rilascio di `contracts`/`client` indipendente da `server`;
- il peso delle dipendenze server nel bundle browser diventa un problema non risolvibile con il
  tree-shaking (es. consumer senza bundler);
- il team cresce al punto da avere cicli di rilascio separati per server e client;
- si rende necessario pubblicare su registry diversi o con licenze diverse.

## Piano di migrazione (se e quando)

1. Introdurre i workspace (`npm workspaces`) mantenendo i path pubblici attuali come facade.
2. Estrarre per primo `contracts` (zero dipendenze runtime), poi `client`, poi `resource-server`,
   infine `server`.
3. Ogni pacchetto facade re-esporta dal nuovo package, così `accessi/client`, `accessi/contracts`,
   ecc. continuano a funzionare senza modifiche ai consumer.
4. Aggiungere una test matrix che installa i tarball di tutti i pacchetti insieme e verifica i path
   legacy.
5. Deprecare i facade solo in una major successiva, con guida di migrazione.

## Conseguenze

- **Versioning:** unico, gestito da semantic-release sul branch `dev` → `main`.
- **Compatibilita:** garantita dall'export map e dallo smoke test del tarball
  (`scripts/pack-smoke-consumer.cjs`) che copre ogni subpath e gli scope client.
- **Build/publish riproducibili:** build dichiarativa (`npm run build`), configurazione npm
  isolata nello smoke test, nessun passaggio manuale oltre al merge.
- **Debito accettato:** il tarball include dipendenze server anche per i consumer frontend; è un
  costo noto e monitorato, non un bug.
