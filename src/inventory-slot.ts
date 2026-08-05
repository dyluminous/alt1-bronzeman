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

    /** Top-left X of the slot cell (38×34, includes 1px border). */
    readonly x: number;
    /** Top-left Y of the slot cell. */
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

    /** Center pixel of the slot cell. */
    get cx(): number { return this.x + 19; }
    /** Center pixel of the slot cell. */
    get cy(): number { return this.y + 17; }

    /** Top-left corner of the slot border. */
    get tl(): Point { return { x: this.x, y: this.y }; }
    /** Top-right corner of the slot border. */
    get tr(): Point { return { x: this.x + 37, y: this.y }; }
    /** Bottom-left corner of the slot border. */
    get bl(): Point { return { x: this.x, y: this.y + 33 }; }
    /** Bottom-right corner of the slot border. */
    get br(): Point { return { x: this.x + 37, y: this.y + 33 }; }
}
