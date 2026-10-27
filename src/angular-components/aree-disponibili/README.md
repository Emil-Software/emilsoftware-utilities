# `es-aree-disponibili`

Web Component frameworkless (Custom Element) che mostra le aree abilitate di un
utente, raggruppate per gruppo menu. Le aree non ancora implementate restano
visibili ma bloccate, con il motivo nel tooltip.

Non richiede Angular, React, Ionic o Bootstrap. Se l'app usa Bootstrap 5.3 i
token `--bs-*` vengono ereditati automaticamente; altrimenti valgono i colori
interni. Supporta tema **light**, **dark** e **auto**.

## File

| File | Uso |
|---|---|
| `aree-disponibili.js` | componente + stili (Shadow DOM). Self-contained. |
| `demo.html` | demo standalone con switch light/dark/auto. |

Nessuna dipendenza esterna, nessuna richiesta di rete.

## Installazione

### Script tag (qualsiasi applicazione)

```html
<script src="assets/angular-components/aree-disponibili/aree-disponibili.js"></script>

<es-aree-disponibili id="aree"></es-aree-disponibili>
```

### Angular

1. Aggiungi lo script a `angular.json` (cosi viene caricato prima del bootstrap):

```json
"scripts": [
  "node_modules/emilsoftware-utilities/dist/angular-components/aree-disponibili/aree-disponibili.js"
]
```

2. Abilita gli elementi custom nello standalone component:

```ts
import { CUSTOM_ELEMENTS_SCHEMA, Component } from '@angular/core';

@Component({
  selector: 'app-aree-disponibili',
  standalone: true,
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: '<es-aree-disponibili #aree></es-aree-disponibili>',
})
export class AreeDisponibiliPage {}
```

3. Passa i dati via proprieta' (non via attributi: e' un array):

```ts
@ViewChild('aree', { static: true })
private aree!: ElementRef<AreeDisponibiliElement>;

ngOnInit(): void {
  this.aree.nativeElement.groups = groups;
}
```

Il pacchetto pubblica `dist/angular-components/...` grazie a `copy-views.js`:
gli asset sono gia' dentro `emilsoftware-utilities` (cartella `files: ["dist"]`).

### Bundler / import

`aree-disponibili.js` non usa `import`/`export`: e' un IIFE che registra il
custom element. Puoi importarlo come side-effect:

```ts
import 'emilsoftware-utilities/dist/angular-components/aree-disponibili/aree-disponibili.js';
```

## Modello dati

```ts
interface Area {
  code?: string;
  label: string;
  icon?: string;              // nome icona Accessi, es. 'home-outline'
  route?: string;             // rotta Angular, es. '/main'
  page?: string;              // pagina Accessi originale, es. '/avanzamento'
  url?: string;               // URL completo mostrato nella card (opzionale)
  available?: boolean;        // default: true se route e' valorizzata
  reason?: string;            // motivo mostrato per le aree bloccate
  order?: number;             // ordinamento nella card
}

interface Group {
  name: string;
  order?: number;
  areas: Area[];
}
```

Sono accettati anche array piatti: le aree vengono raggruppate per `group`.

## API

| Membro | Tipo | Descrizione |
|---|---|---|
| `groups` | `Group[]` | Dati da mostrare. Setter ri-renderizza. |
| `setGroups(groups)` | metodo | Alias di `groups = ...`. |
| `heading` | `string` | Titolo (default `Aree disponibili`). |
| `subtitle` | `string` | Sottotitolo. |
| `note` | `string` | Nota aggiuntiva sotto il sottotitolo. |
| `eyebrow` | `string` | Etichetta sopra il titolo. |
| `emptyText` | `string` | Testo quando non ci sono aree. |
| `unavailableTemplate` | `string` | Template motivo; `{page}` viene sostituito. |
| `hrefMode` | `'hash' \| 'path' \| 'none'` | Come costruire l'`href` (default `hash`). |
| `theme` | `'auto' \| 'light' \| 'dark'` | Tema (default `auto`). |
| `refresh()` | metodo | Forza il render. |

Attributi equivalenti: `heading`, `subtitle`, `note`, `eyebrow`, `empty-text`,
`unavailable-template`, `href-mode`, `theme`.

### Eventi

| Evento | `detail` | Quando |
|---|---|---|
| `es-area-select` | `{ area, group }` | click su un'area disponibile |
| `es-area-blocked` | `{ area, group, reason }` | click su un'area bloccata |

Gli eventi sono `bubbles: true` e `composed: true`, quindi attraversano lo
Shadow DOM.

Con `href-mode="hash"` (default) il click su un'area disponibile naviga
nativamente verso `#/rotta`; l'evento viene comunque emesso. Con
`href-mode="none"` la navigazione e' interamente a carico dell'app.

## Temi e colori

Il componente espone token CSS personalizzabili dall'esterno (anche attraverso
lo Shadow DOM, perche' le custom property vengono ereditate):

| Token | Light | Dark |
|---|---|---|
| `--es-bg` | `#f4f6fb` | `#0b1220` |
| `--es-surface` | `#ffffff` | `#111c2e` |
| `--es-text` | `#0f172a` | `#e2e8f0` |
| `--es-muted` | `#64748b` | `#94a3b8` |
| `--es-primary` | `#2563eb` | `#60a5fa` |
| `--es-border` | `rgba(15,23,42,.08)` | `rgba(148,163,184,.16)` |

`theme="auto"` segue, in ordine:

1. `theme="light|dark"` esplicito;
2. `data-bs-theme="dark"` su `<html>`;
3. classe `.dark` o `.ion-palette-dark` su `<html>`;
4. `prefers-color-scheme`.

Se l'app usa Bootstrap 5.3, i token `--bs-body-bg`, `--bs-body-color`,
`--bs-primary`, `--bs-card-bg` e `--bs-border-color` vengono usati come fallback
in tema light. In tema dark il componente usa i propri colori per non ereditare
un `--bs-body-bg` chiaro.

Override esempio:

```css
es-aree-disponibili {
  --es-primary: #dd571c;
  --es-radius: 10px;
}
```

## Accessibilita'

- heading e gruppi sono elementi semantici (`h1`, `h2`, `section`);
- le aree disponibili sono link reali e ricevono il focus;
- le aree bloccate hanno `aria-disabled="true"`, `tabindex="0"`, `title` e il
  motivo sempre visibile;
- focus ring visibile;
- `prefers-reduced-motion` rispettato.

## Demo

Apri `demo.html` con un server statico (es. `npx http-server`) oppure servila
dall'app. Mostra i tre temi e il log degli eventi.

## Versionamento

Il componente e' versionato insieme a `emilsoftware-utilities`. Per aggiornare
SteX o un'altra app, sostituisci `aree-disponibili.js` con la versione del
pacchetto e ridistribuisci l'asset.
