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
    private static compatibilityProfileCache: Map<string, FirebirdOptions> = new Map<string, FirebirdOptions>();

    public static quote(value: string): string {
        return "\"" + value + "\"";
    }

    private static getTimeoutMs(options: Options): number {
        const candidate = (options as FirebirdOptions).connectTimeoutMs
            ?? (options as FirebirdOptions).compatibilityTotalTimeoutMs
            ?? (options as FirebirdOptions).connectTimeout
            ?? 15000;

        return Number.isFinite(candidate) && candidate > 0 ? Math.trunc(candidate) : 15000;
    }

    private static createTimeoutError(stage: string, timeoutMs: number, options: Options, query?: string): Error {
        const target = `${options.host ?? "?"}:${options.port ?? "?"} -> ${options.database ?? "?"}`;
        const suffix = query ? ` | sql=${query.replace(/\s+/g, " ").trim()}` : "";
        return new Error(`Timeout during Firebird ${stage} after ${timeoutMs} ms on ${target}${suffix}`);
    }

    private static createCompatibilityCacheKey(options: Options): string {
        return [
            options.host ?? "?",
            options.port ?? "?",
            options.database ?? "?",
            options.user ?? "?",
        ].join("|");
    }

    private static getProbeTimeoutMs(options: Options, candidateCount: number): number {
        const configured = (options as FirebirdOptions).compatibilityProbeTimeoutMs;
        if (Number.isFinite(configured) && configured! > 0) {
            return Math.trunc(configured!);
        }

        const totalTimeoutMs = this.getTimeoutMs(options);
        if (candidateCount <= 1) {
            return totalTimeoutMs;
        }

        return Math.max(2500, Math.min(5000, Math.trunc(totalTimeoutMs / candidateCount)));
    }

    private static reorderCandidatesWithCache(options: Options, candidates: FirebirdOptions[]): FirebirdOptions[] {
        const cacheKey = this.createCompatibilityCacheKey(options);
        const cachedCandidate = this.compatibilityProfileCache.get(cacheKey);
        if (!cachedCandidate) {
            return candidates;
        }

        const ordered = [...candidates];
        const cachedDescription = describeFirebirdCompatibilityOptions(cachedCandidate);
        const cachedIndex = ordered.findIndex((candidate) => describeFirebirdCompatibilityOptions(candidate) === cachedDescription);

        if (cachedIndex <= 0) {
            return ordered;
        }

        const [matchedCandidate] = ordered.splice(cachedIndex, 1);
        ordered.unshift(matchedCandidate);
        return ordered;
    }

    private static createCompatibilitySummaryError(options: Options, attempts: { candidate: FirebirdOptions, error: unknown }[]): Error {
        const target = `${options.host ?? "?"}:${options.port ?? "?"} -> ${options.database ?? "?"}`;
        const attemptsSummary = attempts
            .map(({ candidate, error }) => {
                const errorMessage = String((error as { message?: unknown })?.message ?? error ?? "Unknown error");
                return `[${describeFirebirdCompatibilityOptions(candidate)} => ${errorMessage}]`;
            })
            .join("; ");

        return new Error(`Unable to attach Firebird database after compatibility probing on ${target}. Attempts: ${attemptsSummary}`);
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

    private static attachOnceWithTimeout(options: Options, timeoutMs = this.getTimeoutMs(options)): Promise<Database> {
        return new Promise((resolve, reject): void => {
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
        const totalTimeoutMs = this.getTimeoutMs(options);
        const candidates = this.reorderCandidatesWithCache(options, buildFirebirdCompatibilityCandidates(options));
        const probeTimeoutMs = this.getProbeTimeoutMs(options, candidates.length);
        const startedAt = Date.now();
        const attempts: { candidate: FirebirdOptions, error: unknown }[] = [];
        const cacheKey = this.createCompatibilityCacheKey(options);

        for (let index = 0; index < candidates.length; index++) {
            const candidate = candidates[index];
            const elapsedMs = Date.now() - startedAt;
            const remainingMs = totalTimeoutMs - elapsedMs;

            if (remainingMs <= 0) {
                break;
            }

            const attemptTimeoutMs = index === 0 && candidates.length === 1
                ? remainingMs
                : Math.min(probeTimeoutMs, remainingMs);

            try {
                if (candidates.length > 1) {
                    this.logger.info(
                        `Firebird compatibility probe ${index + 1}/${candidates.length}: ${describeFirebirdCompatibilityOptions(candidate)} (timeout ${attemptTimeoutMs} ms)`
                    );
                }

                const db = await this.attachOnceWithTimeout(candidate, attemptTimeoutMs);
                this.compatibilityProfileCache.set(cacheKey, candidate);

                if (candidates.length > 1) {
                    this.logger.info(
                        `Firebird compatibility profile selected: ${describeFirebirdCompatibilityOptions(candidate)}`
                    );
                }

                return db;
            } catch (error) {
                attempts.push({ candidate, error });

                if (!shouldRetryFirebirdCompatibility(error) || index === candidates.length - 1) {
                    throw this.createCompatibilitySummaryError(options, attempts);
                }

                this.logger.warning(
                    `Firebird attach failed with ${describeFirebirdCompatibilityOptions(candidate)}. Trying next compatibility profile. Error: ${String((error as { message?: unknown })?.message ?? error)}`
                );
            }
        }

        throw this.createCompatibilitySummaryError(options, attempts);
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
