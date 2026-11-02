# Convenzioni di nomenclatura

Per chi contribuisce al repository. Indice della documentazione per ruolo in
[README.md](README.md).

Regole applicate a tutto il repository e verificate da `npm run check:naming`
in CI.

## Cartelle

- `src/`, `scripts/`, `test/`, `docs/`, `deploy/`: **kebab-case**
  (`database-updates`, `federated-auth`, `angular-components`).
- Eccezioni: directory generate (`generated`) e nomi convenzionali con punto
  (`.github`, `.vscode`).
- Non creare nuove cartelle PascalCase o camelCase.

## Layout di Accessi

Accessi è diviso in due livelli con responsabilità diverse:

- `src/accessi/`: **facciata pubblica**. Contiene solo gli entry point
  esportati in `package.json#exports` (`accessi/server`, `accessi/client`,
  `accessi/contracts`, `accessi/resource-server`, `accessi/openapi`,
  `accessi/console`, `accessi/ui`). Non contiene implementazione: riesporta,
  adatta e documenta.
- `src/accessi-service/`: **implementazione del servizio**. Contiene il modulo
  Nest, controller, service, DTO, migrazioni database, console, sicurezza,
  tenancy e osservabilità.

Regola: il codice applicativo vive in `accessi-service`; se un consumer deve
importarlo, va esposto da un entry point in `accessi/`. Non importare
`src/accessi-service/...` direttamente da fuori del pacchetto.

## File

### `src/`

- **PascalCase** per file il cui export principale è una classe: controller,
  service, DTO, guard, filter.
  Esempi: `AuthController.ts`, `JwtSimpleGuard.ts`, `UserDto.ts`.
- **camelCase** per moduli, helper, factory e file di bootstrap:
  `tenantSupervisor.ts`, `accessiOptionsFromEnv.ts`, `readiness.ts`.
- Niente punti nel nome, salvo dichiarazioni ambientali (`.d.ts`).
- `index.ts` è ammesso come barrel.
- File generati (`**/generated/**`) e migrazioni SQL (`V1.0.0_to_V1.1.0.sql`)
  sono esclusi.

### `scripts/`, `test/`, `docs/`, `deploy/`

- **kebab-case** con eventuali segmenti separati da punto:
  `redis-load.integration.cjs`, `docker-compose.test.yml`.
- Eccezioni documentali: `README.md`, `CHANGELOG.md`, `WIKI.md`, `WIKI.ai.md`.
- `index.ts` è ammesso per entry point generati.

### Root

- File convenzionali in maiuscolo: `README.md`, `CHANGELOG.md`, `WIKI.md`,
  `WIKI.ai.md`.
- Configurazione in minuscolo/kebab: `package.json`, `tsconfig.json`,
  `docker-compose.test.yml`.
- Nessun artefatto locale o IDE tracciato.

## Pulizia

Non vanno versionati:

- `.DS_Store`, `.idea/`, `.vscode/settings.json`;
- `*.tsbuildinfo`, `*.tgz`, `*.log`;
- `dist/`, `node_modules/`, `logs/`;
- output generati già coperti da `.gitignore`.

## Migrazione

1. Rinominare con `git mv` (mai copiare/incollare).
2. Aggiornare import, `package.json#exports`, config e documentazione.
3. Non cambiare comportamento: la rinomina è un refactor separato.
4. Eseguire `npm run typecheck`, `npm test`, `npm run build` e `npm run test:pack`.

## Verifica

```bash
npm run check:naming
```

Lo script controlla i file tracciati da Git, quindi ignora automaticamente
`dist/`, `node_modules/` e gli altri path in `.gitignore`.
