import Transport from 'winston-transport';
import { appendFile, appendFileSync, mkdirSync } from 'fs';
import { join } from 'path';

/** One append-only JSON-lines file per local calendar day, including idle days. */
export class DailyFileTransport extends Transport {
    private timer?: NodeJS.Timeout;

    constructor(private readonly directory: string) {
        super();
        mkdirSync(directory, { recursive: true });
        this.touchToday();
        this.scheduleMidnight();
    }

    private filename(date: Date): string {
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return join(this.directory, `${date.getFullYear()}-${month}-${day}.json`);
    }

    private touchToday(): void {
        appendFileSync(this.filename(new Date()), '', { flag: 'a' });
    }

    private scheduleMidnight(): void {
        const now = new Date();
        const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
        this.timer = setTimeout(() => {
            try {
                this.touchToday();
            } catch (error) {
                this.emit('error', error);
            } finally {
                this.scheduleMidnight();
            }
        }, Math.max(1, midnight.getTime() - now.getTime()));
        this.timer.unref();
    }

    log(info: any, callback: (error?: Error | null) => void): void {
        // Capture the event's day even when the transport is draining a backlog.
        const date = info.time instanceof Date ? info.time : new Date();
        appendFile(this.filename(date), `${info[Symbol.for('message')]}\n`, { flag: 'a' }, (error) => {
            if (!error) this.emit('logged', info);
            callback(error);
        });
    }

    close(): void {
        if (this.timer) clearTimeout(this.timer);
    }

    logv(chunks: { chunk: any }[], callback: (error?: Error | null) => void): void {
        let index = 0;
        const next = (error?: Error | null) => {
            if (error || index === chunks.length) return callback(error);
            this.log(chunks[index++].chunk, next);
        };
        next();
    }
}
