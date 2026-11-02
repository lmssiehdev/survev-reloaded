const f64 = new Float64Array(1);
const u32 = new Uint32Array(f64.buffer);

/** Two 32 bit FNV-style lanes, cheap and good enough to tell runs apart. */
export class Hasher {
    a = 0x811c9dc5;
    b = 0xcbf29ce4;

    u8(v: number) {
        this.a = Math.imul(this.a ^ v, 16777619);
        this.b = (Math.imul(this.b ^ v, 0x01000193) + 0x2f) | 0;
    }

    /** one mixing step per word, not per byte */
    u32(v: number) {
        this.a = Math.imul(this.a ^ v, 16777619);
        this.b = (Math.imul(this.b ^ (v >>> 0), 0x01000193) + 0x2f) | 0;
        this.b ^= this.b >>> 15;
    }

    bytes(d: Uint8Array) {
        this.u32(d.length);
        for (let i = 0; i < d.length; i++) this.u8(d[i]);
    }

    /** exact: hashes the float64 bit pattern */
    num(v: number) {
        f64[0] = v;
        this.u32(u32[0]);
        this.u32(u32[1]);
    }

    str(v: string) {
        this.u32(v.length);
        for (let i = 0; i < v.length; i++) this.u32(v.charCodeAt(i));
    }

    hex() {
        return (this.a >>> 0).toString(16).padStart(8, "0") + (this.b >>> 0).toString(16).padStart(8, "0");
    }
}
