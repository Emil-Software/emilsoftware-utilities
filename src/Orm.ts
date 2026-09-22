import * as Firebird from "node-firebird";
import { ConnectionPool, Database, Options, QueryParams, Transaction } from "node-firebird";
import { Logger } from "./Logger";
import { RestUtilities } from "./Utilities";
import {
    describeFirebirdCompatibilityOptions,
    enhanceFirebirdError,
    FirebirdOptions,
    normalizeFirebirdOptions,
} from "./firebird-compat";

export class Orm {
    private static logger: Logger = new Logger(Orm.name);
    private static pools: Map<string, ConnectionPool> = new Map();

    public static quote(value: string): string {
        return "\"" + value + "\"";
    }

    private static getPoolSize(options: Options): number {
        const size = Number((options as FirebirdOptions).poolSize);
        return Number.isFinite(size) && size > 0 ? Math.trunc(size) : 0;
    }

    private static shouldLogQueryParameters(options: Options): boolean {
        return (options as FirebirdOptions).logQueryParameters === true;
    }

    private static formatQueryForLog(query: string, parameters: QueryParams, includeValues: boolean): string {
        const parameterList = Array.isArray(parameters) ? parameters : Object.values(parameters ?? {});
        if (includeValues) {
            return RestUtilities.printQueryWithParams(query, parameterList);
        }
        return `${query.replace(/\s+/g, " ").trim()} [params=${parameterList.length}]`;
    }

    private static buildPoolKey(options: Options, size: number): string {
        const normalized = normalizeFirebirdOptions(options);
        return [
            size,
            normalized.host ?? "",
            normalized.port ?? "",
            normalized.database ?? "",
            normalized.user ?? "",
            normalized.pluginName ?? "",
            String(normalized.wireCrypt ?? ""),
        ].join("|");
    }

    /**
     * Chiude tutti i pool creati (opt-in `poolSize`). Utile a fine processo o nei test,
     * perché i pool mantengono connessioni e timer attivi.
     */
    public static async closePools(): Promise<void> {
        const pools = Array.from(this.pools.values());
        this.pools.clear();
        await Promise.all(pools.map((pool) => new Promise<void>((resolve) => {
            try {
                pool.destroy(() => resolve());
            } catch {
                resolve();
            }
        })));
    }

    private static getPool(options: Options, size: number): ConnectionPool {
        const normalized = normalizeFirebirdOptions(options);
        const key = this.buildPoolKey(normalized, size);
        let pool = this.pools.get(key);
        if (!pool) {
            this.logger.info(`Firebird pool created (max=${size}) using ${describeFirebirdCompatibilityOptions(normalized)}`);
            pool = Firebird.pool(size, normalized);
            pool.on("error", (error: Error) => {
                this.logger.error(`Firebird pool error: ${error.message}`);
            });
            this.pools.set(key, pool);
        }
        return pool;
    }

    private static getTimeoutMs(options: Options): number {
        const candidate = (options as FirebirdOptions).connectTimeout ?? 15000;
        return Number.isFinite(candidate) && candidate > 0 ? Math.trunc(candidate) : 15000;
    }

    private static createTimeoutError(stage: string, timeoutMs: number, options: Options, query?: string): Error {
        const target = `${options.host ?? "?"}:${options.port ?? "?"} -> ${options.database ?? "?"}`;
        const suffix = query ? ` | sql=${query.replace(/\s+/g, " ").trim()}` : "";
        return new Error(`Timeout during Firebird ${stage} after ${timeoutMs} ms on ${target}${suffix}`);
    }

    private static async detachQuietly(db: Database | undefined): Promise<void> {
        if (!db) {
            return;
        }

        await new Promise<void>((resolve) => {
            try {
                db.detach(() => resolve());
            } catch {
                resolve();
            }
        });
    }

    private static shouldTrimStringResults(options: FirebirdOptions): boolean {
        return options.trimStringResults !== false;
    }

    private static normalizeResultValue(value: unknown, trimStringResults: boolean): unknown {
        if (!trimStringResults || value === undefined || value === null) {
            return value;
        }

        if (typeof value === "string" || value instanceof String) {
            return String(value).trimEnd();
        }

        if (Array.isArray(value)) {
            return value.map((item) => this.normalizeResultValue(item, trimStringResults));
        }

        if (value instanceof Date || Buffer.isBuffer(value)) {
            return value;
        }

        if (typeof value === "object") {
            const source = value as Record<string, unknown>;
            return Object.keys(source).reduce((normalized: Record<string, unknown>, key: string) => {
                normalized[key] = this.normalizeResultValue(source[key], trimStringResults);
                return normalized;
            }, {});
        }

        return value;
    }

    private static attachWithTimeout(options: Options): Promise<Database> {
        return new Promise((resolve, reject): void => {
            const normalizedOptions = normalizeFirebirdOptions(options);
            const timeoutMs = this.getTimeoutMs(normalizedOptions);
            const poolSize = this.getPoolSize(options);
            let settled = false;
            const timeoutId = setTimeout(() => {
                if (settled) {
                    return;
                }

                settled = true;
                reject(
                    enhanceFirebirdError(
                        this.createTimeoutError("attach", timeoutMs, normalizedOptions),
                        normalizedOptions,
                        { stage: "attach" },
                    ),
                );
            }, timeoutMs);

            const handle = async (err: unknown, db: Database): Promise<void> => {
                if (settled) {
                    await this.detachQuietly(db);
                    return;
                }

                settled = true;
                clearTimeout(timeoutId);

                if (err) {
                    return reject(enhanceFirebirdError(err, normalizedOptions, { stage: "attach" }));
                }

                return resolve(db);
            };

            try {
                if (poolSize > 0) {
                    this.getPool(options, poolSize).get(handle);
                    return;
                }

                this.logger.info(`Firebird attach using ${describeFirebirdCompatibilityOptions(normalizedOptions)}`);

                Firebird.attach(normalizedOptions, handle);
            } catch (error) {
                // Attach/get sincrono fallito: evita di lasciare il timer di timeout pendente.
                if (!settled) {
                    settled = true;
                    clearTimeout(timeoutId);
                    reject(enhanceFirebirdError(error, normalizedOptions, { stage: "attach" }));
                }
            }
        });
    }

    public static async testConnection(options: Options): Promise<boolean> {
        return new Promise((resolve): void => {
            this.attachWithTimeout(options)
                .then(async (db: Database): Promise<void> => {
                    this.logger.info("DATABASE connesso.");
                    await this.detachQuietly(db);
                    resolve(true);
                })
                .catch((err: Error): void => {
                    this.logger.error("La connessione con il DATABASE non e andata a buon fine.");
                    this.logger.error(err);
                    resolve(false);
                });
        });
    }

    public static async query<T = Record<string, unknown>>(
        options: Options,
        query: string,
        parameters: QueryParams = [],
        logQuery = true,
    ): Promise<T[]> {
        try {
            const normalizedOptions = normalizeFirebirdOptions(options);
            const db = await this.attachWithTimeout(options);

            return await new Promise<T[]>((resolve, reject): void => {
                const timeoutMs = this.getTimeoutMs(normalizedOptions);
                let settled = false;
                const timeoutId = setTimeout(async () => {
                    if (settled) {
                        return;
                    }

                    settled = true;
                    await this.detachQuietly(db);
                    reject(
                        enhanceFirebirdError(
                            this.createTimeoutError("query", timeoutMs, normalizedOptions, query),
                            normalizedOptions,
                            { stage: "query", sql: query },
                        ),
                    );
                }, timeoutMs);

                if (logQuery) {
                    this.logger.info(this.formatQueryForLog(query, parameters, this.shouldLogQueryParameters(options)));
                }

                db.query<unknown>(query, parameters, async (error: unknown, result: unknown[]) => {
                    if (settled) {
                        await this.detachQuietly(db);
                        return;
                    }

                    settled = true;
                    clearTimeout(timeoutId);
                    await this.detachQuietly(db);

                    if (error) {
                        return reject(enhanceFirebirdError(error, normalizedOptions, { stage: "query", sql: query }));
                    }

                    return resolve(this.normalizeResultValue(result, this.shouldTrimStringResults(normalizedOptions)) as T[]);
                });
            });
        } catch (error) {
            const normalizedError = enhanceFirebirdError(error, options, { stage: "query", sql: query });
            this.logger.error(normalizedError);
            throw normalizedError;
        }
    }

    public static async execute<T = Record<string, unknown>>(
        options: Options,
        query: string,
        parameters: QueryParams = [],
        logQuery = true,
    ): Promise<T[]> {
        try {
            const normalizedOptions = normalizeFirebirdOptions(options);
            const db = await this.attachWithTimeout(options);

            return await new Promise<T[]>((resolve, reject): void => {
                const timeoutMs = this.getTimeoutMs(normalizedOptions);
                let settled = false;
                const timeoutId = setTimeout(async () => {
                    if (settled) {
                        return;
                    }

                    settled = true;
                    await this.detachQuietly(db);
                    reject(
                        enhanceFirebirdError(
                            this.createTimeoutError("execute", timeoutMs, normalizedOptions, query),
                            normalizedOptions,
                            { stage: "execute", sql: query },
                        ),
                    );
                }, timeoutMs);

                if (logQuery) {
                    this.logger.info(this.formatQueryForLog(query, parameters, this.shouldLogQueryParameters(options)));
                }

                db.execute<unknown>(query, parameters, async (error: unknown, result: unknown[]) => {
                    if (settled) {
                        await this.detachQuietly(db);
                        return;
                    }

                    settled = true;
                    clearTimeout(timeoutId);
                    await this.detachQuietly(db);

                    if (error) {
                        return reject(enhanceFirebirdError(error, normalizedOptions, { stage: "execute", sql: query }));
                    }

                    return resolve(this.normalizeResultValue(result, this.shouldTrimStringResults(normalizedOptions)) as T[]);
                });
            });
        } catch (error) {
            const normalizedError = enhanceFirebirdError(error, options, { stage: "execute", sql: query });
            this.logger.error(normalizedError);
            throw normalizedError;
        }
    }

    public static trimParam<T>(param: T): string | T {
        if (typeof param === "string" || param instanceof String) {
            return String(param).trim();
        }
        return param;
    }

    public static async connect(options: Options): Promise<Database> {
        return this.attachWithTimeout(options);
    }

    /**
     * Runs `operation` inside a single Firebird transaction: commit on success,
     * rollback on failure, detach in every case. Use it to make multi-statement
     * writes atomic instead of relying on auto-commit per statement.
     */
    public static async withTransaction<T>(
        options: Options,
        operation: (transaction: Transaction) => Promise<T>,
    ): Promise<T> {
        const db = await this.connect(options);
        let transaction: Transaction | undefined;

        try {
            transaction = await this.startTransaction(db);
            const result = await operation(transaction);
            await this.commitTransaction(transaction);
            return result;
        } catch (error) {
            if (transaction) {
                try {
                    await this.rollbackTransaction(transaction);
                } catch {
                    // Se la rollback fallisce (connessione persa) l'errore originale resta quello rilevante.
                }
            }
            throw error;
        } finally {
            await this.detachQuietly(db);
        }
    }

    /** Esegue una query su una transazione esistente e ne restituisce il risultato. */
    public static transactionQuery<T = unknown>(
        transaction: Transaction,
        query: string,
        parameters: QueryParams = [],
    ): Promise<T> {
        return new Promise<T>((resolve, reject): void => {
            transaction.query(query, parameters, (error: unknown, result: unknown[]): void => {
                if (error) {
                    reject(error);
                    return;
                }

                resolve(result as T);
            });
        });
    }

    public static async startTransaction(db: Database): Promise<Transaction> {
        return new Promise((resolve, reject): void => {
            db.transaction(Firebird.ISOLATION_READ_COMMITTED, function (err: unknown, transaction: Transaction): void {
                if (err) {
                    return reject(err);
                }

                return resolve(transaction);
            });
        });
    }

    public static async commitTransaction(transaction: Transaction): Promise<string> {
        return new Promise((resolve, reject): void => {
            transaction.commit((err: unknown): void => {
                if (err) {
                    return reject(err);
                }

                return resolve("Transaction committed successfully.");
            });
        });
    }

    public static async rollbackTransaction(transaction: Transaction): Promise<string> {
        return new Promise((resolve, reject): void => {
            transaction.rollback((err: unknown): void => {
                if (err) {
                    return reject(err);
                }

                return resolve("Transaction rolled back successfully.");
            });
        });
    }

    public static async executeMultiple(options: Options, queriesWithParams: { query: string, params: QueryParams }[]): Promise<string> {
        await Orm.withTransaction(options, async (transaction) => {
            for (const qwp of queriesWithParams) {
                await Orm.transactionQuery(transaction, qwp.query, qwp.params);
            }
        });

        return "OK";
    }

    public static async executeQueries(transaction: Transaction, queries: string[], params: QueryParams[]): Promise<unknown> {
        try {
            return await queries.reduce((promiseChain: Promise<unknown>, currentQuery: string, index: number) => {
                return promiseChain.then(() => new Promise((resolve, reject) => {
                    transaction.query(currentQuery, params[index] ?? [], (err: unknown, result: unknown[]): void => {
                        if (err) {
                            return reject(err);
                        }

                        return resolve(result);
                    });
                }));
            }, Promise.resolve());
        } catch (error) {
            return await new Promise((_resolve, reject) => {
                transaction.rollback((rollbackErr: unknown): void => {
                    if (rollbackErr) {
                        return reject(rollbackErr);
                    }

                    return reject(error);
                });
            });
        }
    }
}
