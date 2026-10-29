/**
 * Asset UI frameworkless pubblicati con il pacchetto.
 *
 * I componenti sono Web Components senza dipendenze runtime: vanno inclusi
 * come `<script>` o copiati nel build dell'app. I percorsi sono relativi alla
 * root del pacchetto distribuito (`dist/`).
 */
export const ACCESSI_UI_ASSETS = {
  areeDisponibili: "angular-components/aree-disponibili/aree-disponibili.js",
} as const;

export type AccessiUiComponent = keyof typeof ACCESSI_UI_ASSETS;

/** Restituisce il path dell'asset UI relativo a `dist/`. */
export function getAccessiUiAssetPath(component: AccessiUiComponent): string {
  return ACCESSI_UI_ASSETS[component];
}
