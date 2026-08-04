// overlay.ts — RS overlay drawing for Bronzeman Mode
import * as a1lib from "alt1";
import { inventory } from "./inventory";
import * as Detect from "./inventory-detect";
import { Inventory } from "./inventory";
import { InventorySlot } from "./inventory-slot";
import { state, captureFullRs, log, showNotification } from "./core";
import { getAnchorWatchPoints } from "./anchor-watch";
import { SlotLoadingAnimation } from "./slot-animation";
import { SLOT_DOT_X, SLOT_DOT_Y, SLOT_DOT_W, loadGoldDotEncoded } from "./gold-dot";
import { TooltipScanner } from "./tooltip-read";

// ============================================================
// Detection debug — corner brackets on all slots
// ============================================================

export function drawDetectDebug(isError: boolean = false): void {
    // Debug visual — only draw when Inventory debugging is enabled. Drawing
    // brackets over slot corners would pollute the cornerRefs the slot-scan
    // uses for occlusion detection (Alt1 captures include overlays).
    if (!state.inAlt1 || !isGridDebugEnabled() || !inventory.isCalibrated) return;
    alt1.overLayClearGroup("bronzeman_detect");
    alt1.overLaySetGroup("bronzeman_detect");
    const LEN = 8;
    const dur = 2000;
    const yellow = isError ? a1lib.mixColor(255, 60, 60) : a1lib.mixColor(255, 255, 0);
    // Pixels the anchor-watch monitors — we must not paint over them or the
    // watch's reference colors get polluted by the overlay (Alt1 captures
    // include overlays), which would trigger a recalibrate loop. Also skip the
    // TL of the first slot (index 0).
    const watch = new Set(getAnchorWatchPoints().map(p => `${p.x},${p.y}`));
    const first = inventory.getSlot(0);
    if (first) watch.add(`${first.tl.x},${first.tl.y}`);
    const skip = (p: { x: number; y: number }): boolean => watch.has(`${p.x},${p.y}`);
    for (const slot of inventory.slots) {
        // Yellow L-brackets on the border
        // TL: right + down
        if (!skip(slot.tl)) alt1.overLayRect(yellow, slot.tl.x, slot.tl.y, LEN, 1, dur, 1);
        if (!skip(slot.tl)) alt1.overLayRect(yellow, slot.tl.x, slot.tl.y, 1, LEN, dur, 1);
        // TR: left + down
        if (!skip(slot.tr)) alt1.overLayRect(yellow, slot.tr.x - LEN + 1, slot.tr.y, LEN, 1, dur, 1);
        if (!skip(slot.tr)) alt1.overLayRect(yellow, slot.tr.x, slot.tr.y, 1, LEN, dur, 1);
        // BL: right + up
        if (!skip(slot.bl)) alt1.overLayRect(yellow, slot.bl.x, slot.bl.y - LEN + 1, 1, LEN, dur, 1);
        if (!skip(slot.bl)) alt1.overLayRect(yellow, slot.bl.x, slot.bl.y, LEN, 1, dur, 1);
        // BR: left + up
        if (!skip(slot.br)) alt1.overLayRect(yellow, slot.br.x - LEN + 1, slot.br.y, LEN, 1, dur, 1);
        if (!skip(slot.br)) alt1.overLayRect(yellow, slot.br.x, slot.br.y - LEN + 1, 1, LEN, dur, 1);
    }

    // Yellow bounding box around the whole grid — used to verify the region
    // capture bounds. Computed from actual slot cells (covers resized grids
    // with a short last row). Corner pixels are skipped: they are exactly the
    // anchor-watch points + slot 0 TL, which must never be painted over.
    const bounds = inventory.getInventoryBounds();
    if (bounds) {
        alt1.overLayRect(yellow, bounds.x + 1, bounds.y, bounds.w - 2, 1, dur, 1);          // top
        alt1.overLayRect(yellow, bounds.x + 1, bounds.y + bounds.h - 1, bounds.w - 2, 1, dur, 1); // bottom
        alt1.overLayRect(yellow, bounds.x, bounds.y + 1, 1, bounds.h - 2, dur, 1);          // left
        alt1.overLayRect(yellow, bounds.x + bounds.w - 1, bounds.y + 1, 1, bounds.h - 2, dur, 1); // right
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
        const lastRowCols = Inventory.lastRowCols(anc);

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
                const sw = InventorySlot.CELL_W, sh = InventorySlot.CELL_H;
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

/** Re-read the "Inventory debugging" checkbox and update the debug overlays. */
export function updateGridDebug(): void {
    const cb = document.getElementById("show_grid_boundary") as HTMLInputElement;
    showGridBoundary = cb?.checked ?? false;
    log(`updateGridDebug: show=${showGridBoundary} inAlt1=${state.inAlt1}`);
    if (!state.inAlt1) return;
    if (!showGridBoundary) {
        alt1.overLayClearGroup("bronzeman_hover");
        alt1.overLayClearGroup("bronzeman_detect");
        clearAnchorWatchDot();
    } else {
        drawDetectDebug(false);
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

export function drawSlotHover(slotIndex: number): void {
    if (!state.inAlt1 || !showGridBoundary) return;
    if (lastHoverIndex === slotIndex) return;
    lastHoverIndex = slotIndex;

    const slot = inventory.getSlot(slotIndex);
    if (!slot) return;
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

// ============================================================
// Slot animation toggle — "Show slot animation" debug checkbox
// ============================================================

const SLOT_DOT_GROUP = "bronzeman_slotdot";
/** Redraw cadence for the dot — Alt1 overlay elements have a finite lifetime
 *  even when frozen, so the dot is re-drawn with a fresh duration on a timer. */
const SLOT_DOT_INTERVAL_MS = 500;
const SLOT_DOT_DURATION_MS = 1000;

let slotDotTimer: ReturnType<typeof setInterval> | null = null;
let slotDotSlot: InventorySlot | null = null;
let slotDotEncoded: string | null = null;

/** Draw the gold dot at (SLOT_DOT_X, SLOT_DOT_Y) from the slot TL border pixel. */
function drawSlotDotNow(): void {
    if (!slotDotSlot || !slotDotEncoded) return;
    alt1.overLaySetGroup(SLOT_DOT_GROUP);
    alt1.overLayImage(slotDotSlot.x + SLOT_DOT_X, slotDotSlot.y + SLOT_DOT_Y, slotDotEncoded, SLOT_DOT_W, SLOT_DOT_DURATION_MS);
}

/** Show the dot while the checkbox is ticked; keep-alive redraws it so it persists. */
function startSlotDot(slot: InventorySlot): void {
    slotDotSlot = slot;
    void loadGoldDotEncoded().then(encoded => {
        const cb = document.getElementById("show_slot_animation") as HTMLInputElement | null;
        if (!state.inAlt1 || !cb?.checked || slotDotSlot !== slot) return; // toggled off meanwhile
        slotDotEncoded = encoded;
        drawSlotDotNow();
        if (!slotDotTimer) slotDotTimer = setInterval(drawSlotDotNow, SLOT_DOT_INTERVAL_MS);
    }).catch(() => log("Failed to load gold dot image"));
}

function stopSlotDot(): void {
    if (slotDotTimer) { clearInterval(slotDotTimer); slotDotTimer = null; }
    slotDotSlot = null;
    slotDotEncoded = null;
    try {
        alt1.overLaySetGroup(SLOT_DOT_GROUP);
        alt1.overLayClearGroup(SLOT_DOT_GROUP);
    } catch { /* group already gone — nothing to clear */ }
}

let slotAnimation: SlotLoadingAnimation | null = null;

/** Start/stop the loading-ring animation on slot 27's border, driven by the
 *  "Show slot animation" debug checkbox. */
export function toggleSlotAnimation(): void {
    const cb = document.getElementById("show_slot_animation") as HTMLInputElement | null;
    const on = cb?.checked ?? false;
    if (!state.inAlt1) {
        if (on && cb) cb.checked = false; // can't draw outside Alt1 — revert the check
        log("Not in Alt1");
        return;
    }
    if (on) {
        const slot = inventory.getSlot(27);
        if (!slot) {
            if (cb) cb.checked = false;
            log("Slot 27 not available (inventory not calibrated?)");
            return;
        }
        startSlotDot(slot);
        slotAnimation ??= new SlotLoadingAnimation(slot);
        slotAnimation.start();
        log(`Show slot animation: gold loading ring on slot 27 border from TL (${slot.tl.x},${slot.tl.y})`);
    } else {
        slotAnimation?.stop();
        stopSlotDot();
    }
}

// ============================================================
// Tooltip debug toggle — "Show tooltip debug" debug checkbox
// ============================================================

let tooltipScanner: TooltipScanner | null = null;

/** Start/stop the tooltip scanner, driven by the "Show tooltip debug" checkbox. */
export function toggleTooltipDebug(): void {
    const cb = document.getElementById("show_tooltip_debug") as HTMLInputElement | null;
    const on = cb?.checked ?? false;
    if (!state.inAlt1) {
        if (on && cb) cb.checked = false; // can't capture outside Alt1 — revert the check
        log("Not in Alt1");
        return;
    }
    if (on) {
        tooltipScanner ??= new TooltipScanner();
        tooltipScanner.start();
    } else {
        tooltipScanner?.stop();
    }
}


// ============================================================
// GE debug re-export (implemented in ge-debug.ts)
// ============================================================

export { initGeDetection, toggleGeDebugOverlays, stopGeDetection, geIsOpen } from "./ge-debug";
