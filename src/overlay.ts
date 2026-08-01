// overlay.ts — RS overlay drawing for Bronzeman Mode
import * as a1lib from "alt1";
import * as Inventory from "./inventory";
import { state, captureFullRs, log, showNotification } from "./core";

// ============================================================
// Detection debug — corner brackets on all slots
// ============================================================

export function drawDetectDebug(anc: Inventory.BackpackAnchor, isError: boolean = false): void {
    if (!state.inAlt1) return;
    alt1.overLayClearGroup("bronzeman_detect");
    alt1.overLaySetGroup("bronzeman_detect");
    const LEN = 11;
    const dur = 2000;
    const yc = isError ? a1lib.mixColor(255, 60, 60) : a1lib.mixColor(255, 255, 0);
    const rows = anc.gridRows ?? Inventory.ROWS;
    const cols = anc.gridCols ?? Inventory.COLS;
    const total = cols * rows;
    const lastRowCols = total > 28 ? cols - (total - 28) : cols;
    for (let row = 0; row < rows; row++) {
        const slotCols = (row === rows - 1) ? lastRowCols : cols;
        for (let col = 0; col < slotCols; col++) {
            const sx = anc.x + col * anc.colStride;
            const sy = anc.y + row * anc.rowStride;
            const r = sx + 35, b = sy + 31;
            alt1.overLayRect(yc, sx, sy, LEN, 1, dur, 1);
            alt1.overLayRect(yc, sx, sy, 1, LEN, dur, 1);
            alt1.overLayRect(yc, r - LEN + 1, sy, LEN, 1, dur, 1);
            alt1.overLayRect(yc, r, sy, 1, LEN, dur, 1);
            alt1.overLayRect(yc, sx, b, LEN, 1, dur, 1);
            alt1.overLayRect(yc, sx, b - LEN + 1, 1, LEN, dur, 1);
            alt1.overLayRect(yc, r - LEN + 1, b, LEN, 1, dur, 1);
            alt1.overLayRect(yc, r, b - LEN + 1, 1, LEN, dur, 1);
        }
    }
}

// ============================================================
// Fingerprint slot debug — draw numbered grid on RS overlay
// ============================================================

export function debugFindSlot(): void {
    if (!state.inAlt1) { log("Not in Alt1"); return; }
    const img = captureFullRs();
    if (!img) { log("Failed to capture"); return; }

    const t0 = Date.now();
    const anc = Inventory.detectInventoryGrid(img);
    const ms = Date.now() - t0;

    if (anc && anc.scrollbar) {
        log(`Scrollbar detected at (${anc.x},${anc.y}) — cannot capture`);
        showNotification("Cannot capture inventory, detected scrollbar", 5000, "danger");
        return;
    }

    if (anc) {
        log(`Grid found: ${anc.gridCols}×${anc.gridRows} at (${anc.x},${anc.y}) col=${anc.colStride} row=${anc.rowStride} in ${ms}ms`);

        const total = (anc.gridCols ?? 4) * (anc.gridRows ?? 7);
        const lastRowCols = total > 28 ? (anc.gridCols ?? 4) - (total - 28) : (anc.gridCols ?? 4);

        const yc = a1lib.mixColor(255, 255, 0);
        const white = a1lib.mixColor(255, 255, 255);
        const dur = 5000, sh = 34, sw = 38;
        const hitX = anc.x - 1, hitY = anc.y + 32;
        const cols = anc.gridCols ?? 4, rows = anc.gridRows ?? 7;
        alt1.overLaySetGroup("bronzeman_fingerprint");
        alt1.overLayClearGroup("bronzeman_fingerprint");
        let slotNum = 0;
        for (let r = 0; r < rows; r++) {
            const slotCols = (r === rows - 1) ? lastRowCols : cols;
            for (let c = 0; c < slotCols; c++) {
                slotNum++;
                const sx = hitX + c * anc.colStride;
                const sy = hitY - 33 + r * anc.rowStride;
                alt1.overLayRect(yc, sx, sy, sw, 1, dur, 1);
                alt1.overLayRect(yc, sx, sy + sh - 1, sw, 1, dur, 1);
                alt1.overLayRect(yc, sx, sy, 1, sh, dur, 1);
                alt1.overLayRect(yc, sx + sw - 1, sy, 1, sh, dur, 1);
                alt1.overLayText(String(slotNum), white, 10, sx + sw / 2 - 6, sy + sh / 2 - 5, dur);
            }
        }
        log(`Total: ${Date.now() - t0}ms`);
    } else {
        log(`No inventory found in ${ms}ms`);
    }
}

// ============================================================
// Grid boundary overlay toggle
// ============================================================

let showGridBoundary = false;

export function isGridDebugEnabled(): boolean { return showGridBoundary; }

export function updateGridBoundary(): void {
    const cb = document.getElementById("show_grid_boundary") as HTMLInputElement;
    showGridBoundary = cb?.checked ?? false;
    log(`updateGridBoundary: show=${showGridBoundary} inAlt1=${state.inAlt1}`);
    if (!state.inAlt1) return;
    if (!showGridBoundary) {
        alt1.overLayClearGroup("bronzeman_boundary");
        alt1.overLayClearGroup("bronzeman_hover");
    }
}

// ============================================================
// Slot hover — yellow square at mouse cursor
// ============================================================

const HOVER_GROUP = "bronzeman_hover";
let lastHoverIndex: number | null = null;
let hoverFrozen = false;

export function drawSlotHover(
    anc: Inventory.BackpackAnchor,
    slotIndex: number,
): void {
    if (!state.inAlt1 || !showGridBoundary) return;
    if (lastHoverIndex === slotIndex) return;
    lastHoverIndex = slotIndex;

    const c = Inventory.getSlotCenterCoordinates(anc, slotIndex);
    const yellow = a1lib.mixColor(255, 255, 0);

    alt1.overLaySetGroup(HOVER_GROUP);
    if (hoverFrozen) { alt1.overLayContinueGroup(HOVER_GROUP); }
    alt1.overLayClearGroup(HOVER_GROUP);
    alt1.overLayRect(yellow, c.x - 6, c.y - 6, 12, 12, 0, 1);
    alt1.overLayFreezeGroup(HOVER_GROUP);
    hoverFrozen = true;
}

export function clearSlotHover(): void {
    if (lastHoverIndex === null) return;
    lastHoverIndex = null;
    hoverFrozen = false;
    alt1.overLayContinueGroup(HOVER_GROUP);
    alt1.overLayClearGroup(HOVER_GROUP);
}
