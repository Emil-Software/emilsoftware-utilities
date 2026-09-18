type AutobindConstructor = new (...args: never[]) => object;

/**
 * Class decorator that binds every prototype method to the instance.
 *
 * Uses `Reflect.construct` instead of a class-expression mixin because
 * TypeScript requires mixin constructors to use `any[]`, which this codebase
 * avoids.
 */
export function autobind<T extends AutobindConstructor>(constructor: T): T {
    const boundConstructor = function (this: unknown, ...args: unknown[]): object {
        const instance = Reflect.construct(constructor, args) as Record<string, unknown>;

        Object.getOwnPropertyNames(constructor.prototype).forEach(key => {
            const descriptor = Object.getOwnPropertyDescriptor(constructor.prototype, key);
            if (descriptor && typeof descriptor.value === 'function' && key !== 'constructor') {
                const method = instance[key];
                if (typeof method === 'function') {
                    instance[key] = method.bind(instance);
                }
            }
        });

        return instance;
    };

    // Mirror `class extends`: the constructor's prototype chain must point at the
    // original class so reflect-metadata (design:paramtypes) stays reachable and
    // NestJS dependency injection keeps working.
    Object.setPrototypeOf(boundConstructor, constructor);
    boundConstructor.prototype = constructor.prototype;
    return boundConstructor as unknown as T;
}
