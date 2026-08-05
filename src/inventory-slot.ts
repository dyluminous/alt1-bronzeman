// inventory-slot.ts — typed geometry for a single backpack slot
import type { BackpackAnchor } from "./inventory";

/** Pixel coords within the RS game viewport. */
export interface Point { x: number; y: number }

/** 4 corner pixel data captured during calibration (R,G,B per corner). */
export interface SlotCorners {
    tl: [number, number, number];
    tr: [number, number, number];
    bl: [number, number, number];
    br: [number, number, number];
}

export class InventorySlot {
    readonly index: number;
    readonly col: number;
    readonly row: number;

    /** Top-left X of the slot content area (36×32, excludes 1px border). */
    readonly x: number;
    /** Top-left Y of the slot content area. */
    readonly y: number;

    /** Corner pixel data set after calibration, or null. */
    corners: SlotCorners | null = null;

    constructor(anc: BackpackAnchor, cols: number, index: number) {
        this.index = index;
        this.col = index % cols;
        this.row = Math.floor(index / cols);
        this.x = anc.x + this.col * anc.colStride;
        this.y = anc.y + this.row * anc.rowStride;
    }

    /** Center pixel of the slot cell (including 1px border). */
    get cx(): number { return this.x + 18; }
    /** Center pixel of the slot cell. */
    get cy(): number { return this.y + 16; }

    /** Top-left corner of the slot border (1px outside content area). */
    get tl(): Point { return { x: this.x - 1, y: this.y - 1 }; }
    /** Top-right corner of the slot border. */
    get tr(): Point { return { x: this.x + 36, y: this.y - 1 }; }
    /** Bottom-left corner of the slot border. */
    get bl(): Point { return { x: this.x - 1, y: this.y + 32 }; }
    /** Bottom-right corner of the slot border. */
    get br(): Point { return { x: this.x + 36, y: this.y + 32 }; }
}
