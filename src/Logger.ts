import winston from "winston";
import { DailyFileTransport } from './DailyFileTransport';
import { blue, red, magenta, green, cyan, yellow } from 'colorette';

export enum LogLevels {
    INFO = "INFO",
    ERROR = "ERROR",
    WARNING = "WARNING",
    DEBUG = "DEBUG",
    LOG = "LOG",
    DATABASE = "DATABASE",
}

/** Livelli winston usati dal logger (comprende `database` e `general`). */
const WIN_LEVELS = {
    error: 1,
    warning: 2,
    info: 3,
    general: 3,
    http: 4,
    verbose: 5,
    debug: 6,
    silly: 7,
    database: 8,
};

/** Chiavi i cui valori non devono mai finire nei log. */
const SENSITIVE_KEY_PATTERN = /(password|passwd|pwd|secret|token|authorization|apikey|api_key|cookie)/i;
const REDACTED = '[REDACTED]';

/**
 * Serializza un valore per il log, redigendo i campi sensibili e risolvendo
 * `Error` e riferimenti circolari (che altrimenti diventano `[object Object]`).
 */
function serializeLogValue(value: unknown, seen: WeakSet<object>): unknown {
    if (value instanceof Error) {
        return { name: value.name, message: value.message, stack: value.stack };
    }

    if (Array.isArray(value)) {
        return value.map((item) => serializeLogValue(item, seen));
    }

    if (value && typeof value === 'object') {
        if (seen.has(value)) {
            return '[Circular]';
        }
        seen.add(value);

        const result: Record<string, unknown> = {};
        for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
            result[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : serializeLogValue(nested, seen);
        }
        return result;
    }

    return value;
}

/** Costruisce il messaggio testuale del log a partire dagli argomenti. */
function stringifyLogData(data: unknown[]): string {
    return data.map((value) => {
        if (typeof value === 'string') {
            return value;
        }
        if (value instanceof Error) {
            return value.stack ?? `${value.name}: ${value.message}`;
        }
        if (value === undefined) {
            return 'undefined';
        }
        if (value === null) {
            return 'null';
        }
        try {
            return JSON.stringify(serializeLogValue(value, new WeakSet()));
        } catch {
            return String(value);
        }
    }).join(', ');
}

/** Formato condiviso: JSON a una riga, con tag/file/level/messaggio. */
function defaultFormat(): winston.Logform.Format {
    return winston.format.printf(({ timestamp, tag, file, level, message, ...meta }) => JSON.stringify({
        timestamp: timestamp || new Date().toISOString(),
        tag,
        file: String(file ?? '').split('\\').join('/'),
        level: level === 'general' ? 'log' : level,
        message,
        ...meta,
    }));
}

/**
 * Logger strutturato dell'applicazione.
 *
 * - I log finiscono su console (colorati) e su file JSON giornaliero.
 * - Le istanze con la stessa `logDirectory` condividono un unico logger winston
 *   (un solo transport/timer), evitando di crearne uno per classe.
 * - I campi sensibili (password, token, secret, ...) sono redatti automaticamente.
 */
export class Logger {
    private readonly winstonLogger: winston.Logger;
    private readonly tag: string;
    private readonly logDirectory: string;
    private readonly maxLevel: number;

    /** Logger winston condivisi per directory, così da non moltiplicare transport e timer. */
    private static readonly sharedLoggers = new Map<string, winston.Logger>();
    private static colorsRegistered = false;

    constructor(
        tag: string,
        config?: {
            logDirectory?: string;
            customFormat?: winston.Logform.Format;
            transports?: winston.transport[];
            /** Livello minimo loggato: `error`..`database` (default `database`, ovvero tutto). Override con `LOG_LEVEL`. */
            level?: string;
        }
    ) {
        this.tag = tag || "[UNTAGGED]";
        this.logDirectory = config?.logDirectory || "logs";

        const configuredLevel = (config?.level ?? process.env.LOG_LEVEL ?? 'database').toLowerCase();
        this.maxLevel = WIN_LEVELS[configuredLevel as keyof typeof WIN_LEVELS] ?? WIN_LEVELS.database;

        const format = winston.format.combine(
            winston.format.timestamp(),
            config?.customFormat || defaultFormat(),
        );

        this.winstonLogger = config?.transports
            ? winston.createLogger({ level: 'database', format, transports: config.transports, levels: WIN_LEVELS })
            : Logger.resolveSharedLogger(this.logDirectory, format);

        if (!Logger.colorsRegistered) {
            winston.addColors({
                database: "green",
                error: "red",
                warning: "yellow",
                info: "blue",
                debug: "magenta",
                log: "cyan",
            });
            Logger.colorsRegistered = true;
        }
    }

    private static resolveSharedLogger(logDirectory: string, format: winston.Logform.Format): winston.Logger {
        const existing = Logger.sharedLoggers.get(logDirectory);
        if (existing) {
            return existing;
        }

        const logger = winston.createLogger({
            level: 'database',
            format,
            transports: [new DailyFileTransport(logDirectory)],
            levels: WIN_LEVELS,
        });
        Logger.sharedLoggers.set(logDirectory, logger);
        return logger;
    }

    public execStart(prefix: string = ""): number {
        this.print(LogLevels.INFO, `${prefix} - Execution started`);
        return performance.now();
    }

    public execStop(prefix: string = "", startTime: number, error: boolean = false): void {
        const executionTime = performance.now() - startTime;
        const message = `${prefix} - Execution ended ${error ? "due to an error" : "successfully"
            }. Execution time: ${executionTime.toFixed(2)} ms`;
        this.print(error ? LogLevels.ERROR : LogLevels.INFO, message);
    }

    public info(...data: unknown[]): void {
        this.print(LogLevels.INFO, ...data);
    }

    public dbLog(...data: unknown[]): void {
        this.print(LogLevels.DATABASE, ...data);
    }

    public debug(...data: unknown[]): void {
        this.print(LogLevels.DEBUG, ...data);
    }

    public warning(...data: unknown[]): void {
        this.print(LogLevels.WARNING, ...data);
    }

    public log(...data: unknown[]): void {
        this.print(LogLevels.LOG, ...data);
    }

    public error(...data: unknown[]): void {
        this.print(LogLevels.ERROR, ...data);
    }

    private print(level: LogLevels, ...data: unknown[]): void {
        const rank = level === LogLevels.LOG ? WIN_LEVELS.general : (WIN_LEVELS[level.toLowerCase() as keyof typeof WIN_LEVELS] ?? WIN_LEVELS.database);
        if (rank > this.maxLevel) {
            return;
        }

        const now: Date = new Date();
        const fileName = this.tag.split("\\").pop() || this.tag;
        const message = stringifyLogData(data);

        // Console colorata (il livello file resta strutturato).
        switch (level) {
            case LogLevels.INFO:
                console.info(blue(`[INFO][${now}][${fileName}]`), message);
                break;
            case LogLevels.ERROR:
                console.error(red(`[ERROR][${now}][${fileName}]`), message);
                break;
            case LogLevels.DEBUG:
                console.debug(magenta(`[DEBUG][${now}][${fileName}]`), message);
                break;
            case LogLevels.WARNING:
                console.debug(yellow(`[WARNING][${now}][${fileName}]`), message);
                break;
            case LogLevels.LOG:
                console.log(cyan(`[LOG][${now}][${fileName}]`), message);
                break;
            case LogLevels.DATABASE:
                console.log(green(`[DATABASE][${now}][${fileName}]`), message);
                break;
        }

        this.winstonLogger.log({
            level: level === LogLevels.LOG ? 'general' : level.toLowerCase(),
            message,
            tag: this.tag,
            file: fileName,
            time: now,
        });
    }

    public static createLogger(tag: string, config?: { logDirectory?: string }): Logger {
        return new Logger(tag, config);
    }
}
