import { recordAccessiDuration, recordAccessiMetric } from './metrics';

/** Client Redis minimo usato dagli store Accessi. */
export interface AccessiRedisEvalClient {
  eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown>;
}

/**
 * Avvolge un client Redis per misurare errori e latenza degli script Lua.
 *
 * Gli store accettano qualsiasi client con `eval` (ioredis, node-redis, client
 * di test). Il wrapper e trasparente: altri metodi (`quit`, `command`, ...)
 * restano disponibili e legati all'istanza originale.
 */
export function instrumentAccessiRedisClient<T extends AccessiRedisEvalClient>(
  store: string,
  client: T,
): T {
  return new Proxy(client, {
    get(target, property) {
      if (property === 'eval') {
        return async (script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown> => {
          const startedAt = Date.now();
          try {
            return await target.eval(script, numKeys, ...args);
          } catch (error) {
            recordAccessiMetric('accessi_store_errors_total', 1, { store });
            throw error;
          } finally {
            recordAccessiDuration('accessi_store_operation_duration_ms', Date.now() - startedAt, { store });
          }
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as T;
}
