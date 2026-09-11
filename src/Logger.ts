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

export class Logger {
    private readonly winstonLogger: winston.Logger;
    private readonly tag: string;
    private readonly logDirectory: string;
    private logFormat: winston.Logform.Format;

    constructor(
        tag: string,
        config?: {
            logDirectory?: string;
            customFormat?: winston.Logform.Format;
            transports?: winston.transport[];
        }
    ) {
        this.tag = tag || "[UNTAGGED]";
        this.logDirectory = config?.logDirectory || "logs";

        // Default log format
        this.logFormat =
            config?.customFormat ||
            winston.format.printf(({ timestamp, file, level, message, ...meta }) => {
                return JSON.stringify({
                    timestamp: timestamp || new Date().toISOString(),
                    tag: this.tag,
                    file: this.replaceAll(file + "", "\\", "/"),
                    level: level === 'general' ? 'log' : level,
                    message,
                    ...meta,
                });
            });

        // Configure logger
        this.winstonLogger = winston.createLogger({
            level: 'database',
            format: winston.format.combine(winston.format.timestamp(), this.logFormat),
            transports: config?.transports || [
                new DailyFileTransport(this.logDirectory),
            ],
            levels: {
                error: 1,
                warning: 2,
                info: 3,
                general: 3,
                http: 4,
                verbose: 5,
                debug: 6,
                silly: 7,
                database: 8,
            },
        });

        // Add colors for console logging
        winston.addColors({
            database: "green",
            error: "red",
            warning: "yellow",
            info: "blue",
            debug: "magenta",
            log: "cyan",
        });
    }

    private replaceAll(string: string, match: string, replacer: string) {
        return string.split(match).join(replacer);
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

    public info(...data: Object[]): void {
        this.print(LogLevels.INFO, ...data);
    }

    public dbLog(...data: Object[]): void {
        this.print(LogLevels.DATABASE, ...data);
    }

    public debug(...data: Object[]): void {
        this.print(LogLevels.DEBUG, ...data);
    }

    public warning(...data: Object[]): void {
        this.print(LogLevels.WARNING, ...data);
    }

    public log(...data: Object[]): void {
        this.print(LogLevels.LOG, ...data);
    }

    public error(...data: Object[]): void {
        this.print(LogLevels.ERROR, ...data);
    }

    private print(level: LogLevels, ...data: Object[]): void {
        const now: Date = new Date();
        const fileName = this.tag.split("\\").pop() || this.tag;

        // Attach metadata to Winston logger
        this.winstonLogger.defaultMeta = {
            file: fileName,
            time: now,
        };

        const logEntry: winston.LogEntry = {
            level: level === LogLevels.LOG ? 'general' : level.toLowerCase(),
            message: [...data].join(","),
        };

        // Log to console with colors
        switch (level) {
            case LogLevels.INFO:
                console.info(blue(`[INFO][${now}][${fileName}]`), logEntry.message);
                break;
            case LogLevels.ERROR:
                console.error(red(`[ERROR][${now}][${fileName}]`), logEntry.message);
                break;
            case LogLevels.DEBUG:
                console.debug(magenta(`[DEBUG][${now}][${fileName}]`), logEntry.message);
                break;
            case LogLevels.WARNING:
                console.debug(yellow(`[WARNING][${now}][${fileName}]`), logEntry.message);
                break;
            case LogLevels.LOG:
                console.log(cyan(`[LOG][${now}][${fileName}]`), logEntry.message);
                break;
            case LogLevels.DATABASE:
                console.log(green(`[DATABASE][${now}][${fileName}]`), logEntry.message);
                break;
        }

        // Log to file
        this.winstonLogger.log(logEntry);
    }

    public static createLogger(tag: string, config?: { logDirectory?: string }): Logger {
        return new Logger(tag, config);
    }
}
