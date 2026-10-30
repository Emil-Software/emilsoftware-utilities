import {
  runWithAccessiClient,
  type AccessiClientConfig,
} from '../../accessi-module/Console/accessiFetch';

/**
 * Client generato con configurazione isolata per istanza.
 *
 * `TModule` e il modulo generato da Orval per lo scope: il client espone solo
 * le operazioni di quello scope (pubblico, admin o service token).
 */
export type AccessiScopedClient<TModule extends object> = TModule & {
  /** Sostituisce la configurazione dell'istanza senza toccare quella globale. */
  configure(config: AccessiClientConfig): void;
  /** Copia della configurazione corrente dell'istanza. */
  getConfig(): AccessiClientConfig;
};

/**
 * Avvolge un modulo generato da Orval con una configurazione per istanza.
 *
 * La configurazione viene applicata alla singola chiamata tramite
 * `runWithAccessiClient`, quindi istanze diverse possono chiamare in concorrenza
 * senza sovrascriversi. Le funzioni in `TModule` sono le sole esposte.
 */
export function createAccessiClientFromModule<TModule extends object>(
  api: TModule,
  config: AccessiClientConfig = {},
): AccessiScopedClient<TModule> {
  let current: AccessiClientConfig = { ...config };

  return new Proxy(api as AccessiScopedClient<TModule>, {
    get(target, property, receiver) {
      if (property === 'configure') {
        return (next: AccessiClientConfig) => {
          current = { ...next };
        };
      }
      if (property === 'getConfig') {
        return () => ({ ...current });
      }

      const value = Reflect.get(target, property, receiver) as unknown;
      if (typeof value !== 'function') return value;

      return (...args: unknown[]) =>
        runWithAccessiClient(current, () => (value as (...callArgs: unknown[]) => unknown)(...args));
    },
  });
}
