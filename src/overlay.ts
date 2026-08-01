// overlay.ts — RS overlay drawing for Bronzeman Mode
import * as a1lib from "alt1";
import { inventory } from "./inventory";
import type { BackpackAnchor } from "./inventory";
import * as Detect from "./inventory-detect";
import { InventorySlot } from "./inventory-slot";
import { state, captureFullRs, log, showNotification } from "./core";

// ============================================================
// Detection debug — corner brackets on all slots
// ============================================================

export function drawDetectDebug(anc: BackpackAnchor, isError: boolean = false): void {
    if (!state.inAlt1) return;
    alt1.overLayClearGroup("bronzeman_detect");
    alt1.overLaySetGroup("bronzeman_detect");
    const LEN = 8;
    const dur = 2000;
    const magenta = a1lib.mixColor(255, 0, 255);
    const yellow = isError ? a1lib.mixColor(255, 60, 60) : a1lib.mixColor(255, 255, 0);
    const rows = anc.gridRows!;
    const cols = anc.gridCols!;
    const total = cols * rows;
    const lastRowCols = total > 28 ? cols - (total - 28) : cols;
    let idx = 0;
    for (let row = 0; row < rows; row++) {
        const slotCols = (row === rows - 1) ? lastRowCols : cols;
        for (let col = 0; col < slotCols; col++) {
            const slot = new InventorySlot(anc, anc.gridCols!, idx++);
            // Yellow L-brackets on the border
            // TL: right + down
            alt1.overLayRect(yellow, slot.tl.x, slot.tl.y, LEN, 1, dur, 1);
            alt1.overLayRect(yellow, slot.tl.x, slot.tl.y, 1, LEN, dur, 1);
            // TR: left + down
            alt1.overLayRect(yellow, slot.tr.x - LEN + 1, slot.tr.y, LEN, 1, dur, 1);
            alt1.overLayRect(yellow, slot.tr.x, slot.tr.y, 1, LEN, dur, 1);
            // BL: right + up
            alt1.overLayRect(yellow, slot.bl.x, slot.bl.y - LEN + 1, 1, LEN, dur, 1);
            alt1.overLayRect(yellow, slot.bl.x, slot.bl.y, LEN, 1, dur, 1);
            // BR: left + up
            alt1.overLayRect(yellow, slot.br.x - LEN + 1, slot.br.y, LEN, 1, dur, 1);
            alt1.overLayRect(yellow, slot.br.x, slot.br.y - LEN + 1, 1, LEN, dur, 1);
            // Magenta pixel at each corner (on top)
            alt1.overLayRect(magenta, slot.tl.x, slot.tl.y, 1, 1, dur, 1);
            alt1.overLayRect(magenta, slot.tr.x, slot.tr.y, 1, 1, dur, 1);
            alt1.overLayRect(magenta, slot.bl.x, slot.bl.y, 1, 1, dur, 1);
            alt1.overLayRect(magenta, slot.br.x, slot.br.y, 1, 1, dur, 1);
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
    const anc = Detect.detectInventoryGrid(img);
    const ms = Date.now() - t0;

    if (anc && anc.scrollbar) {
        log(`Scrollbar detected at (${anc.x},${anc.y}) — cannot capture`);
        showNotification("Cannot capture inventory, detected scrollbar", 5000, "danger");
        return;
    }

    if (anc) {
        log(`Grid found: ${anc.gridCols}×${anc.gridRows} at (${anc.x},${anc.y}) col=${anc.colStride} row=${anc.rowStride} in ${ms}ms`);

        const cols = anc.gridCols!, rows = anc.gridRows!;
        const total = cols * rows;
        const lastRowCols = total > 28 ? cols - (total - 28) : cols;

        const yc = a1lib.mixColor(255, 255, 0);
        const white = a1lib.mixColor(255, 255, 255);
        const dur = 5000;
        alt1.overLaySetGroup("bronzeman_fingerprint");
        alt1.overLayClearGroup("bronzeman_fingerprint");
        let idx = 0;
        for (let r = 0; r < rows; r++) {
            const slotCols = (r === rows - 1) ? lastRowCols : cols;
            for (let c = 0; c < slotCols; c++) {
                const slot = new InventorySlot(anc, cols, idx++);
                const sw = 38, sh = 34;
                alt1.overLayRect(yc, slot.tl.x, slot.tl.y, sw, 1, dur, 1);
                alt1.overLayRect(yc, slot.tl.x, slot.br.y, sw, 1, dur, 1);
                alt1.overLayRect(yc, slot.tl.x, slot.tl.y, 1, sh, dur, 1);
                alt1.overLayRect(yc, slot.br.x, slot.tl.y, 1, sh, dur, 1);
                alt1.overLayText(String(idx), white, 10, slot.cx - 6, slot.cy - 5, dur);
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
        clearAnchorWatchDot();
    } else {
        drawAnchorWatchDot();
    }
}

// ============================================================
// Anchor-watch dot — green dot on the watched TR pixel
// ============================================================

const ANCHOR_WATCH_GROUP = "bronzeman_anchorwatch";
let anchorWatchFrozen = false;

/** Draw a green dot on the TR border pixel of the top-right slot (the pixel anchor-watch monitors). */
export function drawAnchorWatchDot(): void {
    if (!state.inAlt1 || !showGridBoundary || !inventory.isCalibrated) return;
    const slot = inventory.slots[inventory.getLastColumnFirstRowIndex()];
    if (!slot) return;
    const green = a1lib.mixColor(28, 228, 1);
    alt1.overLaySetGroup(ANCHOR_WATCH_GROUP);
    if (anchorWatchFrozen) { alt1.overLayContinueGroup(ANCHOR_WATCH_GROUP); }
    alt1.overLayClearGroup(ANCHOR_WATCH_GROUP);
    alt1.overLayRect(green, slot.tr.x, slot.tr.y, 1, 1, 0, 1);
    alt1.overLayFreezeGroup(ANCHOR_WATCH_GROUP);
    anchorWatchFrozen = true;
}

export function clearAnchorWatchDot(): void {
    if (!anchorWatchFrozen) return;
    anchorWatchFrozen = false;
    alt1.overLayContinueGroup(ANCHOR_WATCH_GROUP);
    alt1.overLayClearGroup(ANCHOR_WATCH_GROUP);
}

// ============================================================
// Slot hover — yellow square at mouse cursor
// ============================================================

const HOVER_GROUP = "bronzeman_hover";
let lastHoverIndex: number | null = null;
let hoverFrozen = false;

export function drawSlotHover(
    anc: BackpackAnchor,
    slotIndex: number,
): void {
    if (!state.inAlt1 || !showGridBoundary) return;
    if (lastHoverIndex === slotIndex) return;
    lastHoverIndex = slotIndex;

    const slot = new InventorySlot(anc, anc.gridCols!, slotIndex);
    const yellow = a1lib.mixColor(255, 255, 0);

    alt1.overLaySetGroup(HOVER_GROUP);
    if (hoverFrozen) { alt1.overLayContinueGroup(HOVER_GROUP); }
    alt1.overLayClearGroup(HOVER_GROUP);
    alt1.overLayRect(yellow, slot.cx - 6, slot.cy - 6, 12, 12, 0, 1);
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

