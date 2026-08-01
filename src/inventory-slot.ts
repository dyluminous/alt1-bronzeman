// inventory-slot.ts — typed geometry for a single backpack slot
import type { BackpackAnchor } from "./inventory";

/** Pixel coords within the RS game viewport. */
export interface Point { x: number; y: number }

export class InventorySlot {
    /** Interior cell size (36×32) — the slot cell minus its 1px border. */
    static readonly INTERIOR_W = 36;
    static readonly INTERIOR_H = 32;
    /** Full cell size (38×34) — includes the 1px border. */
    static readonly CELL_W = 38;
    static readonly CELL_H = 34;
    /** Corner labels in the same order as corners/cornerRefs. */
    static readonly CORNER_NAMES = ["TL", "TR", "BL", "BR"] as const;

    readonly index: number;
    readonly col: number;
    readonly row: number;

    /** Top-left X of the slot cell (38×34, includes 1px border). */
    readonly x: number;
    /** Top-left Y of the slot cell. */
    readonly y: number;

    /** Reference border colors captured at calibration, in [TL, TR, BL, BR] order. */
    cornerRefs: [number, number, number][] = [];
    /** Hash of the slot contents from the last clean scan (null = no baseline yet). */
    previousHash: string | null = null;
    /** Interior RGBA from the last clean (non-obscured) scan — shown in the debug
     *  pane when the slot is currently occluded. Null until first clean read. */
    lastValidPixels: Uint8ClampedArray | null = null;

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

    /** Top-left X of the interior cell (inside the 1px border). */
    get interiorX(): number { return this.x + 1; }
    /** Top-left Y of the interior cell (inside the 1px border). */
    get interiorY(): number { return this.y + 1; }

    /** Top-left corner of the slot border. */
    get tl(): Point { return { x: this.x, y: this.y }; }
    /** Top-right corner of the slot border. */
    get tr(): Point { return { x: this.x + 37, y: this.y }; }
    /** Bottom-left corner of the slot border. */
    get bl(): Point { return { x: this.x, y: this.y + 33 }; }
    /** Bottom-right corner of the slot border. */
    get br(): Point { return { x: this.x + 37, y: this.y + 33 }; }

    /** The four border corners in [TL, TR, BL, BR] order — matches cornerRefs. */
    get corners(): Point[] { return [this.tl, this.tr, this.bl, this.br]; }
}
