/**
 * Livelli ordinati dei grant: il middleware consente un requisito quando il livello assegnato e maggiore o uguale.
 * Le nuove configurazioni dovrebbero usare 10 (lettura) e 20 (scrittura); 30 resta per compatibilita dei dati legacy.
 */
export enum TipoAbilitazione {
    NESSUNA = 0,
    LETTURA = 10,
    SCRITTURA = 20,
    SPECIAL = 30
}
