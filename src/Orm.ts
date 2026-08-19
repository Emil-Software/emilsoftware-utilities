import * as Firebird from "es-node-firebird";
import { Logger } from "./Logger";
import { Database, Options, Transaction } from "es-node-firebird";
import { RestUtilities } from "./Utilities";
import {
    buildFirebirdCompatibilityCandidates,
    describeFirebirdCompatibilityOptions,
    ensureEsNodeFirebirdCompatibilityPatch,
    FirebirdOptions,
    shouldRetryFirebirdCompatibility,
} from "./firebird-compat";

ensureEsNodeFirebirdCompatibilityPatch();

export class Orm {
    private static logger: Logger = new Logger(Orm.name);

    public static quote(value: string): string {
        return "\"" + value + "\"";
    }

    private static getTimeoutMs(options: Options): number {
        const candidate = (options as FirebirdOptions).connectTimeoutMs
            ?? (options as FirebirdOptions).connectTimeout
            ?? 15000;

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

    private static attachOnceWithTimeout(options: Options): Promise<Database> {
        return new Promise((resolve, reject): void => {
            const timeoutMs = this.getTimeoutMs(options);
            let settled = false;
            const timeoutId = setTimeout(() => {
                if (settled) {
                    return;
                }

                settled = true;
                reject(this.createTimeoutError("attach", timeoutMs, options));
            }, timeoutMs);

            Firebird.attach(options, async (err: any, db: Database): Promise<void> => {
                if (settled) {
                    await this.detachQuietly(db);
                    return;
                }

                settled = true;
                clearTimeout(timeoutId);

                if (err) {
                    this.logger.error(err);
                    return reject(err);
                }

                return resolve(db);
            });
        });
    }

    private static async attachWithTimeout(options: Options): Promise<Database> {
        const candidates = buildFirebirdCompatibilityCandidates(options);
        let lastError: unknown;

        for (let index = 0; index < candidates.length; index++) {
            const candidate = candidates[index];

            try {
                if (index > 0) {
                    this.logger.warning(
                        `Retry Firebird attach with compatibility fallback ${index + 1}/${candidates.length}: ${describeFirebirdCompatibilityOptions(candidate)}`
                    );
                }

                return await this.attachOnceWithTimeout(candidate);
            } catch (error) {
                lastError = error;

                if (!shouldRetryFirebirdCompatibility(error) || index === candidates.length - 1) {
                    throw error;
                }

                this.logger.warning(
                    `Firebird attach failed with ${describeFirebirdCompatibilityOptions(candidate)}. Retrying compatibility fallback. Error: ${String((error as { message?: unknown })?.message ?? error)}`
                );
            }
        }

        throw lastError;
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

    public static async query(options: Options, query: string, parameters: any[] = [], logQuery = true): Promise<any> {
        try {
            const db = await this.attachWithTimeout(options);

            return await new Promise((resolve, reject): void => {
                const timeoutMs = this.getTimeoutMs(options);
                let settled = false;
                const timeoutId = setTimeout(async () => {
                    if (settled) {
                        return;
                    }

                    settled = true;
                    await this.detachQuietly(db);
                    reject(this.createTimeoutError("query", timeoutMs, options, query));
                }, timeoutMs);

                if (logQuery) {
                    this.logger.info(RestUtilities.printQueryWithParams(query, parameters));
                }

                db.query(query, parameters, async (error: any, result: any) => {
                    if (settled) {
                        await this.detachQuietly(db);
                        return;
                    }

                    settled = true;
                    clearTimeout(timeoutId);
                    await this.detachQuietly(db);

                    if (error) {
                        this.logger.error(error);
                        return reject(error);
                    }

                    return resolve(result);
                });
            });
        } catch (error) {
            this.logger.error(error as object);
            throw error;
        }
    }

    public static async execute(options: Options, query: string, parameters: any = [], logQuery = true): Promise<any> {
        try {
            const db = await this.attachWithTimeout(options);

            return await new Promise((resolve, reject): void => {
                const timeoutMs = this.getTimeoutMs(options);
                let settled = false;
                const timeoutId = setTimeout(async () => {
                    if (settled) {
                        return;
                    }

                    settled = true;
                    await this.detachQuietly(db);
                    reject(this.createTimeoutError("execute", timeoutMs, options, query));
                }, timeoutMs);

                if (logQuery) {
                    this.logger.info(RestUtilities.printQueryWithParams(query, parameters));
                }

                db.execute(query, parameters, async (error: any, result: any) => {
                    if (settled) {
                        await this.detachQuietly(db);
                        return;
                    }

                    settled = true;
                    clearTimeout(timeoutId);
                    await this.detachQuietly(db);

                    if (error) {
                        this.logger.error(error);
                        return reject(error);
                    }

                    return resolve(result);
                });
            });
        } catch (error) {
            this.logger.error(error as object);
            throw error;
        }
    }

    public static trimParam(param: any): string {
        if (typeof param === "string" || param instanceof String) {
            return param.trim();
        }
        return param;
    }

    public static async connect(options: Options): Promise<Database> {
        return this.attachWithTimeout(options);
    }

    public static async startTransaction(db: Database): Promise<Transaction> {
        return new Promise((resolve, reject): void => {
            db.transaction(Firebird.ISOLATION_READ_COMMITTED, function (err: any, transaction: Transaction): void {
                if (err) return reject(err); else return resolve(transaction);
            });
        });
    }

    public static async commitTransaction(transaction: Transaction): Promise<string> {
        return new Promise((resolve, reject): void => {
            transaction.commit((err: any): void => {
                if (err) return reject(err); else return resolve("Transaction committed successfully.");
            });
        });
    }

    public static async rollbackTransaction(transaction: Transaction): Promise<string> {
        return new Promise((resolve, reject): void => {
            transaction.rollback((err: any): void => {
                if (err) return reject(err); else return resolve("Transaction rolled back successfully.");
            });
        });
    }

    public static async executeMultiple(options: Options, queriesWithParams: { query: string, params: any[] }[]): Promise<string> {
        let db: Database | undefined;
        let transaction: Transaction | undefined;

        try {
            db = await Orm.connect(options);
            transaction = await Orm.startTransaction(db);

            for (const qwp of queriesWithParams) {
                await new Promise((resolve, reject) => {
                    transaction.query(qwp.query, qwp.params, (err: any, result: any): void => {
                        if (err) return reject(err);
                        else return resolve(result);
                    });
                });
            }

            await Orm.commitTransaction(transaction);
            await Orm.detachQuietly(db);
            return "OK";

        } catch (error) {
            if (transaction) {
                await Orm.rollbackTransaction(transaction);
            }
            await Orm.detachQuietly(db);
            throw error;
        }
    }

    public static async executeQueries(transaction: Transaction, queries: string[], params: any[]): Promise<any> {
        try {
            return await queries.reduce((promiseChain: Promise<any>, currentQuery: string, index: number) => {
                return promiseChain.then(() => new Promise((resolve, reject) => {
                    transaction.query(currentQuery, params[index], (err: any, result: any): void => {
                        if (err) return reject(err);
                        else return resolve(result);
                    });
                }));
            }, Promise.resolve());
        } catch (error) {
            return await new Promise((resolve, reject) => {
                transaction.rollback((rollbackErr: any): void => {
                    if (rollbackErr) {
                        return reject(rollbackErr);
                    } else {
                        return reject(error);
                    }
                });
            });
        }
    }
}
