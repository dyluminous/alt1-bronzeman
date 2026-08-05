// inventory-slot.ts — typed geometry + per-slot item checks for a backpack slot
import type { BackpackAnchor } from "./inventory";
import type { ImgRef } from "alt1/base";

/** Pixel coords within the RS game viewport. */
export interface Point { x: number; y: number }

/** Read one RGB pixel from an image, or null when unavailable. */
function readPixel(img: ImgRef, x: number, y: number): [number, number, number] | null {
    const d = img.toData(x, y, 1, 1);
    return d ? [d.data[0], d.data[1], d.data[2]] : null;
}

/** Shadow colour check — #000001 or #000002. */
function isShadow(r: number, g: number, b: number): boolean {
    return r === 0 && g === 0 && (b === 1 || b === 2);
}

export class InventorySlot {
    /** Interior cell size (36×32) — the slot cell minus its 1px border. */
    static readonly INTERIOR_W = 36;
    static readonly INTERIOR_H = 32;
    /** Full cell size (38×34) — includes the 1px border. */
    static readonly CELL_W = 38;
    static readonly CELL_H = 34;
    /** Corner labels in the same order as corners/cornerRefs. */
    static readonly CORNER_NAMES = ["TL", "TR", "BL", "BR"] as const;

    /** Noted-item mark pixel (border-relative): #95865e at (12,1) beside a
     *  #000002 shadow pixel at (13,1). Both must match. */
    private static readonly NOTED_MARK: [number, number, number] = [0x95, 0x86, 0x5e];
    private static readonly NOTED_MARK_X = 12;
    private static readonly NOTED_MARK_Y = 1;
    private static readonly NOTED_SHADOW_X = 13;

    /** The two guaranteed-yellow quantity-digit pixels, INTERIOR-relative (the
     *  stellar captures are interior-only, 36×32). Every stack-count digit 1–9
     *  renders #ffff00 at (4,1) or (3,3). */
    private static readonly STACKABLE_PIXELS: readonly (readonly [number, number])[] = [[4, 1], [3, 3]];

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
    /** True when the slot currently shows a stack-quantity digit (yellow) —
     *  i.e. the item is stackable. Updated by the scan tick. */
    isStackable: boolean = false;

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

    // ----------------------------------------------------------
    // Per-slot item checks (each takes the capture to read from)
    // ----------------------------------------------------------

    /** True when the corner pixel exactly matches its calibration ref. */
    static cornerMatches(corner: [number, number, number], ref: [number, number, number]): boolean {
        return corner[0] === ref[0] && corner[1] === ref[1] && corner[2] === ref[2];
    }

    /** True when this slot holds a noted item — the #95865e mark + #000002
     *  shadow beside it. Noted items are ignored completely (no gold dot, no
     *  tracking). */
    isNoted(img: ImgRef): boolean {
        const mark = readPixel(img, this.x + InventorySlot.NOTED_MARK_X, this.y + InventorySlot.NOTED_MARK_Y);
        const shadow = readPixel(img, this.x + InventorySlot.NOTED_SHADOW_X, this.y + InventorySlot.NOTED_MARK_Y);
        return !!mark && !!shadow
            && mark[0] === InventorySlot.NOTED_MARK[0] && mark[1] === InventorySlot.NOTED_MARK[1] && mark[2] === InventorySlot.NOTED_MARK[2]
            && shadow[0] === 0 && shadow[1] === 0 && shadow[2] === 2;
    }

    /** True when this slot shows a stack-quantity digit — the item is
     *  stackable. Any stack-count digit (1–9 verified) hits at least one of
     *  the two guaranteed-yellow pixels. */
    isStackableItem(img: ImgRef): boolean {
        for (const [dx, dy] of InventorySlot.STACKABLE_PIXELS) {
            const c = readPixel(img, this.interiorX + dx, this.interiorY + dy);
            if (c && c[0] === 0xff && c[1] === 0xff && c[2] === 0x00) return true;
        }
        return false;
    }

    /** True when the item is in "Use" state — the white outline replaces the
     *  item shadow. Captures the 38×34 cell once, then scans the buffer BR→BL
     *  upward for a #FFFFFF pixel surrounded on all 4 sides by shadow. */
    isInUseState(img: ImgRef): boolean {
        const W = InventorySlot.CELL_W, H = InventorySlot.CELL_H;
        const buf = img.toData(this.x, this.y, W, H);
        if (!buf) return false;
        const d = buf.data;
        const stride = W * 4;
        for (let y = H - 1; y >= 0; y--) {
            const row = y * stride;
            for (let x = W - 1; x >= 0; x--) {
                const i = row + x * 4;
                if (d[i] !== 255 || d[i + 1] !== 255 || d[i + 2] !== 255) continue;
                if (y > 0 && isShadow(d[i - stride], d[i + 1 - stride], d[i + 2 - stride])
                    && y < H - 1 && isShadow(d[i + stride], d[i + 1 + stride], d[i + 2 + stride])
                    && x > 0 && isShadow(d[i - 4], d[i + 1 - 4], d[i + 2 - 4])
                    && x < W - 1 && isShadow(d[i + 4], d[i + 1 + 4], d[i + 2 + 4])) {
                    return true;
                }
            }
        }
        return false;
    }

    /** True when any corner no longer matches its calibration ref (slot is
     *  covered by a tooltip/menu). */
    isCovered(img: ImgRef): boolean {
        if (this.cornerRefs.length !== 4) return true;
        return this.corners.some((c, i) => {
            const live = readPixel(img, c.x, c.y);
            return !live || !InventorySlot.cornerMatches(live, this.cornerRefs[i]);
        });
    }

    /** True when the interior has no item shadow pixels — every RS item has a
     *  1px drop shadow; empty brown slots never do. */
    static isEmpty(data: Uint8ClampedArray): boolean {
        for (let i = 0; i < data.length; i += 4) {
            if (isShadow(data[i], data[i + 1], data[i + 2])) return false;
        }
        return true;
    }
}
