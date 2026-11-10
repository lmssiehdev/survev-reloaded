/**
 * A set of object ids (0 to size - 1) stored as one bit per id.
 * Used for per-client visibility, allocated once per client instead of a Set every net sync.
 */
export class IdBitset {
    readonly words: Uint32Array;

    constructor(size: number) {
        this.words = new Uint32Array((size + 31) >>> 5);
    }

    add(id: number): void {
        this.words[id >>> 5] |= 1 << (id & 31);
    }

    delete(id: number): void {
        this.words[id >>> 5] &= ~(1 << (id & 31));
    }

    has(id: number): boolean {
        return (this.words[id >>> 5] & (1 << (id & 31))) !== 0;
    }
}

/** index (0-31) of the single set bit in `bit`; use with `bit = word & -word` to walk set bits low to high */
export function bitIndex(bit: number): number {
    return 31 - Math.clz32(bit);
}
