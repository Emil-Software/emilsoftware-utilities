# Angular / Browser components

Componenti UI riutilizzabili di Emil Software, pubblicati con
`emilsoftware-utilities` sotto `dist/angular-components/`.

Sono **frameworkless**: non importano Angular, Ionic o React. Ogni componente e'
un Web Component autonomo, usabile con uno `<script>` o come asset di
un'applicazione Angular. Bootstrap 5.3 e' supportato tramite i token CSS
`--bs-*`, ma non e' obbligatorio.

| Componente | Descrizione |
|---|---|
| [`aree-disponibili`](./aree-disponibili/README.md) | Aree abilitate dell'utente, raggruppate per gruppo menu, con aree bloccate e temi light/dark. |

## Convenzioni

- tag con prefisso `es-` (Emil Software), es. `<es-aree-disponibili>`;
- Shadow DOM per isolare gli stili;
- token CSS `--es-*` sovrascrivibili dall'app;
- nessuna chiamata di rete: i dati arrivano via proprieta';
- nessuna dipendenza runtime;
- eventi `CustomEvent` con `bubbles` e `composed`;
- accessibilita' e `prefers-reduced-motion` sempre previsti.

## Build

`npm run build` compila TypeScript e poi esegue `copy-views.js`, che copia in
`dist/angular-components/` i file `.js`, `.html` e `.css` di questa cartella.
Il pacchetto npm include solo `dist`, quindi i componenti sono disponibili come:

```
emilsoftware-utilities/dist/angular-components/<componente>/<file>
```
