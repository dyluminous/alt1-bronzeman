// overlay.ts — RS overlay drawing for Bronzeman Mode
import * as a1lib from "alt1";
import { inventory } from "./inventory";
import type { BackpackAnchor } from "./inventory";
import * as Detect from "./inventory-detect";
import { Inventory } from "./inventory";
import { InventorySlot } from "./inventory-slot";
import { state, captureFullRs, log, showNotification } from "./core";
import { getAnchorWatchPoints } from "./anchor-watch";

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
// Test slot animation — gold "loading ring" on slot 27's border
// ============================================================

const TEST_ANIM_GROUP = "bronzeman_testanim";
let animTimer: ReturnType<typeof setInterval> | null = null;
let animStart = 0;
/** Cumulative head distance (px) at the last frame — never modded, so the
 *  [prev, cur) tiling stays contiguous across the cycle wrap. */
let animLastPos = 0;

const ANIM_GOLD = (): number => a1lib.mixColor(212, 168, 75); // --rs-gold (#D4A84B)
/** Frame interval — Alt1's practical overlay redraw ceiling is ~30fps. */
const ANIM_STEP_MS = 33;
/** Perimeter of the slot cell border (2×(38+34)). */
const ANIM_PERIMETER = 2 * (InventorySlot.CELL_W + InventorySlot.CELL_H);
/** One full loop: ~3px/frame → 48 frames. */
const ANIM_CYCLE_MS = Math.ceil(ANIM_PERIMETER / 3) * ANIM_STEP_MS;
/** Trail length — a 34px comet tail. */
const ANIM_TAIL_PX = 34;
/** How long a drawn pixel stays visible: the time the head takes to advance ANIM_TAIL_PX.
 *  Oldest pixels expire one-by-one in draw order, keeping the trail at a constant length. */
const ANIM_TAIL_MS = Math.round(ANIM_TAIL_PX / ANIM_PERIMETER * ANIM_CYCLE_MS);
/** The second comet launches when the first is this far in (half a lap), so the
 *  two comets are always 72px apart and circle the slot together. */
const ANIM_COMET_OFFSET = ANIM_PERIMETER / 2;

/** The border edge at perimeter-distance d from TL, going clockwise.
 *  Perimeter is 2×(W+H); corners are counted once at the start of each edge,
 *  so the four corner pixels get double-drawn (harmless overlap). */
function borderEdgeAt(slot: InventorySlot, d: number): { x: number; y: number; dx: number; dy: number; end: number } {
    const W = InventorySlot.CELL_W, H = InventorySlot.CELL_H;
    if (d < W) return { x: slot.x + d, y: slot.y, dx: 1, dy: 0, end: W };                               // TL→TR
    if (d < W + H) return { x: slot.x + W - 1, y: slot.y + d - W, dx: 0, dy: 1, end: W + H };           // TR→BR
    if (d < 2 * W + H) return { x: slot.x + (2 * W + H - 1 - d), y: slot.y + H - 1, dx: -1, dy: 0, end: 2 * W + H }; // BR→BL
    return { x: slot.x, y: slot.y + (ANIM_PERIMETER - 1 - d), dx: 0, dy: -1, end: ANIM_PERIMETER };      // BL→TL
}

/** Draw a 1px segment of length len starting at perimeter-distance d (wraps corners). */
function drawBorderSegment(slot: InventorySlot, d: number, len: number, dur: number): void {
    d = Math.round(d); // overLayRect requires int32 coords — keep all math integral
    let remaining = len;
    while (remaining > 0) {
        const e = borderEdgeAt(slot, d);
        const n = Math.min(remaining, e.end - d);
        const color = ANIM_GOLD();
        if (e.dx === 1) alt1.overLayRect(color, e.x, e.y, n, 1, dur, 1);
        else if (e.dy === 1) alt1.overLayRect(color, e.x, e.y, 1, n, dur, 1);
        else if (e.dx === -1) alt1.overLayRect(color, e.x - n + 1, e.y, n, 1, dur, 1);
        else alt1.overLayRect(color, e.x, e.y - n + 1, 1, n, dur, 1);
        d = (d + n) % ANIM_PERIMETER;
        remaining -= n;
    }
}

/** One frame: draw each comet's segment from its last head position to the current one.
 *  Tiling [prev, cur) keeps each trail contiguous — rounding the endpoints can't
 *  leave 1px gaps the way rounding a fixed 3px step per frame can. */
function slotAnimTick(): void {
    if (!inventory.isCalibrated) return;
    const slot = inventory.getSlot(27);
    if (!slot) return;
    const pos = (Date.now() - animStart) / ANIM_CYCLE_MS * ANIM_PERIMETER;
    const norm = (v: number): number => ((Math.round(v) % ANIM_PERIMETER) + ANIM_PERIMETER) % ANIM_PERIMETER;

    // Comet 1 — always running.
    const start1 = norm(animLastPos);
    const end1 = norm(pos);
    const len1 = (end1 - start1 + ANIM_PERIMETER) % ANIM_PERIMETER;
    if (len1 > 0) drawBorderSegment(slot, start1, len1, ANIM_TAIL_MS);

    // Comet 2 — launches when comet 1 is ANIM_COMET_OFFSET in, then stays exactly
    // one offset behind it forever (clamped to 0 so nothing draws before launch).
    const pos2 = Math.max(0, pos - ANIM_COMET_OFFSET);
    const lastPos2 = Math.max(0, animLastPos - ANIM_COMET_OFFSET);
    const start2 = norm(lastPos2);
    const end2 = norm(pos2);
    const len2 = (end2 - start2 + ANIM_PERIMETER) % ANIM_PERIMETER;
    if (len2 > 0) drawBorderSegment(slot, start2, len2, ANIM_TAIL_MS);

    animLastPos = pos;
}

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
    if (on) startSlotAnimation();
    else stopSlotAnimation();
}

function startSlotAnimation(): void {
    const slot = inventory.getSlot(27);
    if (!slot) { log("Slot 27 not available (inventory not calibrated?)"); return; }
    alt1.overLaySetGroup(TEST_ANIM_GROUP);
    animStart = Date.now();
    animLastPos = 0;
    log(`Show slot animation: gold loading ring on slot 27 border from TL (${slot.tl.x},${slot.tl.y})`);
    slotAnimTick();
    animTimer = setInterval(slotAnimTick, ANIM_STEP_MS);
}

/** Stop the animation. Already-drawn segments are left to fade out naturally
 *  (they carry a finite duration), rather than force-clearing the group. */
function stopSlotAnimation(): void {
    if (animTimer) { clearInterval(animTimer); animTimer = null; }
}


