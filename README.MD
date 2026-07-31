Convenzioni per i Commit Message

1. feat:
Descrizione: Nuova feature
Esempio: feat: aggiunta endpoint per notifiche
Trigger: MINOR release (es. 1.3.0 -> 1.4.0)
Su dev: 1.4.0-dev.0

2. fix:
Descrizione: Correzione di bug
Esempio: fix: gestione errore null in login
Trigger: PATCH release (es. 1.3.1)
Su dev: 1.3.1-dev.0

3. BREAKING CHANGE:
Descrizione: Cambiamento che rompe la compatibilità all'indietro
Esempio:
feat!: rimozione supporto legacy
BREAKING CHANGE: cambia lo schema JWT
Trigger: MAJOR release (es. 1.0.0 -> 2.0.0)

4. Altri tipi di commit
Esempi: chore:, docs:, test:, refactor:
Descrizione: Non triggerano una release di default, a meno che non siano configurati esplicitamente nel commit-analyzer.
Esempio: chore: aggiorna dipendenze

5. Forzare una Release
Descrizione: Utile in caso di merge o altre operazioni.
Comandi:
git commit --allow-empty -m "feat: trigger test release"
Poi:
git push origin dev
Oppure:
git push origin main

## Accessi

La documentazione operativa del modulo accessi si trova in [src/accessi-module/README.md](src/accessi-module/README.md).
