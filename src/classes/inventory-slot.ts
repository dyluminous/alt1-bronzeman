// inventory-slot.ts — typed geometry + per-slot item checks for a backpack slot
import type { BackpackAnchor, Point } from "../types";
import type { ImgRef } from "alt1/base";
import { readPixel, rgbMatch } from "../utils/helpers";

export type { Point } from "../types";

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

    /** Drag-indicator pixels (interior-relative, 36×32 interior): while the
     *  player is dragging an item, #f0be79 renders at (33,0) and (33,31) — the
     *  top and bottom of the right-edge indicator line. Both must match. */
    private static readonly DRAG_MARK: [number, number, number] = [0xf0, 0xbe, 0x79];
    private static readonly DRAG_MARK_X = 33;
    private static readonly DRAG_MARK_TOP_Y = 0;
    private static readonly DRAG_MARK_BOTTOM_Y = 31;

    /** The two guaranteed quantity-digit pixels, INTERIOR-relative (the
     *  stellar captures are interior-only, 36×32). Every stack-count digit 1–9
     *  renders at (4,1) or (3,3). */
    private static readonly STACKABLE_PIXELS: readonly (readonly [number, number])[] = [[4, 1], [3, 3]];

    /** Stack-quantity digit colors, by magnitude:
     *  ≤99999 → yellow #ffff00; ≥100k → white #ffffff (xxxK);
     *  ≥1M → green #1eff00 (xxxM); ≥1B → blue #6698ff (xxxB). */
    static readonly STACK_DIGIT_COLORS: readonly (readonly [number, number, number])[] = [
        [0xff, 0xff, 0x00],
        [0xff, 0xff, 0xff],
        [0x1e, 0xff, 0x00],
        [0x66, 0x98, 0xff],
    ];

    /** Magnitude multiplier per STACK_DIGIT_COLORS entry. The screen shows
     *  truncated text ("105K" for 105000); OCR only reads the digits, so the
     *  color tier tells us how much to scale them. */
    static readonly STACK_DIGIT_MULTIPLIERS: readonly number[] = [1, 1000, 1e6, 1e9];

    /** Returns the magnitude multiplier for a detected digit color. */
    static stackDigitMultiplier(color: readonly [number, number, number]): number {
        const i = InventorySlot.STACK_DIGIT_COLORS.findIndex(c => c[0] === color[0] && c[1] === color[1] && c[2] === color[2]);
        return i >= 0 ? InventorySlot.STACK_DIGIT_MULTIPLIERS[i] : 1;
    }

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
        return rgbMatch(corner, ref);
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

    /** True when the player is dragging this slot's item — the #f0be79 drag
     *  indicator pixels at (33,0) and (33,31), interior-relative, both match.
     *  Ignored the same way noted items are. */
    isDraggingItem(img: ImgRef): boolean {
        const top = readPixel(img, this.interiorX + InventorySlot.DRAG_MARK_X, this.interiorY + InventorySlot.DRAG_MARK_TOP_Y);
        const bottom = readPixel(img, this.interiorX + InventorySlot.DRAG_MARK_X, this.interiorY + InventorySlot.DRAG_MARK_BOTTOM_Y);
        return !!top && !!bottom
            && top[0] === InventorySlot.DRAG_MARK[0] && top[1] === InventorySlot.DRAG_MARK[1] && top[2] === InventorySlot.DRAG_MARK[2]
            && bottom[0] === InventorySlot.DRAG_MARK[0] && bottom[1] === InventorySlot.DRAG_MARK[1] && bottom[2] === InventorySlot.DRAG_MARK[2];
    }

    /** True when this slot shows a stack-quantity digit — the item is
     *  stackable. Any stack-count digit (1–9 verified) hits at least one of
     *  the two guaranteed pixels, in any of the tier colors. */
    isStackableItem(img: ImgRef): boolean {
        return this.stackDigitColor(img) !== null;
    }

    /** Returns the digit color at the guaranteed stack-quantity pixels
     *  (interior-relative), or null when the slot shows no quantity digits.
     *  Callers use the returned color to drive the OCR filter. */
    stackDigitColor(img: ImgRef): readonly [number, number, number] | null {
        for (const [dx, dy] of InventorySlot.STACKABLE_PIXELS) {
            const c = readPixel(img, this.interiorX + dx, this.interiorY + dy);
            if (!c) continue;
            for (const col of InventorySlot.STACK_DIGIT_COLORS) {
                if (c[0] === col[0] && c[1] === col[1] && c[2] === col[2]) return col;
            }
        }
        return null;
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
        const WHITE = 255;
        for (let y = H - 1; y >= 0; y--) {
            const row = y * stride;
            for (let x = W - 1; x >= 0; x--) {
                const i = row + x * 4;
                if (d[i] !== WHITE || d[i + 1] !== WHITE || d[i + 2] !== WHITE) continue;
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
