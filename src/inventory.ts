import { ImgRef } from "alt1/base";

export interface BackpackAnchor {
    x: number; y: number;
    method: "manual" | "cursor" | "fallback" | "auto";
    colStride: number; rowStride: number;
    gridCols?: number;
    gridRows?: number;
    centerMismatch?: boolean;
    scrollbar?: boolean;
}

export type DebugLog = (msg: string) => void;
export const COLS = 4, ROWS = 7;

// ============================================================
// Anchor & stride persistence in localStorage
// ============================================================
const ANCHOR_KEY = "Bronzeman/anchor";

export function saveAnchor(anchor: BackpackAnchor): void {
    localStorage.setItem(ANCHOR_KEY, JSON.stringify(anchor));
}
export function loadAnchor(): BackpackAnchor | null {
    const raw = localStorage.getItem(ANCHOR_KEY);
    if (!raw) return null;
    try { const a = JSON.parse(raw); if (a && typeof a.x === "number") return a as BackpackAnchor; } catch { /* corrupt */ }
    return null;
}
export function clearAnchor(): void { localStorage.removeItem(ANCHOR_KEY); }
export function hasAnchor(): boolean { return !!localStorage.getItem(ANCHOR_KEY); }

/** Returns the center pixel of a slot (0-indexed) given the anchor grid. */
export function getSlotCenterCoordinates(anc: BackpackAnchor, slotIndex: number): { x: number; y: number } {
    const col = slotIndex % COLS;
    const row = Math.floor(slotIndex / COLS);
    return {
        x: anc.x + col * anc.colStride + 19,
        y: anc.y + row * anc.rowStride + 17,
    };
}

// ============================================================
// Anchor pixel tracking — detect when inventory moves
// ============================================================
const ANCHOR_PIXEL_KEY = "Bronzeman/anchorPixel";

export interface AnchorPixel {
    x: number; y: number;  // BL corner position
    r: number; g: number; b: number;
}

export function saveAnchorPixel(img: ImgRef, anc: BackpackAnchor): void {
    const bx = anc.x - 1;  // BL corner x
    const by = anc.y + 32; // BL corner y
    if (bx < 0 || by < 0 || bx >= img.width || by >= img.height) return;
    const d = img.toData(bx, by, 1, 1);
    if (!d) return;
    const pixel: AnchorPixel = { x: bx, y: by, r: d.data[0], g: d.data[1], b: d.data[2] };
    localStorage.setItem(ANCHOR_PIXEL_KEY, JSON.stringify(pixel));
}

export function clearAnchorPixel(): void { localStorage.removeItem(ANCHOR_PIXEL_KEY); }

// ============================================================
// Outer perimeter bounding box + empty slot data persistence
// ============================================================

const OUTER_PERM_KEY = "Bronzeman/outerPerm";
const EMPTY_SLOT_KEY = "Bronzeman/emptySlotData";

const OUTER_L: [number,number][][] = [
    [[-1,-1],[0,-1],[-1,0]],
    [[36,-1],[35,-1],[36,0]],
    [[-1,32],[0,32],[-1,31]],
    [[36,32],[35,32],[36,31]],
];

export function captureOuterPerm(img: ImgRef, anc: BackpackAnchor, debug: DebugLog): number[] | null {
    const pixels: number[] = [];
    for (let row = 0; row < ROWS; row++) {
        for (let col = 0; col < COLS; col++) {
            const sx = anc.x + col * anc.colStride;
            const sy = anc.y + row * anc.rowStride;
            for (const corner of OUTER_L) {
                for (const [dx, dy] of corner) {
                    const ax = sx + dx, ay = sy + dy;
                    if (ax < 0 || ay < 0 || ax >= img.width || ay >= img.height) {
                        debug(`outer_perm: slot [${row},${col}] out of bounds`);
                        return null;
                    }
                    const d = img.toData(ax, ay, 1, 1);
                    pixels.push(d.data[0], d.data[1], d.data[2]);
                }
            }
        }
    }
    localStorage.setItem(OUTER_PERM_KEY, JSON.stringify(pixels));
    debug(`outer_perm: saved ${pixels.length/3} pixels`);
    return pixels;
}

export function clearOuterPerm(): void { localStorage.removeItem(OUTER_PERM_KEY); }

export function captureEmptySlotData(img: ImgRef, anc: BackpackAnchor, debug: DebugLog): Uint8ClampedArray | null {
    const sx = anc.x + 3 * anc.colStride;
    const sy = anc.y + 6 * anc.rowStride;
    const W = 36, H = 32;
    if (sx + W > img.width || sy + H > img.height || sx < 0 || sy < 0) {
        debug(`empty_slot: slot 28 out of bounds`);
        return null;
    }
    const data = img.toData(sx, sy, W, H);
    localStorage.setItem(EMPTY_SLOT_KEY, JSON.stringify(Array.from(data.data)));
    debug(`empty_slot: captured slot 28 (${W}x${H})`);
    return new Uint8ClampedArray(data.data);
}

export function clearEmptySlotData(): void { localStorage.removeItem(EMPTY_SLOT_KEY); }

// ============================================================
// Fingerprint slot detection
// ============================================================
/** 6 fingerprint sets — each is 5 pixels (15 bytes: R,G,B × 5) from bottom row of reference slots */
const FINGERPRINTS: number[][] = [
    [49,45,42,52,48,44,54,48,45,56,52,47,54,49,46],  // o1
    [49,45,42,54,49,45,54,50,46,54,49,46,55,50,47],  // o2
    [51,47,43,55,51,46,52,48,44,55,50,47,55,50,47],  // o3
    [49,45,42,52,48,44,54,48,45,56,52,47,54,49,46],  // o4
    [53,50,45,52,48,44,54,48,45,55,50,47,56,52,47],  // o5
    [53,50,45,52,48,44,54,48,45,55,50,47,56,52,47],  // o6
    [51,47,43,52,48,44,52,48,44,55,50,47,56,52,47],  // o7 — from fail_1 in-game render
    [49,45,42,54,49,45,54,48,45,56,52,47,55,50,47],  // o8
    [51,47,43,55,51,46,54,50,46,54,49,46,55,50,47],  // o9
    [53,50,45,55,51,46,52,48,44,55,50,47,56,52,47],  // o10
    [51,47,43,54,49,45,54,50,46,56,52,47,54,49,46],  // o11
    [53,50,45,52,48,44,54,48,45,56,52,47,54,49,46],  // o12
    [49,45,42,54,49,45,54,50,46,54,49,46,56,52,47],  // o13
    [51,47,43,55,51,46,52,48,44,56,52,47,56,52,47],  // o14
    [49,45,42,55,51,46,54,50,46,56,52,47,55,50,47],  // o15
];

export interface FingerprintHit {
    x: number; y: number;  // BL-corner position
    fingerIndex: number;   // which fingerprint matched (0-5)
}

/** Scan the image for an exact 5-pixel fingerprint match. Returns the first hit or null. */
export function findSlotByFingerprint(img: ImgRef): FingerprintHit | null {
    try {
        const w = img.width, h = img.height;
        // Read only the region we need — but Alt1 toData is per-call expensive.
        // Instead read the full buffer once.
        const buf = img.toData(0, 0, w, h);
        const d = buf.data;

        for (let y = 1; y < h; y++) {
            for (let x = 0; x < w - 5; x++) {
                const idx = (y * w + x) * 4;
                for (let f = 0; f < FINGERPRINTS.length; f++) {
                    const fp = FINGERPRINTS[f];
                    if (d[idx] === fp[0] && d[idx + 1] === fp[1] && d[idx + 2] === fp[2] &&
                        d[idx + 4] === fp[3] && d[idx + 5] === fp[4] && d[idx + 6] === fp[5] &&
                        d[idx + 8] === fp[6] && d[idx + 9] === fp[7] && d[idx + 10] === fp[8] &&
                        d[idx + 12] === fp[9] && d[idx + 13] === fp[10] && d[idx + 14] === fp[11] &&
                        d[idx + 16] === fp[12] && d[idx + 17] === fp[13] && d[idx + 18] === fp[14]) {
                        return { x: x + img.x, y: y + img.y, fingerIndex: f };
                    }
                }
            }
        }
    } catch (e) { /* pass */ }
    return null;
}

/** Compute HSL lightness from RGB. Returns 0-100. */
export function lightness(r: number, g: number, b: number): number {
    const max = Math.max(r, g, b) / 255, min = Math.min(r, g, b) / 255;
    return Math.round(((max + min) / 2) * 100);
}

/** Given a found slot1 BL corner, scan right to find slot2 BL corner and return gap width.
 *  Gap pixels are dark (L ≤ 15%), border pixels are bright (L ≥ 17%).
 *  Returns null if slot2 not found within search range. */
export function measureGapToSlot2(
    img: ImgRef,
    slot1BL: { x: number; y: number },
): { slot2X: number; gapWidth: number } | null {
    try {
        const w = img.width, h = img.height;
        // BR of slot 1 = x + 37, same y
        const brX = slot1BL.x + 37;
        const y = slot1BL.y;
        if (brX + 1 >= w || y >= h) return null;

        // Read just the row we need — one pixel at a time to avoid full buffer
        let gapCount = 0;
        for (let sx = brX + 1; sx < Math.min(brX + 60, w); sx++) {
            const d = img.toData(sx, y, 1, 1);
            if (!d) return null;
            const r = d.data[0], g = d.data[1], b = d.data[2];
            const l = lightness(r, g, b);
            if (l <= 15) {
                gapCount++; // still in the gap
            } else if (l >= 17) {
                // Found slot2 BL corner
                return { slot2X: sx, gapWidth: gapCount };
            } else {
                // Ambiguous (16%) — continue counting but don't decide
                gapCount++;
            }
        }
    } catch (e) { /* pass */ }
    return null;
}

/** Given slot1 BL and column stride, scan right to count total columns.
 *  Each hop checks the BL pixel: L ≥ 17% (same check as gap scan).
 *  Stops when no border pixel found. */
export function countColumns(
    img: ImgRef,
    slot1BL: { x: number; y: number },
    colStride: number,
    maxCols: number = 24,
): number {
    const INVENTORY_BORDER_LINE_COLORS = [
        [50,40,28], [71,57,38], [87,73,48], [44,35,26],  // #32281C #473926 #574930 #2C231A
    ];
    const SCROLLBAR_COLORS = [
        [255,238,157], [255,223,145], [254,201,128], [178,139,90], [130,100,64], [104,77,47],
        // #FFEE9D #FFDF91 #FEC980 #B28B5A #826440 #684D2F
    ];
    let count = 1; // slot 1 is column 0
    for (let c = 1; c < maxCols; c++) {
        const sx = slot1BL.x + c * colStride;
        if (sx + 1 >= img.width) break;
        const d = img.toData(sx, slot1BL.y, 1, 1);
        if (!d) break;
        // Stop if we hit the inventory border line
        if (INVENTORY_BORDER_LINE_COLORS.some(([r,g,b]) => d.data[0]===r && d.data[1]===g && d.data[2]===b)) break;
        // Scrollbar detected — return -c to signal scrollbar
        if (SCROLLBAR_COLORS.some(([r,g,b]) => d.data[0]===r && d.data[1]===g && d.data[2]===b)) return -1;
        const l = lightness(d.data[0], d.data[1], d.data[2]);
        if (l >= 17) count++; else break;
    }
    return count;
}

/** Full auto-detect: fingerprint slot 1 → measure gap → count columns → count rows.
 *  Returns a BackpackAnchor or null. */
export function detectInventoryGrid(img: ImgRef): BackpackAnchor | null {
    const hit = findSlotByFingerprint(img);
    if (!hit) return null;

    const gap = measureGapToSlot2(img, { x: hit.x, y: hit.y });
    if (!gap) return null;
    const colStride = gap.slot2X - hit.x;

    const cols = countColumns(img, { x: hit.x, y: hit.y }, colStride);
    if (cols === -1) return { x: hit.x + 1, y: hit.y - 32, method: "auto", colStride: 0, rowStride: 0, gridCols: 0, gridRows: 0, scrollbar: true };
    if (cols < 2) return null;

    const rowStride = 36;
    let rows = 0;
    for (let r = 0; r < 10; r++) {
        const sy = hit.y + r * rowStride;
        if (sy >= img.height) break;
        const d = img.toData(hit.x, sy, 1, 1);
        if (!d) break;
        if (lightness(d.data[0], d.data[1], d.data[2]) >= 17) rows++; else break;
    }
    if (rows < 2) return null;

    if (rows < 2) return null;

    return {
        x: hit.x + 1,
        y: hit.y - 32,
        method: "auto",
        colStride,
        rowStride,
        gridCols: cols,
        gridRows: rows,
    };
}



