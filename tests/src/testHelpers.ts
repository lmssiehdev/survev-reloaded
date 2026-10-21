import { afterEach, type AsymmetricMatcher, describe, expect, test, type TestOptions } from "bun:test";

import type { GameObjectDef } from "../../shared/defs/gameObjectDefs.ts";

import type { Player } from "../../server/src/game/objects/player.ts";
import type { MapObjectDef } from "../../shared/defs/mapObjectDefs.ts";
import { Main } from "../../shared/defs/maps/baseDefs.ts";
import { GameObjectDefs, MapObjectDefs } from "../../shared/defs/register.ts";
import { ObjectType } from "../../shared/net/objectSerializeFns.ts";

type IterableElement<I> = I extends Iterable<infer E> ? E : never;

interface GameTestHelpers<R = unknown> {
    toBeInRange: (value: { min: number; max: number }) => R;
    toHaveNoDuplicates: () => R;
    toAllSatisfy: (predicate: (value: IterableElement<R>, index: number, iterable: R) => unknown) => R;

    toBeValidMapObj: (type?: MapObjectDef["type"][]) => R;
    toBeValidMapObjOrNone: (type?: MapObjectDef["type"][]) => R;
    toBeValidGameObj: (type?: GameObjectDef["type"][]) => R;
    toBeValidLoot: (type?: GameObjectDef["type"][]) => R;
    toBeValidLootTier: () => R;

    toBeSamePlayer: (expected: Player) => R;
}

declare module "bun:test" {
    interface Matchers<T> extends GameTestHelpers<T> {}
    interface AsymmetricMatchers extends GameTestHelpers<AsymmetricMatcher> {}
    interface Expect {
        /** vitest-style soft assertion, polyfilled below */
        soft: Expect;
        /** vitest-style explicit failure, polyfilled below */
        fail: (message?: string) => never;
    }
    interface Test<T extends ReadonlyArray<unknown>> {
        /** vitest-style test.for (cases are not spread), polyfilled below */
        for<C>(cases: ReadonlyArray<C>): {
            (name: string, fn: (item: C) => unknown): void;
            (name: string, options: TestOptions, fn: (item: C) => unknown): void;
        };
    }
    interface Describe<T extends Readonly<any[]>> {
        /** vitest-style describe.for (cases are not spread), polyfilled below */
        for<C>(cases: ReadonlyArray<C>): (name: string, fn: (item: C) => void) => void;
    }
}

export const predicates: {
    [K in keyof GameTestHelpers]: (
        received: unknown,
        ...params: Parameters<GameTestHelpers[K]>
    ) => { pass: boolean; message: () => string };
} = {
    toBeInRange: (received, expected: { min: number; max: number }) => {
        if (typeof received !== "number") {
            return {
                message: () => `Expected ${received} to be a number`,
                pass: false,
            };
        }

        if (received > expected.max || received < expected.min) {
            return {
                message: () => `Expected ${received} to be a in range [${expected.min}, ${expected.max}]`,
                pass: false,
            };
        }

        return { pass: true, message: () => "" };
    },

    toHaveNoDuplicates: (received: unknown) => {
        if (!Array.isArray(received)) {
            return {
                pass: false,
                message: () => `Expected ${received} to be an Array`,
            };
        }

        const dupes = new Map<unknown, number>();
        const unique = new Set<unknown>();

        for (let i = 0; i < received.length; ++i) {
            const ele = received[i];

            if (unique.has(ele)) {
                const count = dupes.get(ele);
                dupes.set(ele, (count ?? 1) + 1);
            } else {
                unique.add(ele);
            }
        }

        if (dupes.size) {
            return {
                pass: false,
                message: () => {
                    const dupeString = dupes.entries().map(([val, count]) => `\t${val} => ${count} times`).toArray()
                        .join("\n");
                    return `Expected ${received} to have no duplicates, but found the following dupes:\n${dupeString}`;
                },
            };
        }

        return { pass: true, message: () => "" };
    },

    toAllSatisfy: <T>(received: unknown, predicate: (value: T, index: number, iterable: Iterable<T>) => unknown) => {
        if (
            received === null
            || typeof received !== "object"
            || !(Symbol.iterator in received)
            || typeof received[Symbol.iterator] !== "function"
        ) {
            return {
                pass: false,
                message: () => `Expected '${received}' to be iterable`,
            };
        }

        let idx = 0;
        for (const ele of (received as Iterable<T>)) {
            if (!predicate(ele, idx, received as Iterable<T>)) {
                return {
                    pass: false,
                    message: () =>
                        `Expected all elements in the iterable to satisfy the given predicate but the element at index ${idx} didn't.`,
                };
            }
            ++idx;
        }

        return { pass: true, message: () => "" };
    },

    toBeValidMapObj: (received, expected?: MapObjectDef["type"][]) => {
        if (typeof received !== "string") {
            return {
                message: () => `Expected '${received}' to be a string`,
                pass: false,
            };
        }

        if (!MapObjectDefs.typeExists(received)) {
            return {
                message: () => `Expected '${received}' to be a valid map object type`,
                pass: false,
            };
        }

        if (expected) {
            const def = MapObjectDefs.typeToDef(received);
            if (!expected.includes(def.type)) {
                return {
                    message: () => `Expected '${received}' to be a be of type ${expected}`,
                    pass: false,
                };
            }
        }

        return { pass: true, message: () => "" };
    },

    toBeValidMapObjOrNone: (received, expected?: MapObjectDef["type"][]) => {
        if (received === undefined || received === "") {
            return {
                pass: true,
                message: () => "",
            };
        }

        if (typeof received !== "string") {
            return {
                message: () => `Expected '${received}' to be a string`,
                pass: false,
            };
        }

        if (!MapObjectDefs.typeExists(received)) {
            return {
                message: () => `Expected '${received}' to be a valid map object type`,
                pass: false,
            };
        }

        if (expected !== undefined) {
            const def = MapObjectDefs.typeToDef(received);
            if (!expected.includes(def.type)) {
                return {
                    message: () => `Expected '${received}' to be a be of type ${expected}`,
                    pass: false,
                };
            }
        }

        return { pass: true, message: () => "" };
    },

    toBeValidGameObj: (received, expected?: GameObjectDef["type"][]) => {
        if (typeof received !== "string") {
            return {
                message: () => `Expected '${received}' to be a string`,
                pass: false,
            };
        }

        if (!GameObjectDefs.typeExists(received)) {
            return {
                message: () => `Expected '${received}' to be a valid game object type`,
                pass: false,
            };
        }

        if (expected) {
            const def = GameObjectDefs.typeToDef(received);
            if (!expected.includes(def.type)) {
                return {
                    message: () => `Expected '${received}' to be a be of type ${expected}`,
                    pass: false,
                };
            }
        }

        return { pass: true, message: () => "" };
    },

    toBeValidLoot: (received, expected?: GameObjectDef["type"][]) => {
        if (typeof received !== "string") {
            return {
                message: () => `Expected '${received}' to be a string`,
                pass: false,
            };
        }

        const def = GameObjectDefs.typeToDefSafe(received);
        if (!def || !("lootImg" in def)) {
            return {
                message: () => `Expected '${received}' to be a valid loot type`,
                pass: false,
            };
        }

        if (expected) {
            const def = GameObjectDefs.typeToDef(received);
            if (!expected.includes(def.type)) {
                return {
                    message: () => `Expected '${received}' to be a be of type ${expected}`,
                    pass: false,
                };
            }
        }

        return { pass: true, message: () => "" };
    },

    toBeValidLootTier: (received) => {
        if (typeof received !== "string") {
            return {
                message: () => `Expected '${received}' to be a string`,
                pass: false,
            };
        }

        if (!(received in Main.lootTable)) {
            return {
                message: () => `Expected '${received}' to be a valid loot table`,
                pass: false,
            };
        }

        return { pass: true, message: () => "" };
    },

    toBeSamePlayer: (received: Player | unknown, expected: Player) => {
        if (!received || typeof received !== "object" || (received as Player).__type !== ObjectType.Player) {
            return {
                message: () => `Expected a player instance, received '${received}'`,
                pass: false,
            };
        }

        if ((received as Player).__id !== expected.__id) {
            return {
                message: () => `Expected player '${(received as Player).name}' to be '${expected.name}'`,
                pass: false,
            };
        }

        return { pass: true, message: () => "" };
    },
};

expect.extend(predicates);

//
// bun:test has no expect.soft / expect.fail (vitest APIs) so polyfill them.
// Soft assertion failures are collected and reported after the test finishes.
//

let softErrors: unknown[] = [];

function softMatchers(matchers: object): object {
    return new Proxy(matchers, {
        get(target, prop) {
            const value = Reflect.get(target, prop, target);
            if (prop === "not" || prop === "resolves" || prop === "rejects") {
                return softMatchers(value);
            }
            if (typeof value !== "function") return value;
            return (...args: unknown[]) => {
                try {
                    const res = value.apply(target, args);
                    if (res instanceof Promise) return res.catch((err) => void softErrors.push(err));
                    return res;
                } catch (err) {
                    softErrors.push(err);
                }
            };
        },
    });
}

expect.soft = ((actual: unknown, message?: string) => softMatchers(expect(actual, message))) as typeof expect;

expect.fail = (message?: string): never => {
    throw new Error(message ?? "expect.fail()");
};

/**
 * Format a test title like vitest: printf-style %s/%d/%i/%f/%j/%o/%O consume the case items,
 * %# is the case index, %$ the 1-based case index, $key / $0 / $a.b index into object cases.
 */
function formatTitle(title: string, item: unknown, idx: number): string {
    const items = Array.isArray(item) ? item : [item];
    let argIdx = 0;
    let out = title.replace(/%[sdifjoOp#$%]/g, (m) => {
        if (m === "%%") return "%";
        if (m === "%#") return String(idx);
        if (m === "%$") return String(idx + 1);
        return String(items[argIdx++]);
    });
    if (item !== null && typeof item === "object") {
        out = out.replace(/\$([\w.]+)/g, (_m, path: string) => {
            let value: unknown = item;
            for (const key of path.split(".")) value = (value as Record<string, unknown>)?.[key];
            return String(value);
        });
    }
    return out;
}

type TestFn = (name: string, fn: () => unknown, options?: TestOptions) => void;

function forPolyfill(base: TestFn) {
    return <C>(cases: ReadonlyArray<C>) =>
    (
        name: string,
        optionsOrFn: TestOptions | ((item: C) => unknown),
        maybeFn?: (item: C) => unknown,
    ) => {
        const options = typeof optionsOrFn === "function" ? undefined : optionsOrFn;
        const fn = typeof optionsOrFn === "function" ? optionsOrFn : maybeFn!;
        cases.forEach((item, idx) => {
            const title = formatTitle(name, item, idx);
            if (options) base(title, () => fn(item), options);
            else base(title, () => fn(item));
        });
    };
}

test.for = forPolyfill(test as TestFn);
describe.for = forPolyfill(describe as TestFn);

afterEach(() => {
    if (!softErrors.length) return;
    const errors = softErrors;
    softErrors = [];
    if (errors.length === 1) throw errors[0];
    throw new AggregateError(errors, `${errors.length} soft assertions failed`);
});
