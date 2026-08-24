import { Response } from 'express';
import { Options } from "node-firebird";
import { FirebirdOptions } from "./firebird-compat";
import crypto from "crypto";


export enum StatusCode {
    Ok = 0,
    Warning = 1,
    Error = 2,
}

export class DateUtilities {
    /**
     * Pads a number with leading zeros to reach a specified length.
     * @param num - The number to pad.
     * @param totalLength - The total length of the resulting string.
     * @returns The padded string.
     */
    static addStartingZeros(num: number, totalLength: number): string {
        return String(num).padStart(totalLength, '0');
    }

    /**
     * Formats a Date object as a Moncler-style string.
     * @param dData - The date to format.
     * @param bAddMs - Whether to include milliseconds.
     * @returns The formatted date string.
     */
    static dateToMoncler(dData: Date, bAddMs: boolean = false): string {
        const yy = dData.getFullYear();
        const mm = this.addStartingZeros(dData.getMonth() + 1, 2);
        const dd = this.addStartingZeros(dData.getDate(), 2);
        const hh = this.addStartingZeros(dData.getHours(), 2);
        const nn = this.addStartingZeros(dData.getMinutes(), 2);
        const ss = this.addStartingZeros(dData.getSeconds(), 2);
        const ms = this.addStartingZeros(dData.getMilliseconds(), 3);
        return bAddMs ? `${yy}${mm}${dd}${hh}${nn}${ss}${ms}` : `${yy}${mm}${dd}${hh}${nn}${ss}`;
    }

    /**
     * Formats a Date object as a SQL-style string.
     * @param dData - The date to format.
     * @param bAddMs - Whether to include milliseconds.
     * @returns The formatted date string.
     */
    static dateToSql(dData: Date, bAddMs: boolean = false): string {
        const yy = dData.getFullYear();
        const mm = this.addStartingZeros(dData.getMonth() + 1, 2);
        const dd = this.addStartingZeros(dData.getDate(), 2);
        const hh = this.addStartingZeros(dData.getHours(), 2);
        const nn = this.addStartingZeros(dData.getMinutes(), 2);
        const ss = this.addStartingZeros(dData.getSeconds(), 2);
        const ms = this.addStartingZeros(dData.getMilliseconds(), 3);
        return bAddMs
            ? `${yy}-${mm}-${dd} ${hh}:${nn}:${ss}.${ms}`
            : `${yy}-${mm}-${dd} ${hh}:${nn}:${ss}`;
    }

    /**
     * Formats a Date object as a simple string (dd-MM-yyyy).
     * @param dData - The date to format.
     * @returns The formatted date string.
     */
    static dateToSimple(dData: Date): string {
        const yy = dData.getFullYear();
        const mm = this.addStartingZeros(dData.getMonth() + 1, 2);
        const dd = this.addStartingZeros(dData.getDate(), 2);
        return `${dd}-${mm}-${yy}`;
    }

    /**
     * Gets the current date and time as a formatted string.
     * @returns The current date and time in the format dd.MM.yyyy HH:mm:ss.
     */
    static getNowDateString(): string {
        const now: Date = new Date();
        const day = now.getDate().toString().padStart(2, "0");
        const month = (now.getMonth() + 1).toString().padStart(2, "0");
        const year = now.getFullYear();
        const hours = now.getHours().toString().padStart(2, "0");
        const minutes = now.getMinutes().toString().padStart(2, "0");
        const seconds = now.getSeconds().toString().padStart(2, "0");
        return `${day}.${month}.${year} ${hours}:${minutes}:${seconds}`;
    }

    /**
     * Parses a date string in the format dd/MM/yyyy into a Date object.
     * @param date - The date string to parse.
     * @returns A Date object.
     */
    static parseDate(date: string): Date {
        const parts: string[] = date.split("/");
        return new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
    }
}


export class RestUtilities {
    /**
     * Sends an OK message as a response.
     * @param res - Express Response object.
     * @param message - The success message.
     * @returns The Response object.
     */
    static sendOKMessage(res: Response, message: string): Response {
        return res.send({
            severity: "success",
            status: 200,
            statusCode: StatusCode.Ok,
            message,
        });
    }

    /**
     * Sends an error message as a response.
     * @param res - Express Response object.
     * @param error - The error to send.
     * @param tag - Optional tag for additional context.
     * @param status - HTTP status code (default: 500).
     * @returns The Response object.
     */
    static sendErrorMessage(res: Response, error: any, tag: string = "[BASE ERROR]", status: number = 500): Response {
        return res.status(status).send({
            severity: "error",
            status,
            statusCode: StatusCode.Error,
            message: "An error occurred",
            error: `${tag}: ${error}`,
        });
    }


    static sendUnauthorized(res: Response): Response {
        return res.status(401).send({
            severity: "error",
            statusCode: StatusCode.Error,
            message: "Non sei autorizzato",
        });
    }

    static sendInvalidCredentials(res: Response): Response {
        return res.status(401).send({
            severity: "error",
            statusCode: StatusCode.Error,
            message: "Credenziali non valide"
        });
    }

    static sendPasswordExpired(res: Response): Response {
        return res.status(403).send({
            severity: "warning",
            statusCode: StatusCode.Warning,
            code: "PASSWORD_EXPIRED",
            message: "Password scaduta. E' necessario aggiornarla"
        })
    }

    /**
     * Sends a base response with a payload.
     * @param res - Express Response object.
     * @param payload - The payload to include in the response.
     * @returns The Response object.
     */
    static sendBaseResponse(res: Response, payload: any): Response {
        try {
            payload = JSON.parse(JSON.stringify(payload));
            const response = {
                Status: {
                    errorCode: "0",
                    errorDescription: "",
                },
                Result: payload,
                Message: "Dati recuperati con successo.",
            };
            return res.send(response);
        } catch (error) {
            return this.sendErrorMessage(res, `Error sending response: ${error}`, "[UTILITIES]", 500);
        }
    }

    /**
     * Sends an execution message as a response.
     * @param res - Express Response object.
     * @param executionObject - The execution data.
     * @param title - The title of the response.
     * @returns The Response object.
     */
    static sendExecMessage(res: Response, executionObject: any, title: string): Response {
        try {
            const response = {
                Status: {
                    errorCode: "0",
                    errorDescription: "",
                },
                Sql: "",
                ID: executionObject?.id,
                data: executionObject,
                Title: title,
            };
            return res.send(response);
        } catch (error) {
            return this.sendErrorMessage(res, `Error sending execution message: ${error}`, title, 500);
        }
    }

    /**
     * Prints a SQL query with parameters replaced.
     * @param query - The SQL query.
     * @param params - The parameters to replace.
     * @returns The formatted query.
     */
    static printQueryWithParams(query: string = "", params: any[]): string {
        try {
            params.forEach(param => {
                query = query.replace("?", param);
            });
            return query;
        } catch (error) {
            throw error;
        }
    }


    public static convertKeysToCamelCase(obj: any): any {
        if (obj !== null && obj.constructor === Object) {
            return Object.keys(obj).reduce((acc: any, key: string) => {
                const camelCaseKey = key.toLowerCase().replace(/_([a-z])/g, g => g[1].toUpperCase());
                acc[camelCaseKey] = obj[key];
                return acc;
            }, {});
        }
        return obj;
    }
}


export class CryptUtilities {

    /**
 * Cifra un testo in chiaro usando l'algoritmo AES-128 in modalità ECB.
 * 
 * @param plainText - Il testo in chiaro da cifrare.
 * @param key - La chiave di cifratura (16 byte per AES-128).
 * @param outputEncoding - Codifica del risultato cifrato (predefinito: "base64").
 * @returns Il testo cifrato codificato.
 * @throws Errore in caso di problemi durante la cifratura.
 */
    public static encrypt(plainData: string, key: string, outputEncoding: BufferEncoding = "base64"): string {
        try {
            // Crea un oggetto Cipher usando AES-128 in modalità ECB
            const cipher = crypto.createCipheriv("aes-128-ecb", Buffer.from(key, "utf8"), null);

            // Cifra il testo in chiaro e finalizza il processo
            const encryptedBuffer = Buffer.concat([
                cipher.update(plainData, "utf8"),
                cipher.final(),
            ]);

            // Restituisce il risultato cifrato codificato
            return encryptedBuffer.toString(outputEncoding);
        } catch (error: any) {
            // Gestisce eventuali errori di cifratura
            throw new Error(`Errore durante la cifratura: ${error.message}`);
        }
    }

    /**
     * Decifra un testo cifrato usando l'algoritmo AES-128 in modalità ECB.
     * 
     * @param encryptedData - Il testo cifrato da decifrare.
     * @param key - La chiave di decifratura (16 byte per AES-128).
     * @returns Il testo decifrato o null in caso di errore.
     */
    public static decrypt(encryptedData: string, key: string): string | null {
        try {
            // Crea un oggetto Decipher usando AES-128 in modalità ECB
            const decipher = crypto.createDecipheriv("aes-128-ecb", Buffer.from(key, "utf8"), null);
            decipher.setAutoPadding(false);

            // Decifra il testo cifrato
            let decoded = decipher.update(encryptedData, "base64", "utf8");
            decoded += decipher.final("utf8");

            // Rimuove il padding manuale
            const lastChar = decoded.charCodeAt(decoded.length - 1);
            decoded = decoded.slice(0, decoded.length - lastChar);

            return decoded;
        } catch (error) {
            console.error("Errore durante la decifratura:", error);
            return null;
        }
    }
}

export class PasswordUtilities {
    private static readonly HASH_PREFIX = "scrypt";
    private static readonly LEGACY_HASH_PREFIX = "scrypt-legacy";
    private static readonly SCRYPT_N = 16384;
    private static readonly SCRYPT_R = 8;
    private static readonly SCRYPT_P = 1;
    private static readonly SALT_LENGTH = 16;

    private static hashSecret(secretValue: string, prefix: string): string {
        if (typeof secretValue !== "string" || secretValue.length === 0) {
            throw new Error("Il valore da proteggere non puo essere vuoto.");
        }
        const salt = crypto.randomBytes(this.SALT_LENGTH).toString("hex");
        const derivedKey = crypto.scryptSync(
            secretValue,
            salt,
            64,
            {
                N: this.SCRYPT_N,
                r: this.SCRYPT_R,
                p: this.SCRYPT_P,
                maxmem: 64 * 1024 * 1024,
            },
        );

        return [
            prefix,
            this.SCRYPT_N,
            this.SCRYPT_R,
            this.SCRYPT_P,
            salt,
            derivedKey.toString("hex"),
        ].join("$");
    }

    private static hasPrefix(value: string, prefix: string): boolean {
        return typeof value === "string" && value.startsWith(`${prefix}$`);
    }

    private static parseHash(
        storedPassword: string,
        expectedPrefix: string
    ): {
        salt: string;
        expectedHash: Buffer;
        N: number;
        r: number;
        p: number;
    } | null {
        if (!this.hasPrefix(storedPassword, expectedPrefix)) {
            return null;
        }

        const [, rawN, rawR, rawP, salt, expectedHashHex] = storedPassword.split("$");
        const N = Number(rawN);
        const r = Number(rawR);
        const p = Number(rawP);

        if (!salt || !expectedHashHex || !Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) {
            return null;
        }

        const expectedHash = Buffer.from(expectedHashHex, "hex");
        if (expectedHash.length === 0) {
            return null;
        }

        return {
            salt,
            expectedHash,
            N,
            r,
            p,
        };
    }

    private static verifySecret(secretValue: string, storedPassword: string, expectedPrefix: string): boolean {
        if (typeof secretValue !== "string") {
            return false;
        }

        const parsedHash = this.parseHash(storedPassword, expectedPrefix);
        if (!parsedHash) {
            return false;
        }

        const derivedKey = crypto.scryptSync(
            secretValue,
            parsedHash.salt,
            parsedHash.expectedHash.length,
            {
                N: parsedHash.N,
                r: parsedHash.r,
                p: parsedHash.p,
                maxmem: 64 * 1024 * 1024,
            },
        );

        return crypto.timingSafeEqual(derivedKey, parsedHash.expectedHash);
    }

    public static hashPassword(plainPassword: string): string {
        return this.hashSecret(plainPassword, this.HASH_PREFIX);
    }

    public static hashLegacyEncryptedPassword(legacyEncryptedPassword: string): string {
        return this.hashSecret(legacyEncryptedPassword, this.LEGACY_HASH_PREFIX);
    }

    public static isPasswordHash(value: string): boolean {
        return this.hasPrefix(value, this.HASH_PREFIX);
    }

    public static isLegacyPasswordHash(value: string): boolean {
        return this.hasPrefix(value, this.LEGACY_HASH_PREFIX);
    }

    public static verifyPassword(plainPassword: string, storedPassword: string): boolean {
        return this.verifySecret(plainPassword, storedPassword, this.HASH_PREFIX);
    }

    public static verifyLegacyEncryptedPassword(
        legacyEncryptedPassword: string,
        storedPassword: string
    ): boolean {
        return this.verifySecret(legacyEncryptedPassword, storedPassword, this.LEGACY_HASH_PREFIX);
    }
}





/**
 * Utility class for managing database-related configurations and operations.
 */
export class DatabaseUtilities {
    /**
     * Creates a configuration object for connecting to a Firebird database.
     *
     * @param {string} host - The hostname or IP address of the database server.
     * @param {number} port - The port number on which the database server is running.
     * @param {string} database - The path or alias of the database to connect to.
     * @param {string} [username='SYSDBA'] - The username for authentication. Defaults to 'SYSDBA'.
     * @param {string} [password='masterkey'] - The password for authentication. Defaults to 'masterkey'.
     * @returns {Options} - The configuration object to use for establishing a Firebird database connection.
     *
     * @example
     * ```typescript
     * const options = DatabaseUtilities.createOption(
     *   'localhost',
     *   3050,
     *   '/path/to/database.fdb',
     *   'myUsername',
     *   'myPassword'
     * );
     * ```
     */
    public static createOption(
        host: string,
        port: number,
        database: string,
        username = 'SYSDBA',
        password = 'masterkey'
    ): FirebirdOptions {
        return {
            host,                   // The hostname or IP address of the database server.
            port,                   // The port number used by the database server.
            user: username,         // The username for database authentication.
            password,               // The password for database authentication.
            database,               // The path or alias of the target database.
            lowercase_keys: false,  // Determines if the keys in query results should be in lowercase. Default: false.
            role: undefined,        // The role for the database connection. Default: undefined.
            pageSize: 100000,       // The page size for database transactions. Default: 100,000.
            retryConnectionInterval: 1000, // The interval (in ms) to retry a failed connection. Default: 1,000 ms.
            blobAsText: true,       // Determines if BLOB fields should be treated as text. Default: true.
            connectTimeout: 15000,
            connectTimeoutMs: 15000,
            trimStringResults: true,
        };
    }
}

export function Deprecated(message: string) {
    return function (target: any, key?: string, descriptor?: PropertyDescriptor) {
      console.warn(`[DEPRECATED] ${message}`);
    };
  }
