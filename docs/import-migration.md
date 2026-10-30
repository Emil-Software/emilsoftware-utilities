# Migrazione agli entry point Accessi

Il root barrel (`emilsoftware-utilities`) e i deep import
(`emilsoftware-utilities/dist/accessi-module/...`) restano supportati **fino
alla prossima major**. Da questa minor sono considerati legacy: i consumer
devono passare agli entry point dichiarati in `package.json#exports`.

## Mappa consigliata

| Uso | Import consigliato | Legacy |
| --- | --- | --- |
| Avvio Accessi Service | `emilsoftware-utilities/accessi/server` | root barrel, `dist/accessi-module` |
| Contratti e helper browser-safe | `emilsoftware-utilities/accessi/contracts` | `dist/accessi-module/Dtos` |
| DTO Nest con validazione | `emilsoftware-utilities/accessi/contracts/dtos` | `dist/accessi-module/Dtos` |
| Verifica JWT in un backend fratello | `emilsoftware-utilities/accessi/resource-server` | `dist/accessi-module/...` |
| Client OpenAPI completo | `emilsoftware-utilities/accessi/client` | root barrel |
| Client solo API pubbliche | `emilsoftware-utilities/accessi/client/public` | — |
| Client solo API admin | `emilsoftware-utilities/accessi/client/admin` | — |
| Client service-to-service | `emilsoftware-utilities/accessi/client/service` | — |
| OpenAPI merge/setup | `emilsoftware-utilities/accessi/openapi` | root barrel |
| URL console e ticket | `emilsoftware-utilities/accessi/console` | root barrel |
| Asset UI frameworkless | `emilsoftware-utilities/accessi/ui` | — |

```ts
// Corretto
import { initializeAccessiModule } from 'emilsoftware-utilities/accessi/server';
import { createAccessiTokenVerifier } from 'emilsoftware-utilities/accessi/resource-server';
import { login } from 'emilsoftware-utilities/accessi/client/public';

// Legacy: continua a funzionare, ma verra rimosso in una major
import { initializeAccessiModule } from 'emilsoftware-utilities';
```

## Perché

- Il root barrel importa NestJS, modulo Accessi, Allegati, OpenAPI e utility:
  un frontend che importa un solo helper paga tutto il grafo.
- Gli scope `client/public`, `client/admin` e `client/service` impediscono che
  un bundle pubblico includa operazioni amministrative o service token.
- `accessi/contracts` è browser-safe: non trascina database, SMTP o Nest.
- Gli entry point sono parte del contratto del pacchetto: i deep import non lo
  sono e possono cambiare layout in una minor.

## Piano

1. **Ora**: nuovi consumer usano gli entry point; il root barrel e i deep import
   funzionano senza warning runtime.
2. **Prossima major**: il root barrel Accessi verrà ridotto ai soli simboli non
   Accessi (Logger, Orm, Utilities, ...). I deep import non saranno più
   supportati.
3. **Dopo la major**: eventuale split in pacchetti separati, secondo
   `docs/adr/0001-split-package.md`.

Nessuna rimozione avviene in una minor: i consumer hanno almeno un ciclo di
rilascio per migrare.

## Verifica

```bash
npm run test:pack   # importa il tarball pubblicato e i subpath
```

Il test `test/import-entrypoints.cjs` carica ogni entry point consigliato,
verifica i simboli principali e controlla che ogni subpath sia dichiarato in
`package.json#exports`.
