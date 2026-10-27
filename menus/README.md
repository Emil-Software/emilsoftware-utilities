# Catalogo menu Accessi

Le app Angular non devono più inventare codici menu: ogni applicazione ha un
catalogo versionato nel proprio repository e un comando unico che lo allinea al
database Accessi di riferimento.

```text
<app>/menus/menu-catalog.json          # anagrafica (fonte di verità)
<app>/src/app/menus/menu.catalog.ts    # tipi + costanti MENU.X (generato)
```

Il catalogo contiene solo ciò che serve: gruppi, tipi menu e voci. Le voci sono
la copia esatta delle righe Accessi (stessi nomi, stessi campi), più le voci
nuove che l'app dichiara nel codice.

## Comandi

Tutti i comandi si eseguono da `emilsoftware-utilities`:

```bash
npm run menus:init                 # crea/aggiorna i menu di tutte le app
npm run menus:init -- --app=SteX   # solo un'app
npm run menus:init -- --dry-run    # piano senza scrivere

npm run menus:verify               # confronta catalogo e DB
npm run menus:verify -- --strict   # fallisce anche per i menu extra del DB

npm run menus:generate             # rigenera i file TS dai JSON
npm run menus:check                # CI: verifica che i TS siano aggiornati

npm run menus:bootstrap            # ricostruisce i cataloghi da DB + codice FE
```

`init` e `verify` chiedono **email e password dell'admin** in console. Per la
CI si possono usare `ACCESSI_USER` / `ACCESSI_PASSWORD`, e
`ACCESSI_BASE_URL` (default `http://localhost:3011`) o `--url=` per puntare a
un altro backend che espone Accessi.

L'autenticazione e le chiamate passano dal **client Orval** della console
Accessi (`login`, `getMenus`, `createMenu`, `updateMenu`, ...): nessuna rotta
inventata, nessun SQL diretto.

## Formato del catalogo

```json
{
  "app": "SteX",
  "groups": [
    {
      "codiceGruppo": "U",
      "descrizioneGruppo": "STEX_QUALITA",
      "ordineGruppo": 16,
      "enabled": true,
      "owned": true
    }
  ],
  "menuTypes": [{ "codiceTipo": "M", "descrizioneTipo": "Menu di navigazione" }],
  "menus": [
    {
      "codiceMenu": "STEX_ARRIVI_CQ",
      "descrizioneMenu": "SteX - Arrivi CQ",
      "codiceGruppo": "U",
      "tipo": "M",
      "icona": "checkmark-done-outline",
      "pagina": "arrivi",
      "ordineMenu": 10,
      "enabled": true
    }
  ]
}
```

Regole:

- `codiceMenu`: massimo 20 caratteri, `A-Z`, cifre e `_` (vincolo DB).
- `codiceGruppo` e `tipo`: **un solo carattere** (vincolo DB).
- `pagina`: massimo 50 caratteri ed **è univoca in Accessi**: due menu non
  possono puntare alla stessa pagina. `menus:init` segnala il conflitto e crea
  la voce senza pagina invece di fallire.
- I campi assenti non vengono toccati: `init` aggiorna solo ciò che il catalogo
  dichiara esplicitamente.
- `owned: true` indica un gruppo di cui l'app è proprietaria: serve a `verify`
  per distinguere i menu "in più" del DB dai codici condivisi con altre app.

## Uso nel codice

```ts
import { MENU, MENU_CODES, MENU_BY_CODE } from '../menus/menu.catalog';

MENU.STEX_ARRIVI_CQ.codiceMenu; // 'STEX_ARRIVI_CQ' (tipo letterale)
MENU.STEX_ARRIVI_CQ.pagina;     // 'arrivi'
```

`MENU` è tipizzato con `MenuEntity` di Orval: i campi sono gli stessi che
ritorna il backend. `MENU_CODES` elenca i codici disponibili, `MENU_BY_CODE`
serve quando il codice arriva a runtime (es. da un grant).

I `menu.service.ts` delle app derivano le costanti storiche dal catalogo:

```ts
public MENU_MAIN = MENU.MNUMAIN.codiceMenu;
```

## Aggiungere un menu

1. Aggiungere la voce in `<app>/menus/menu-catalog.json` (oppure dichiararla nel
   codice e rilanciare `menus:bootstrap`).
2. `npm run menus:generate -- --app=<App>` per aggiornare il TS.
3. `npm run menus:verify -- --app=<App>`: deve risultare solo il nuovo codice
   come mancante nel DB.
4. `npm run menus:init -- --app=<App>` per crearlo.
5. Commit di catalogo + TS + codice.

## Bootstrap e proprietà

`menus:bootstrap` è il tool di anagrafica iniziale. Assegna ogni menu del DB
all'app proprietaria del gruppo (prefisso della descrizione: `ESGESTX_`,
`TINTEMIX_`, `MAGAZTINT_`, `STEX_`, `STAFFX_`, `STERILIX_`), unisce i codici
dichiarati nei frontend e applica le regole in `NEW_MENU_RULES` per i codici
nuovi. Se lo stesso codice è usato da più app, il catalogo canonico è il primo
del registro: tutte le copie vengono allineate a quei valori.

I cataloghi sono la fonte di verità dopo il bootstrap: si modificano a mano e
non serve più rieseguirlo.
