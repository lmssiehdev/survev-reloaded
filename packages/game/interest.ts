import type { AABB } from "@survev/shared/utils/coldet.ts";
import type { Grid } from "./grid.ts";
import { bitIndex, IdBitset } from "./idBitset.ts";

/**
 * What one client's camera covers on the grid, and which object ids it may have started or
 * stopped seeing since its last sync. Created by Interest.addView, one per client.
 */
export class View {
    /** camera cell bounds at the last sync; minX is -1 until the first */
    minX = -1;
    minY = -1;
    maxX = -1;
    maxY = -1;

    /** ids whose visibility may have changed since the last sync, deduped by `changed` */
    readonly changedIds: number[] = [];
    readonly changed: IdBitset;

    /** dirty objects this view covered when Interest.routeDirty ran, this sync */
    readonly dirtyIds: number[] = [];

    /** this view's bit in its word of Interest.viewers */
    readonly bit: number;

    constructor(
        readonly slot: number,
        /** Interest.viewers word this view's bit lives in */
        private readonly viewers: Uint32Array,
        idLimit: number,
    ) {
        this.bit = 1 << (slot & 31);
        this.changed = new IdBitset(idLimit);
    }

    /** true when the object is in a cell this view covers */
    sees(id: number): boolean {
        return (this.viewers[id] & this.bit) !== 0;
    }

    markChanged(id: number): void {
        const w = id >>> 5;
        const bit = 1 << (id & 31);
        const words = this.changed.words;
        if ((words[w] & bit) !== 0) return;
        words[w] |= bit;
        this.changedIds.push(id);
    }
}

/**
 * Client visibility kept up to date as objects and cameras move, instead of rescanning every
 * camera each sync.
 *
 * Each view gets a slot, one bit in a 32-slot word. `cellViews[w][cell]` holds the bits of the views
 * covering a cell and `viewers[w][id]` the bits of the views covering any cell the object is in, so
 * an object is visible to a view exactly when its bit is set there. When an object changes cells,
 * XOR of its old and new viewers is the views whose answer changed; when a camera changes cells,
 * only the cells it entered or left are visited, and only its own bit changes. Either way the
 * affected ids are marked on the view, and the client settles them at its next sync.
 */
export class Interest {
    /** cellViews[w][cell]: views 32w..32w+31 covering the cell, cells indexed like Grid.cells */
    private readonly cellViews: Uint32Array[] = [];
    /** viewers[w][id]: views 32w..32w+31 covering a cell the object is in */
    private readonly viewers: Uint32Array[] = [];
    /** by slot; null once the client left */
    private readonly views: Array<View | null> = [];

    constructor(
        private readonly grid: Grid,
        private readonly cellCount: number,
        private readonly stride: number,
        private readonly idLimit: number,
    ) {}

    addView(): View {
        let slot = this.views.indexOf(null);
        if (slot < 0) slot = this.views.length;
        const w = slot >>> 5;
        if (w === this.viewers.length) {
            this.cellViews.push(new Uint32Array(this.cellCount));
            this.viewers.push(new Uint32Array(this.idLimit));
        }
        const view = new View(slot, this.viewers[w], this.idLimit);
        this.views[slot] = view;
        return view;
    }

    removeView(view: View): void {
        if (this.views[view.slot] !== view) return;
        this._moveView(view, -1, -1, -1, -1);
        this.views[view.slot] = null;
    }

    /** moves the view to the cells overlapping this AABB, the same cells a grid query would visit */
    setView(view: View, aabb: AABB): void {
        const grid = this.grid;
        this._moveView(
            view,
            grid.cellX(aabb.min.x),
            grid.cellY(aabb.min.y),
            grid.cellX(aabb.max.x),
            grid.cellY(aabb.max.y),
        );
    }

    /** minX -1: the view covers nothing */
    private _moveView(view: View, minX: number, minY: number, maxX: number, maxY: number): void {
        const oMinX = view.minX;
        const oMinY = view.minY;
        const oMaxX = view.maxX;
        const oMaxY = view.maxY;
        if (oMinX === minX && oMinY === minY && oMaxX === maxX && oMaxY === maxY) return;

        const w = view.slot >>> 5;
        const bit = view.bit;
        const cellViews = this.cellViews[w];
        const viewers = this.viewers[w];
        const cells = this.grid.cells;
        const idToObj = this.grid.idToObj;
        const stride = this.stride;

        // cells it stopped covering: an object there stays visible if it's still in a covered cell
        if (oMinX >= 0) {
            for (let x = oMinX; x <= oMaxX; x++) {
                const row = x * stride;
                const xKept = x >= minX && x <= maxX;
                for (let y = oMinY; y <= oMaxY; y++) {
                    if (xKept && y >= minY && y <= maxY) continue;
                    cellViews[row + y] &= ~bit;
                    const cell = cells[row + y];
                    for (let i = 0; i < cell.length; i++) {
                        const id = cell[i];
                        if ((viewers[id] & bit) === 0) continue;
                        const b = idToObj[id]!.__gridBounds;
                        if (
                            minX >= 0 && b.min.x <= maxX && b.max.x >= minX && b.min.y <= maxY
                            && b.max.y >= minY
                        ) {
                            continue;
                        }
                        viewers[id] &= ~bit;
                        view.markChanged(id);
                    }
                }
            }
        }

        // cells it started covering
        if (minX >= 0) {
            for (let x = minX; x <= maxX; x++) {
                const row = x * stride;
                const xKept = x >= oMinX && x <= oMaxX;
                for (let y = minY; y <= maxY; y++) {
                    if (xKept && y >= oMinY && y <= oMaxY) continue;
                    cellViews[row + y] |= bit;
                    const cell = cells[row + y];
                    for (let i = 0; i < cell.length; i++) {
                        const id = cell[i];
                        if ((viewers[id] & bit) !== 0) continue;
                        viewers[id] |= bit;
                        view.markChanged(id);
                    }
                }
            }
        }

        view.minX = minX;
        view.minY = minY;
        view.maxX = maxX;
        view.maxY = maxY;
    }

    /** called by Grid once the object is in cells [minX, maxX] x [minY, maxY] */
    objectMoved(id: number, minX: number, minY: number, maxX: number, maxY: number): void {
        const stride = this.stride;
        for (let w = 0; w < this.viewers.length; w++) {
            const cellViews = this.cellViews[w];
            let now = 0;
            for (let x = minX; x <= maxX; x++) {
                const row = x * stride;
                for (let y = minY; y <= maxY; y++) now |= cellViews[row + y];
            }
            const viewers = this.viewers[w];
            const changed = viewers[id] ^ now;
            if (changed === 0) continue;
            viewers[id] = now;
            this._markChanged(w, changed, id);
        }
    }

    /** called by Grid once the object left all its cells */
    objectRemoved(id: number): void {
        for (let w = 0; w < this.viewers.length; w++) {
            const viewers = this.viewers[w];
            const changed = viewers[id];
            if (changed === 0) continue;
            viewers[id] = 0;
            this._markChanged(w, changed, id);
        }
    }

    private _markChanged(w: number, bits: number, id: number): void {
        const views = this.views;
        const base = w << 5;
        while (bits !== 0) {
            const bit = bits & -bits;
            bits ^= bit;
            views[base | bitIndex(bit)]!.markChanged(id);
        }
    }

    /** fills each view's dirtyIds with the dirty objects it covers right now */
    routeDirty(dirtyIds: readonly number[]): void {
        const views = this.views;
        for (let s = 0; s < views.length; s++) {
            const view = views[s];
            if (view) view.dirtyIds.length = 0;
        }
        for (let w = 0; w < this.viewers.length; w++) {
            const viewers = this.viewers[w];
            const base = w << 5;
            for (let i = 0; i < dirtyIds.length; i++) {
                const id = dirtyIds[i];
                let bits = viewers[id];
                while (bits !== 0) {
                    const bit = bits & -bits;
                    bits ^= bit;
                    views[base | bitIndex(bit)]!.dirtyIds.push(id);
                }
            }
        }
    }
}
