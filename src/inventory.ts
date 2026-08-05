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
// Resolve anchor: saved > fallback
// ============================================================

export function findBackpack(img: ImgRef, debug: DebugLog): BackpackAnchor {
    const saved = loadAnchor();
    if (saved) return saved;

    // Fallback: bottom-right area (inventory region)
    const fx = img.width - 260, fy = img.height - 340;
    const fb: BackpackAnchor = {
        x: fx, y: fy,
        method: "fallback",
        colStride: 42, rowStride: 38,
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
