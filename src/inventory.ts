// inventory.ts — Inventory class: calibrated grid state + slot access.
// Detection (fingerprints, grid measurement) lives in detect.ts.
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
        const cols = anchor.gridCols ?? 0;
        const rawTotal = cols * (anchor.gridRows ?? 0);
        const slotCount = rawTotal > 28 ? 28 : rawTotal;
        for (let i = 0; i < slotCount; i++) {
            this._slots.push(new InventorySlot(anchor, cols, i));
        }
    }

    /** Drop calibration entirely. */
    clear(): void {
        this._anchor = null;
        this._slots = [];
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
}

/** Module-wide singleton — the app's calibrated inventory. */
export const inventory = new Inventory();
