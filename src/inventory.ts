import { ImgRef } from "alt1/base";

export interface BackpackAnchor {
    x: number; y: number;
    method: "manual" | "cursor" | "fallback";
    colStride: number; rowStride: number;
}

export interface SlotState {
    index: number; col: number; row: number;
    x: number; y: number; w: number; h: number;
    hash: string; changed: boolean; diffScore: number;
}

export interface ScanResult {
    anchor: BackpackAnchor; slots: SlotState[];
    changes: number; time: number;
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

/** Adjust stride by +/- 1px, clamped to sane ranges. */
export function adjustStride(dCol: number, dRow: number): BackpackAnchor | null {
    const a = loadAnchor();
    if (!a) return null;
    a.colStride = Math.max(30, Math.min(60, a.colStride + dCol));
    a.rowStride = Math.max(26, Math.min(56, a.rowStride + dRow));
    saveAnchor(a);
    return a;
}

/** Nudge anchor position by a few pixels. */
export function shiftAnchor(dx: number, dy: number): BackpackAnchor | null {
    const a = loadAnchor();
    if (!a) return null;
    a.x += dx; a.y += dy;
    saveAnchor(a);
    return a;
}

// ============================================================
// Capture anchor at RS cursor position (after countdown)
// ============================================================

export function captureAnchorAtCursor(a1lib: any): BackpackAnchor | null {
    try {
        const pos = a1lib.getMousePosition();
        if (!pos || pos.x <= 0 || pos.y <= 0) return null;
        const anchor: BackpackAnchor = {
            x: pos.x, y: pos.y,
            method: "cursor",
            colStride: 42, rowStride: 38,
        };
        saveAnchor(anchor);
        return anchor;
    } catch { return null; }
}

// ============================================================
// Auto-detect slot 1 from cursor point (anywhere inside slot 1).
//
// From cursor, scan right+down for this exact 2-pixel pattern:
//   #35322d = bottom-right border corner pixel
//   #1e1916 = NW of it — the bottom-right pixel of the slot interior
// Once found, compute top-left by subtracting slot size (36×32).
// ============================================================

function distToColor(r: number, g: number, b: number, tr: number, tg: number, tb: number): number {
    return Math.abs(r - tr) + Math.abs(g - tg) + Math.abs(b - tb);
}

const TARGET_R = 53, TARGET_G = 50, TARGET_B = 45;   // #35322d border corner
const NEIGHBOR_R = 55, NEIGHBOR_G = 51, NEIGHBOR_B = 46; // #37332e above + left
const INTERIOR_R = 30, INTERIOR_G = 25, INTERIOR_B = 22; // #1e1916 slot interior
const COLOR_TOL = 12;

/** Full 4-pixel corner pattern: #35322d at (x,y) with all 3 verified neighbors. */
function matchCorner(buf: ImageData, x: number, y: number, w: number): boolean {
    if (x < 1 || y < 1 || x >= w - 1) return false;
    const i = (y * w + x) * 4;
    if (distToColor(buf.data[i], buf.data[i+1], buf.data[i+2], TARGET_R, TARGET_G, TARGET_B) > COLOR_TOL) return false;
    const nw = ((y-1) * w + (x-1)) * 4;
    if (distToColor(buf.data[nw], buf.data[nw+1], buf.data[nw+2], INTERIOR_R, INTERIOR_G, INTERIOR_B) > COLOR_TOL) return false;
    const ab = ((y-1) * w + x) * 4;
    if (distToColor(buf.data[ab], buf.data[ab+1], buf.data[ab+2], NEIGHBOR_R, NEIGHBOR_G, NEIGHBOR_B) > COLOR_TOL) return false;
    const le = (y * w + (x-1)) * 4;
    if (distToColor(buf.data[le], buf.data[le+1], buf.data[le+2], NEIGHBOR_R, NEIGHBOR_G, NEIGHBOR_B) > COLOR_TOL) return false;
    return true;
}

export function detectSlotBounds(img: ImgRef, cursorX: number, cursorY: number, debug: DebugLog): BackpackAnchor | null {
    try {
        const regionX = Math.max(img.x, cursorX - 10);
        const regionY = Math.max(img.y, cursorY - 10);
        const regionW = Math.min(250, img.width - regionX);
        const regionH = Math.min(250, img.height - regionY);

        if (regionW < 4 || regionH < 4) {
            debug(`detect: region too small (${regionW}x${regionH})`);
            return null;
        }

        const buf = img.toData(regionX, regionY, regionW, regionH);
        const cx = cursorX - regionX;
        const cy = cursorY - regionY;

        // Diagnostic: dump cursor area with #35322d distance scores
        const lines: string[] = [];
        for (let dy = -3; dy <= 3; dy++) {
            const row: string[] = [];
            for (let dx = -3; dx <= 3; dx++) {
                const sx = cx + dx, sy = cy + dy;
                if (sx < 0 || sy < 0 || sx >= regionW || sy >= regionH) { row.push(" ---"); continue; }
                const i = (sy * regionW + sx) * 4;
                const r = buf.data[i], g = buf.data[i + 1], b = buf.data[i + 2];
                const d353 = distToColor(r, g, b, 53, 50, 45);
                const d1e1 = distToColor(r, g, b, 30, 25, 22);
                row.push(d353 <= 8 ? `[353:${d353}]` : d1e1 <= 8 ? `[1e1:${d1e1}]` : `${r},${g},${b}`);
            }
            lines.push(row.join(" "));
        }
        debug(`detect: cursor at (${cursorX},${cursorY}) region(${regionX},${regionY})\n${lines.join("\n")}`);

        // Scan right+down from cursor to find bottom-right border corner
        let bestX = -1, bestY = -1, bestDist = Infinity;
        for (let y = Math.max(3, cy); y < regionH - 2; y++) {
            for (let x = Math.max(3, cx); x < regionW - 2; x++) {
                if (!matchCorner(buf, x, y, regionW)) continue;
                const d = (x - cx) + (y - cy);
                if (d < bestDist) { bestDist = d; bestX = x; bestY = y; }
            }
        }

        if (bestX < 0) {
            debug("detect: #35322d + #1e1916 pattern not found");
            return null;
        }

        // bestX,bestY = bottom-right BORDER corner (#35322d)
        // Slot interior is 36×32. Bottom-right interior pixel = NW of border corner.
        // Top-left interior = bestX - 36, bestY - 32
        const slotTopLeftX = regionX + bestX - 36;
        const slotTopLeftY = regionY + bestY - 32;
        debug(`detect: border corner at local (${bestX},${bestY}) → slot TL (${slotTopLeftX},${slotTopLeftY})`);

        // Column stride: capture a small region right of slot 1 and do a 2D scan
        // for slot 2's BR corner — same technique as slot 1 detection.
        let colStride = 42;
        {
            const ry = regionY + bestY - 5;
            const rx = regionX + bestX + 6;  // just right of slot 1's border
            const rw = Math.min(60, regionW - (bestX + 6));
            const rh = Math.min(20, regionH - (bestY - 5));
            if (rw > 4 && rh > 4) {
                const rbuf = img.toData(rx, ry, rw, rh);
                let foundX = -1;
                for (let y = 3; y < rh - 2 && foundX < 0; y++) {
                    for (let x = 3; x < rw - 2; x++) {
                        if (matchCorner(rbuf, x, y, rw)) {
                            const absCornerY = ry + y;
                            const absBestY = regionY + bestY;
                            if (Math.abs(absCornerY - absBestY) <= 3) {
                                colStride = (rx + x) - (regionX + bestX);
                                debug(`detect: colStride=${colStride} (slot 2 BR at abs (${rx + x},${absCornerY}))`);
                                foundX = x;
                            }
                        }
                    }
                }
                if (foundX < 0) debug(`detect: colStride 2D scan found no match`);
            }
        }
        if (colStride === 42) debug(`detect: colStride not found, using default 42`);

        // Row stride: scan the original buffer below slot 1's BR corner.
        // Row 2's BR corner should be ~34-44px below.
        let rowStride = 38;
        {
            let found = false;
            for (let y = bestY + 28; y <= bestY + 65 && y < regionH - 2 && !found; y++) {
                for (let x = bestX - 8; x <= bestX + 8 && x < regionW - 2; x++) {
                    if (x < 1 || y < 1) continue;
                    if (matchCorner(buf, x, y, regionW)) {
                        rowStride = y - bestY;
                        debug(`detect: rowStride=${rowStride} (row 2 BR at local ${x},${y} abs ${regionX+x},${regionY+y})`);
                        found = true; break;
                    }
                }
            }
            if (!found) {
                const dump: string[] = [];
                for (let y = bestY + 28; y <= bestY + 65 && y < regionH; y++) {
                    const i = (y * regionW + bestX) * 4;
                    const r = buf.data[i], g = buf.data[i+1], b = buf.data[i+2];
                    const dc = distToColor(r,g,b, TARGET_R,TARGET_G,TARGET_B);
                    const nw = ((y-1)*regionW+(bestX-1))*4;
                    const dnw = distToColor(buf.data[nw],buf.data[nw+1],buf.data[nw+2], INTERIOR_R,INTERIOR_G,INTERIOR_B);
                    const ab = ((y-1)*regionW+bestX)*4;
                    const dab = distToColor(buf.data[ab],buf.data[ab+1],buf.data[ab+2], NEIGHBOR_R,NEIGHBOR_G,NEIGHBOR_B);
                    const le = (y*regionW+(bestX-1))*4;
                    const dle = distToColor(buf.data[le],buf.data[le+1],buf.data[le+2], NEIGHBOR_R,NEIGHBOR_G,NEIGHBOR_B);
                    const ok = dc<=8&&dnw<=8&&dab<=8&&dle<=8 ? " ✓" : "";
                    dump.push(`dy${y-bestY} c=${r},${g},${b}(d${dc}) nw_d=${dnw} ab_d=${dab} le_d=${dle}${ok}`);
                }
                debug(`detect: row scan dump at x=${bestX}:\n${dump.join("\n")}`);
                debug(`detect: rowStride 2D scan found no match`);
            }
        }
        if (rowStride === 38) debug(`detect: rowStride not found, using default 38`);

        const anchor: BackpackAnchor = {
            x: slotTopLeftX, y: slotTopLeftY,
            method: "manual",
            colStride, rowStride,
        };
        debug(`detect: anchor=(${anchor.x},${anchor.y}) col=${colStride} row=${rowStride}`);
        saveAnchor(anchor);
        return anchor;

    } catch (e) {
        debug(`detect error: ${e}`);
        return null;
    }
}

// ============================================================
// Resolve anchor: saved > fallback
// ============================================================

export function findBackpack(img: ImgRef, debug: DebugLog): BackpackAnchor {
    const saved = loadAnchor();
    if (saved) return saved;

    const fx = img.width - 260, fy = img.height - 340;
    const fb: BackpackAnchor = {
        x: fx, y: fy, method: "fallback", colStride: 42, rowStride: 38,
    };
    debug(`anchor: FALLBACK (${fx}, ${fy})`);
    return fb;
}

// ============================================================
// Slot hashing — 8×8 cells, 4-bit brightness → 64-char hex
// ============================================================

const CHANGE_THRESHOLD = 24;

function hashSlot(data: ImageData): Uint8Array {
    const cells = new Uint8Array(64);
    if (data.width < 4 || data.height < 4) return cells;
    const cw = Math.max(1, Math.floor(data.width / 8));
    const ch = Math.max(1, Math.floor(data.height / 8));
    for (let cy = 0; cy < 8; cy++) {
        for (let cx = 0; cx < 8; cx++) {
            let sum = 0, cnt = 0;
            for (let dy = 0; dy < ch; dy++) {
                for (let dx = 0; dx < cw; dx++) {
                    const i = ((cy * ch + dy) * data.width + (cx * cw + dx)) * 4;
                    sum += data.data[i] * 0.299 + data.data[i + 1] * 0.587 + data.data[i + 2] * 0.114;
                    cnt++;
                }
            }
            cells[cy * 8 + cx] = Math.min(15, cnt > 0 ? Math.round((sum / cnt) / 10.5) : 0);
        }
    }
    return cells;
}

function cellsToHash(cells: Uint8Array): string {
    let h = ""; for (let i = 0; i < 64; i++) h += cells[i].toString(16); return h;
}
function hashDiff(a: Uint8Array, b: Uint8Array): number {
    let d = 0; for (let i = 0; i < 64; i++) d += Math.abs(a[i] - b[i]); return d;
}

// ============================================================
// Read all 28 slots
// ============================================================

export function readSlots(
    img: ImgRef, anchor: BackpackAnchor,
    prevCells: Uint8Array[] = [],
    debug: DebugLog = () => {},
): SlotState[] {
    const slots: SlotState[] = [];
    const first = prevCells.length === 0;
    const curCells: Uint8Array[] = [];
    // Fixed slot interior size — stride only controls spacing, not crop size.
    // RS3 inventory slot interior ≈ 36×32 at 100% interface scaling.
    const sw = 36, sh = 32;

    for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
            const idx = r * COLS + c;
            const sx = anchor.x + c * anchor.colStride;
            const sy = anchor.y + r * anchor.rowStride;
            const cx = Math.max(img.x, sx), cy = Math.max(img.y, sy);
            const cw = Math.max(0, Math.min(sw, img.x + img.width - cx));
            const ch = Math.max(0, Math.min(sh, img.y + img.height - cy));

            let cells: Uint8Array = new Uint8Array(64);
            if (cw > 4 && ch > 4) {
                try { cells = hashSlot(img.toData(cx, cy, cw, ch)) as Uint8Array; } catch { /* keep zero */ }
            }
            curCells.push(cells);

            let ds = 0, chng = false;
            if (!first && prevCells[idx]) {
                ds = hashDiff(cells, prevCells[idx]);
                chng = ds >= CHANGE_THRESHOLD;
            }
            if (first && idx < 4) {
                debug(`slot[${idx}] abs(${sx},${sy}) sz=${cw}x${ch} hash=${cellsToHash(cells).slice(0, 8)}`);
            }
            slots.push({
                index: idx, col: c, row: r,
                x: sx, y: sy, w: cw, h: ch,
                hash: cellsToHash(cells),
                changed: chng, diffScore: ds,
            });
        }
    }
    previousCellData = curCells;
    return slots;
}

let previousCellData: Uint8Array[] = [];

export function scan(img: ImgRef, debug: DebugLog = () => {}): ScanResult {
    const anchor = findBackpack(img, debug);
    const slots = readSlots(img, anchor, previousCellData, debug);
    const changed = slots.filter(s => s.changed);
    if (changed.length > 0) {
        debug(`${changed.length} change(s): ${changed.map(s => `#${s.index + 1}[${s.row},${s.col}] d=${s.diffScore}`).join(" ")}`);
    }
    return { anchor, slots, changes: changed.length, time: Date.now() };
}

export function resetHashes(): void { previousCellData = []; }
