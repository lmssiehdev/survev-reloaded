import type { AABB, Collider } from "@survev/shared/utils/coldet.ts";
import { collider } from "@survev/shared/utils/collider.ts";
import { math } from "@survev/shared/utils/math.ts";
import { v2, type Vec2 } from "@survev/shared/utils/v2.ts";
import type { Loot } from "./objects/loot.ts";

interface GameObject {
    __id: number;
    __gridBounds: { min: Vec2; max: Vec2 };
    __onGrid: boolean;
    bounds: AABB;
    pos: Vec2;
}

/** one past the largest object id ObjectRegister hands out */
const ID_LIMIT = 65536;

/**
 * A Grid to filter collision detection of game objects
 *
 * Each cell is an insertion-ordered array of object ids, kept in the order a Set of the objects
 * would iterate in: removal shifts the rest down, re-adding appends. Queries resolve ids through
 * the ObjectRegister's idToObj and dedupe with a per-id query stamp.
 */
export class Grid<T extends GameObject = GameObject> {
    readonly width: number;
    readonly height: number;
    readonly cellSize = 16;

    /** cell (x, y) is cells[x * (height + 1) + y] */
    readonly cells: number[][];
    private readonly _stride: number;

    /** set by ObjectRegister; ids in cells always resolve to a live object */
    idToObj: Array<T | null> = [];

    private readonly _queryStamp = new Uint32Array(ID_LIMIT);
    private nextQueryId = 1;

    constructor(width: number, height: number) {
        this.width = Math.floor(width / this.cellSize);
        this.height = Math.floor(height / this.cellSize);

        this._stride = this.height + 1;
        this.cells = Array.from({ length: (this.width + 1) * this._stride }, () => []);
    }

    /** ids in cell (x, y), in query order; x in [0, width], y in [0, height]. Don't mutate. */
    cellIds(x: number, y: number): readonly number[] {
        return this.cells[x * this._stride + y];
    }

    cellX(x: number): number {
        return math.clamp(Math.floor(x / this.cellSize), 0, this.width);
    }

    cellY(y: number): number {
        return math.clamp(Math.floor(y / this.cellSize), 0, this.height);
    }

    /**
     * Called by ObjectRegister.register once the object has an id. Objects that called
     * updateObject before they had an id (obstacles do in their constructor) get inserted here;
     * nothing touches the grid in between, so cell order matches inserting them back then.
     */
    addObject(obj: T): void {
        this.updateObject(obj);
        if (!obj.__onGrid) {
            const b = obj.__gridBounds;
            this._insert(obj.__id, b.min.x, b.min.y, b.max.x, b.max.y);
            obj.__onGrid = true;
        }
    }

    /**
     * Add an object to the grid system
     */
    updateObject(obj: T): void {
        const objBounds = obj.__gridBounds;

        const aabb = obj.bounds;
        // Get the bounds of the hitbox
        // Round it to the grid cells
        const minX = this.cellX(aabb.min.x + obj.pos.x);
        const minY = this.cellY(aabb.min.y + obj.pos.y);
        const maxX = this.cellX(aabb.max.x + obj.pos.x);
        const maxY = this.cellY(aabb.max.y + obj.pos.y);

        if (
            objBounds.min.x === minX && objBounds.min.y === minY && objBounds.max.x === maxX
            && objBounds.max.y === maxY
        ) {
            return;
        }

        this.remove(obj);

        objBounds.min.x = minX;
        objBounds.min.y = minY;
        objBounds.max.x = maxX;
        objBounds.max.y = maxY;

        // not registered yet: addObject inserts it
        if (!obj.__id) return;

        // Add it to all grid cells that it intersects
        this._insert(obj.__id, minX, minY, maxX, maxY);
        obj.__onGrid = true;
    }

    private _insert(id: number, minX: number, minY: number, maxX: number, maxY: number): void {
        const cells = this.cells;
        const stride = this._stride;
        for (let x = minX; x <= maxX; x++) {
            const row = x * stride;
            for (let y = minY; y <= maxY; y++) {
                cells[row + y].push(id);
            }
        }
    }

    /**
     * Remove an object from the grid system
     */
    remove(obj: T): void {
        // like upstream: an object that isn't on the grid keeps its bounds
        if (!obj.__onGrid) return;

        const { min, max } = obj.__gridBounds;
        const id = obj.__id;
        const cells = this.cells;
        const stride = this._stride;
        for (let x = min.x; x <= max.x; x++) {
            const row = x * stride;
            for (let y = min.y; y <= max.y; y++) {
                const cell = cells[row + y];
                const len = cell.length;
                let i = cell.indexOf(id);
                if (i < 0) continue;
                for (; i < len - 1; i++) cell[i] = cell[i + 1];
                cell.length = len - 1;
            }
        }
        min.x =
            min.y =
            max.x =
            max.y =
                -1;
        obj.__onGrid = false;
    }

    private _newQuery(): number {
        let queryId = this.nextQueryId++;
        if (queryId === 0xffffffff) {
            this._queryStamp.fill(0);
            queryId = 1;
            this.nextQueryId = 2;
        }
        return queryId;
    }

    /** appends the deduped objects of cells [minX, maxX] x [minY, maxY], x-major */
    private _collect(minX: number, minY: number, maxX: number, maxY: number, out: T[]): T[] {
        out.length = 0;
        const queryId = this._newQuery();
        const stamp = this._queryStamp;
        const idToObj = this.idToObj;
        const cells = this.cells;
        const stride = this._stride;

        for (let x = minX; x <= maxX; x++) {
            const row = x * stride;
            for (let y = minY; y <= maxY; y++) {
                const cell = cells[row + y];
                for (let i = 0; i < cell.length; i++) {
                    const id = cell[i];
                    if (stamp[id] === queryId) continue;
                    stamp[id] = queryId;
                    out.push(idToObj[id]!);
                }
            }
        }

        return out;
    }

    /**
     * Get all objects near this collider
     * This transforms the collider into a rectangle
     * and gets all objects intersecting it after rounding it to grid cells
     * @param coll The collider
     * @param out optional reused result array, cleared first
     * @return An array with the objects near this collider
     */
    intersectCollider(coll: Collider, out: T[] = []): T[] {
        const aabb = collider.toAabb(coll);

        return this._collect(
            this.cellX(aabb.min.x),
            this.cellY(aabb.min.y),
            this.cellX(aabb.max.x),
            this.cellY(aabb.max.y),
            out,
        );
    }

    /**
     * Get all objects near this game object
     * @param obj The game object. NOTE: it must already be inside the grid
     * @return An array with the objects near this collider
     */
    intersectGameObject(obj: GameObject, out: T[] = []): T[] {
        const { min, max } = obj.__gridBounds;
        return this._collect(min.x, min.y, max.x, max.y, out);
    }

    intersectAABBSet(aabb: AABB): Set<T> {
        const minX = this.cellX(aabb.min.x);
        const minY = this.cellY(aabb.min.y);
        const maxX = this.cellX(aabb.max.x);
        const maxY = this.cellY(aabb.max.y);

        const objects = new Set<T>();
        const queryId = this._newQuery();
        const stamp = this._queryStamp;
        const idToObj = this.idToObj;
        const cells = this.cells;
        const stride = this._stride;

        for (let x = minX; x <= maxX; x++) {
            const row = x * stride;
            for (let y = minY; y <= maxY; y++) {
                const cell = cells[row + y];
                for (let i = 0; i < cell.length; i++) {
                    const id = cell[i];
                    if (stamp[id] === queryId) continue;
                    stamp[id] = queryId;
                    objects.add(idToObj[id]!);
                }
            }
        }

        return objects;
    }

    /** @param out optional reused result array, cleared first */
    intersectPos(pos: Vec2, out: T[] = []): T[] {
        const cell = this.cells[this.cellX(pos.x) * this._stride + this.cellY(pos.y)];
        const idToObj = this.idToObj;
        out.length = 0;
        for (let i = 0; i < cell.length; i++) out.push(idToObj[cell[i]]!);
        return out;
    }

    /** @param out optional reused result array, cleared first */
    intersectLineSegment(lineStart: Vec2, lineEnd: Vec2, out: T[] = []): T[] {
        const start = this._roundToCells(lineStart);
        const end = this._roundToCells(lineEnd);

        const diff = v2.sub(lineEnd, lineStart);

        const gridDeltaX = lineEnd.x >= lineStart.x ? 1 : -1;
        const gridDeltaY = lineEnd.y >= lineStart.y ? 1 : -1;

        const deltaX = Math.abs(diff.x) > 0.00001
            ? (gridDeltaX * this.cellSize) / diff.x
            : Number.MAX_VALUE;
        const deltaY = Math.abs(diff.y) > 0.00001
            ? (gridDeltaY * this.cellSize) / diff.y
            : Number.MAX_VALUE;

        const relativeX = math.mod(lineStart.x / this.cellSize, 1);
        const relativeY = math.mod(lineStart.y / this.cellSize, 1);

        let x = deltaX * (gridDeltaX > 0 ? 1 - relativeX : relativeX);
        let y = deltaY * (gridDeltaY > 0 ? 1 - relativeY : relativeY);

        const objects = out;
        objects.length = 0;
        const queryId = this._newQuery();
        const stamp = this._queryStamp;
        const idToObj = this.idToObj;

        while (true) {
            const cell = this.cells[start.x * this._stride + start.y];

            for (let i = 0; i < cell.length; i++) {
                const id = cell[i];
                if (stamp[id] === queryId) continue;

                stamp[id] = queryId;
                objects.push(idToObj[id]!);
            }
            if (start.x == end.x && start.y == end.y) {
                break;
            }
            if (x < y) {
                x += deltaX;
                start.x += gridDeltaX;
                if (start.x < 0 || start.x >= this.width) {
                    break;
                }
            } else {
                y += deltaY;
                start.y += gridDeltaY;
                if (start.y < 0 || start.y >= this.height) {
                    break;
                }
            }
        }

        return objects;
    }

    /**
     * Rounds a position to this grid cells
     */
    private _roundToCells(vector: Vec2): Vec2 {
        return {
            x: this.cellX(vector.x),
            y: this.cellY(vector.y),
        };
    }

    /**
     * Sets the bit of every object id in the cells overlapping this AABB.
     * Covers the same cells as intersectAABBSet, without building a Set
     */
    markAABB(aabb: AABB, bits: Uint32Array): void {
        const minX = this.cellX(aabb.min.x);
        const minY = this.cellY(aabb.min.y);
        const maxX = this.cellX(aabb.max.x);
        const maxY = this.cellY(aabb.max.y);
        const cells = this.cells;
        const stride = this._stride;

        for (let x = minX; x <= maxX; x++) {
            const row = x * stride;
            for (let y = minY; y <= maxY; y++) {
                const cell = cells[row + y];
                for (let i = 0; i < cell.length; i++) {
                    const id = cell[i];
                    bits[id >>> 5] |= 1 << (id & 31);
                }
            }
        }
    }
}

/**
 * Hash grid optimized for loot to loot collision.
 * @link https://github.com/reu/broadphase.js/blob/master/src/hash-grid.js
 *
 * Implements the space partitioning algorithim for better performance.
 * @see http://en.wikipedia.org/wiki/Space_partitioning
 */
export class HashGrid<T extends Loot = Loot> {
    width: number;
    height: number;

    cellSize: number;

    rows: number;
    cols: number;
    /** cell (x, y) is cells[y * cols + x]; only cells inside rows x cols, the only ones ever checked */
    private readonly cells: T[][];
    /** indices of the cells filled this check, so only those get visited and cleared */
    private readonly touched: number[] = [];

    constructor(width: number, height: number, cellSize: number) {
        this.width = width;
        this.height = height;

        this.cellSize = cellSize;

        this.rows = Math.ceil(this.height / this.cellSize);
        this.cols = Math.ceil(this.width / this.cellSize);

        this.cells = Array.from({ length: this.rows * this.cols }, () => []);
    }

    /**
     * Checks for collision using spatial grid hashing.
     *
     * Visits only the cells some loot landed in, in the same row-major order and with the same
     * per-cell insertion order as walking every cell, so the same pairs resolve in the same order.
     * Cells outside rows x cols were never checked, so loot isn't stored there at all.
     *
     * @param loots thie list of particles to check collisions.
     * @param comparator the function that, given two objects, return if they are colliding or not.
     * @param resolver the collision resolver which will receive each collision pair occurrence.
     */
    check(
        loots: T[],
        comparator: (a: T, b: T) => boolean,
        resolver: (a: T, b: T) => void,
    ) {
        const length = loots.length;
        const { cells, touched, rows, cols, cellSize } = this;

        for (let i = 0; i < length; i++) {
            const loot = loots[i];
            if (loot.destroyed) continue;

            const xMin = Math.max(((loot.pos.x - loot.lootRad) / cellSize) << 0, 0);
            const xMax = Math.min(((loot.pos.x + loot.lootRad) / cellSize) << 0, cols - 1);
            const yMin = Math.max(((loot.pos.y - loot.lootRad) / cellSize) << 0, 0);
            const yMax = Math.min(((loot.pos.y + loot.lootRad) / cellSize) << 0, rows - 1);

            for (let y = yMin; y <= yMax; y++) {
                for (let x = xMin; x <= xMax; x++) {
                    const idx = y * cols + x;
                    const cell = cells[idx];
                    if (cell.length === 0) touched.push(idx);
                    cell.push(loot);
                }
            }
        }

        touched.sort((a, b) => a - b);
        for (let i = 0; i < touched.length; i++) {
            const cell = cells[touched[i]];
            this.bruteForceCheck(cell, comparator, resolver);
            cell.length = 0;
        }
        touched.length = 0;
    }

    /**
     * The most basic implementation of collision detection, although it is suitable for lots of cases,
     * specially if your system has few particles (< 100).
     *
     * @param loots thie list of particles to check collisions.
     * @param comparator the function that, given two objects, return if they are colliding or not.
     * @param resolver the collision resolver which will receive each collision pair occurrence.
     */
    bruteForceCheck(
        loots: T[],
        comparator: (a: T, b: T) => boolean,
        resolver: (a: T, b: T) => void,
    ) {
        const length = loots.length;

        if (length < 2) return;

        for (let i = 0; i < length; i++) {
            const p1 = loots[i];

            for (let j = i + 1; j < length; j++) {
                const p2 = loots[j];

                if (comparator(p1, p2)) {
                    resolver(p1, p2);
                }
            }
        }
    }
}
