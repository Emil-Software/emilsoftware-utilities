import { Logger } from "./";

export class ExecutionTimeLogger {
    /**
     * Wraps a method to log its execution time and errors.
     * @param target The target object.
     * @param propertyKey The name of the method.
     * @param descriptor The property descriptor of the method.
     * @description use ExecutionTimeLogger.apply on a method
     */
    static apply(target: object, propertyKey: string, descriptor: PropertyDescriptor) {
        const originalMethod = descriptor.value;

        if (typeof originalMethod !== "function") {
            throw new TypeError(`ExecutionTimeLogger can only be applied to methods, not: ${typeof originalMethod}`);
        }

        const className = (target as { constructor: { name: string } }).constructor.name;
        const logger = new Logger(className);
        descriptor.value = async function (...args: unknown[]) {
            const start = process.hrtime();
            logger.info(`[${className}] ${propertyKey} method execution started . . .`);
            
            try {
                const result = await originalMethod.apply(this, args);
                const end = process.hrtime(start);
                const durationInMilliseconds = end[0] * 1000 + end[1] / 1e6;
                logger.info(`[${className}] ${propertyKey} method took ${durationInMilliseconds.toFixed(2)} ms to execute`);
                return result;
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                logger.error(`[${className}] ${propertyKey} method threw an error: ${message}`);
                throw error;
            }
        };

        return descriptor;
    }
}
