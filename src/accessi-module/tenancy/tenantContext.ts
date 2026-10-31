import { AsyncLocalStorage } from 'node:async_hooks';

/** Contesto di richiesta per il router multi-tenant in-process. */
export interface AccessiTenantContext {
  tenantId: string;
}

const storage = new AsyncLocalStorage<AccessiTenantContext>();

/**
 * Esegue `callback` con il tenant corrente.
 *
 * Usare il router (`createAccessiTenantRouter`) per impostarlo automaticamente;
 * le API pubbliche servono a host che montano un proprio dispatcher.
 */
export function runWithAccessiTenant<T>(tenantId: string, callback: () => T): T {
  return storage.run({ tenantId }, callback);
}

/** Tenant corrente, se la richiesta e dentro `runWithAccessiTenant`/router. */
export function getAccessiTenantContext(): AccessiTenantContext | undefined {
  return storage.getStore();
}

/** Scorciatoia per il solo identificativo del tenant corrente. */
export function getAccessiTenantId(): string | undefined {
  return storage.getStore()?.tenantId;
}
