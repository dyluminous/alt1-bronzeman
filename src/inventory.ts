// inventory.ts — Inventory class: calibrated grid state + slot access.
// Detection (fingerprints, grid measurement) lives in detect.ts.
import * as a1lib from "alt1";
import { InventorySlot } from "./inventory-slot";

export interface BackpackAnchor {
    x: number; y: number;
    method: "manual" | "cursor" | "fallback" | "auto";
    colStride: number; rowStride: number;
    gridCols?: number;
    gridRows?: number;
    centerMismatch?: boolean;
    scrollbar?: boolean;
}

export class Inventory {
    private _anchor: BackpackAnchor | null = null;
    private _slots: InventorySlot[] = [];

    /** The detected grid anchor, or null when not calibrated. */
    get anchor(): BackpackAnchor | null { return this._anchor; }
    get isCalibrated(): boolean { return this._anchor !== null; }
    /** Column count from the anchor (0 when uncalibrated). */
    get cols(): number { return this._anchor?.gridCols ?? 0; }
    /** Row count from the anchor (0 when uncalibrated). */
    get rows(): number { return this._anchor?.gridRows ?? 0; }
    /** All slot instances built from the anchor (empty when uncalibrated). */
    get slots(): InventorySlot[] { return this._slots; }

    /** Store a freshly detected anchor and rebuild the slot list. */
    calibrate(anchor: BackpackAnchor): void {
        this._anchor = anchor;
        this._slots = [];
        for (let i = 0; i < this.getSlotCount(anchor); i++) {
            this._slots.push(new InventorySlot(anchor, this.cols, i));
        }
    }

    /** Number of slots a cols×rows grid yields, capped at the 28-slot backpack. */
    getSlotCount(anchor: BackpackAnchor): number {
        const raw = (anchor.gridCols ?? 0) * (anchor.gridRows ?? 0);
        return raw > 28 ? 28 : raw;
    }

    /** Columns in the last row — grids capped at 28 slots may have a short last row. */
    static lastRowCols(anchor: BackpackAnchor): number {
        const cols = anchor.gridCols ?? 0;
        const rows = anchor.gridRows ?? 0;
        const total = cols * rows;
        return total > 28 ? cols - (total - 28) : cols;
    }

    /** Drop calibration entirely. */
    clear(): void {
        this._anchor = null;
        this._slots = [];
    }

    /** Bounding box that covers every slot cell (border included), computed
     *  from the actual slot positions — not gridCols×gridRows — so resized
     *  grids with a short last row are fully covered. Returns null when
     *  uncalibrated. Cell spans x..x+37 (38 wide) and y..y+33 (34 tall). */
    getInventoryBounds(): { x: number; y: number; w: number; h: number } | null {
        if (this._slots.length === 0) return null;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const s of this._slots) {
            if (s.x < minX) minX = s.x;
            if (s.y < minY) minY = s.y;
            if (s.x + InventorySlot.CELL_W > maxX) maxX = s.x + InventorySlot.CELL_W;
            if (s.y + InventorySlot.CELL_H > maxY) maxY = s.y + InventorySlot.CELL_H;
        }
        return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }

    /** The slot at the given 0-based index, or null. */
    getSlot(index: number): InventorySlot | null {
        return this._slots[index] ?? null;
    }

    /** First column, first row — always slot index 0. */
    getFirstColumnFirstRowIndex(): number { return 0; }

    /** Last column, first row — the rightmost slot in the top row. */
    getLastColumnFirstRowIndex(): number { return this.cols - 1; }

    /** First column, last row — the bottom-left slot. */
    getFirstColumnLastRowIndex(): number {
        return Math.min(this.cols * (this.rows - 1), this._slots.length - 1);
    }

    /** The final slot in the grid (bottom-right-most existing slot). */
    getLastSlotIndex(): number {
        return this._slots.length - 1;
    }

    /** The slot index under viewport coords (x,y), or null when outside the grid. */
    getSlotIndexAt(x: number, y: number): number | null {
        const anc = this._anchor;
        if (!anc || anc.gridCols == null || anc.gridRows == null) return null;
        const col = Math.floor((x - anc.x) / anc.colStride);
        const row = Math.floor((y - anc.y) / anc.rowStride);
        if (col < 0 || col >= anc.gridCols || row < 0 || row >= anc.gridRows) return null;
        const idx = row * anc.gridCols + col;
        return idx < this._slots.length ? idx : null;
    }

    /** The slot index under the RS cursor, or null when outside the grid. */
    getHoveredSlotIndex(): number | null {
        const m = a1lib.getMousePosition();
        return m ? this.getSlotIndexAt(m.x, m.y) : null;
    }

    /** The adjacent slot indices — orthogonal (up/down/left/right) plus diagonals
     *  (TL/TR/BL/BR), orientation-aware. Only existing slots are returned (the
     *  capped last row may have fewer columns). */
    getAdjacentSlotIndices(index: number): number[] {
        const anc = this._anchor;
        if (!anc || anc.gridCols == null || anc.gridRows == null) return [];
        const cols = anc.gridCols, rows = anc.gridRows;
        const slot = this.getSlot(index);
        if (!slot) return [];
        const out: number[] = [];
        const candidates = [
            { c: slot.col - 1, r: slot.row },      // left
            { c: slot.col + 1, r: slot.row },      // right
            { c: slot.col, r: slot.row - 1 },      // up
            { c: slot.col, r: slot.row + 1 },      // down
            { c: slot.col - 1, r: slot.row - 1 },  // TL
            { c: slot.col + 1, r: slot.row - 1 },  // TR
            { c: slot.col - 1, r: slot.row + 1 },  // BL
            { c: slot.col + 1, r: slot.row + 1 },  // BR
        ];
        for (const { c, r } of candidates) {
            if (c < 0 || c >= cols || r < 0 || r >= rows) continue;
            const idx = r * cols + c;
            if (idx < this._slots.length) out.push(idx);
        }
        return out;
    }
}

/** Module-wide singleton — the app's calibrated inventory. */
export const inventory = new Inventory();
