// overlay.ts — RS overlay drawing for Bronzeman Mode
import * as a1lib from "alt1";
import type { ImgRef } from "alt1";
import { inventory } from "./inventory";
import * as Detect from "./inventory-detect";
import { Inventory } from "./inventory";
import { InventorySlot } from "./inventory-slot";
import { state, captureFullRs, log, showNotification } from "./core";
import { getAnchorWatchPoints } from "./anchor-watch";
import { SlotBorderAnimation } from "./slot-animation";
import goldDot from "./assets/images/gold_dot.png";

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
// Slot animation toggle — "Show slot animation" debug checkbox
// ============================================================

const SLOT_DOT_GROUP = "bronzeman_slotdot";
/** Redraw cadence for the dot — Alt1 overlay elements have a finite lifetime
 *  even when frozen, so the dot is re-drawn with a fresh duration on a timer. */
const SLOT_DOT_INTERVAL_MS = 500;
const SLOT_DOT_DURATION_MS = 1000;
/** Dot position on the slot, relative to the TL border pixel (0,0). */
const SLOT_DOT_X = 26;
const SLOT_DOT_Y = 2;
/** gold_dot.png is 10×10. */
const SLOT_DOT_W = 10;

let slotDotTimer: ReturnType<typeof setInterval> | null = null;
let slotDotSlot: InventorySlot | null = null;
let slotDotEncoded: string | null = null;
let goldDotPromise: Promise<string> | null = null;

/** Load gold_dot.png once and return its encoded overlay-image string. */
function loadGoldDotEncoded(): Promise<string> {
    if (!goldDotPromise) {
        goldDotPromise = new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const cv = document.createElement("canvas");
                cv.width = img.width;
                cv.height = img.height;
                const ctx = cv.getContext("2d");
                if (!ctx) { reject(new Error("no 2d context")); return; }
                ctx.drawImage(img, 0, 0);
                resolve(a1lib.encodeImageString(ctx.getImageData(0, 0, img.width, img.height)));
            };
            img.onerror = () => reject(new Error("failed to load gold_dot.png"));
            img.src = goldDot;
        });
    }
    return goldDotPromise;
}

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
    });
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

let slotAnimation: SlotBorderAnimation | null = null;

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
        slotAnimation ??= new SlotBorderAnimation(slot);
        slotAnimation.start();
        log(`Show slot animation: gold loading ring on slot 27 border from TL (${slot.tl.x},${slot.tl.y})`);
    } else {
        slotAnimation?.stop();
        stopSlotDot();
    }
}

// ============================================================
// Tooltip debug — search ±30px from the cursor for #2e251a
// ============================================================

/** Tooltip border color being searched for (#2e251a). */
const TOOLTIP_COLOR: [number, number, number] = [0x2e, 0x25, 0x1a];
const TOOLTIP_SCAN_INTERVAL_MS = 100;
/** Max pixels searched from the cursor in each direction. */
const TOOLTIP_MAX_DIST = 30;
/** Shade tolerance for the width run — the corner pixel is one shade lighter. */
const TOOLTIP_RUN_TOL = 1;
/** The border run sits 3px inside the tooltip's outer bounds on every side. */
const TOOLTIP_BOX_OFFSET = 3;
/** How long the debug box stays on screen. */
const TOOLTIP_BOX_DURATION_MS = 4000;
/** Shrink the debug box by this inset on each side (TL +4, BR −4). */
const TOOLTIP_BOX_INSET = 4;
/** Pause between successful hits before the scan starts over. */
const TOOLTIP_COOLDOWN_MS = 2000;

let tooltipScanTimer: ReturnType<typeof setInterval> | null = null;
/** No new scans before this time (epoch ms) — pauses after a hit. */
let tooltipNextScanAt = 0;

/** True when the pixel at (x, y) is within tol (per channel) of the tooltip color.
 *  tol=0 is an exact match; the width run uses a small tol so the corner pixel
 *  (one shade lighter) counts, while clearly different colors still stop it. */
function isTooltipColor(img: ImgRef, x: number, y: number, tol = 0): boolean {
    const d = img.toData(x, y, 1, 1);
    if (!d) return false;
    return Math.abs(d.data[0] - TOOLTIP_COLOR[0]) <= tol
        && Math.abs(d.data[1] - TOOLTIP_COLOR[1]) <= tol
        && Math.abs(d.data[2] - TOOLTIP_COLOR[2]) <= tol;
}

/** Search up to TOOLTIP_MAX_DIST px straight down (+Y), then up (-Y), from the
 *  cursor at cursor.x. Returns the found pixel + distance/direction, or null. */
function walkToTooltipColor(img: ImgRef): { x: number; y: number; dist: number; dir: "down" | "up" } | null {
    const m = a1lib.getMousePosition();
    if (!m) return null;
    const x = m.x, y0 = m.y;
    for (let y = y0; y <= y0 + TOOLTIP_MAX_DIST; y++) {
        if (isTooltipColor(img, x, y)) return { x, y, dist: y - y0, dir: "down" };
    }
    for (let y = y0 - 1; y >= y0 - TOOLTIP_MAX_DIST; y--) {
        if (isTooltipColor(img, x, y)) return { x, y, dist: y0 - y, dir: "up" };
    }
    return null;
}

/** Horizontal run of tooltip-colored pixels through (x, y): its width and leftmost x.
 *  Uses a small shade tolerance so the slightly-lighter corner pixel counts. */
function tooltipLineRun(img: ImgRef, x: number, y: number): { width: number; leftX: number } {
    let leftX = x, rightX = x;
    while (isTooltipColor(img, leftX - 1, y, TOOLTIP_RUN_TOL)) leftX--;
    while (isTooltipColor(img, rightX + 1, y, TOOLTIP_RUN_TOL)) rightX++;
    return { width: rightX - leftX + 1, leftX };
}

/** Locate the left border near the run's left end and travel along it — down when
 *  the found line is the top border (tooltip below the mouse), up when it's the
 *  bottom border. The border column is 3px left of the run's leftmost pixel; its
 *  vertical position is 3px below the found line for a top border, 3px above for
 *  a bottom border. Returns the vertical run's start pixel and its length, or
 *  height 0 when the border can't be found. */
function tooltipHeight(img: ImgRef, runLeftX: number, y: number, dir: "down" | "up"): { startX: number; startY: number; height: number } {
    // Vertical window: below the found line for dir=down, above it for dir=up.
    const dyLo = dir === "down" ? 2 : -4;
    const dyHi = dir === "down" ? 4 : -2;
    for (let dx = 3; dx <= 5; dx++) {
        for (let dy = dyLo; dy <= dyHi; dy++) {
            const ax = runLeftX - dx, ay = y + dy;
            if (!isTooltipColor(img, ax, ay)) continue;
            let h = 0;
            if (dir === "down") {
                for (let yy = ay; isTooltipColor(img, ax, yy); yy++) h++;
            } else {
                for (let yy = ay; isTooltipColor(img, ax, yy); yy--) h++;
            }
            if (h > 1) return { startX: ax, startY: ay, height: h }; // a real vertical run
        }
    }
    return { startX: 0, startY: 0, height: 0 };
}

function tooltipScanTick(): void {
    if (Date.now() < tooltipNextScanAt) return; // cooling down after the last hit
    const img = captureFullRs();
    if (!img) return;
    const hit = walkToTooltipColor(img);
    if (hit) {
        const run = tooltipLineRun(img, hit.x, hit.y);
        const t = tooltipHeight(img, run.leftX, hit.y, hit.dir);
        let itemNameSectionHeight = 0;
        if (t.height > 0) {
            // Tooltip bounds are the border run padded by TOOLTIP_BOX_OFFSET on all sides.
            const boxX = t.startX;
            const boxY = hit.dir === "down"
                ? t.startY - TOOLTIP_BOX_OFFSET
                : t.startY - t.height + 1 - TOOLTIP_BOX_OFFSET;
            const boxW = run.width + 2 * TOOLTIP_BOX_OFFSET;
            const boxH = t.height + 2 * TOOLTIP_BOX_OFFSET;
            // Inset the drawn box by TOOLTIP_BOX_INSET on all sides (TL +4, BR −4).
            const inX = boxX + TOOLTIP_BOX_INSET;
            const inY = boxY + TOOLTIP_BOX_INSET;
            const inW = boxW - 2 * TOOLTIP_BOX_INSET;
            const inH = boxH - 2 * TOOLTIP_BOX_INSET;
            const gold = a1lib.mixColor(212, 168, 75);
            alt1.overLaySetGroup("bronzeman_tooltipbox");
            alt1.overLayClearGroup("bronzeman_tooltipbox");
            alt1.overLayRect(gold, inX, inY, inW, 1, TOOLTIP_BOX_DURATION_MS, 1);
            alt1.overLayRect(gold, inX, inY + inH - 1, inW, 1, TOOLTIP_BOX_DURATION_MS, 1);
            alt1.overLayRect(gold, inX, inY, 1, inH, TOOLTIP_BOX_DURATION_MS, 1);
            alt1.overLayRect(gold, inX + inW - 1, inY, 1, inH, TOOLTIP_BOX_DURATION_MS, 1);
            // Magenta marker at the centre of the inset box's top border.
            const midX = inX + Math.floor(inW / 2);
            const midY = inY;
            // Item-name section: walk down from the magenta point to the next #2E251A
            // pixel, capped at the tooltip height.
            for (let yy = midY + 1; yy <= midY + t.height; yy++) {
                itemNameSectionHeight++;
                if (isTooltipColor(img, midX, yy)) break;
            }
            // Green box: same origin and width as the gold box, height = item-name section.
            const green = a1lib.mixColor(28, 228, 1); // rs green #1CE401
            alt1.overLayRect(green, inX, inY, inW, 1, TOOLTIP_BOX_DURATION_MS, 1);
            alt1.overLayRect(green, inX, inY + itemNameSectionHeight - 1, inW, 1, TOOLTIP_BOX_DURATION_MS, 1);
            alt1.overLayRect(green, inX, inY, 1, itemNameSectionHeight, TOOLTIP_BOX_DURATION_MS, 1);
            alt1.overLayRect(green, inX + inW - 1, inY, 1, itemNameSectionHeight, TOOLTIP_BOX_DURATION_MS, 1);
            // Magenta last → stays on top of both boxes.
            alt1.overLayRect(a1lib.mixColor(255, 0, 255), midX, midY, 1, 1, TOOLTIP_BOX_DURATION_MS, 1);
        }
        log(`Tooltip debug: #2e251a ${hit.dist}px ${hit.dir} of cursor, tooltip width ${run.width}px, tooltip height ${t.height}px, item name section height ${itemNameSectionHeight}px`);
        tooltipNextScanAt = Date.now() + TOOLTIP_COOLDOWN_MS; // pause, then start over
    }
}

/** Start/stop the tooltip debug scan, driven by the "Show tooltip debug" checkbox. */
export function toggleTooltipDebug(): void {
    const cb = document.getElementById("show_tooltip_debug") as HTMLInputElement | null;
    const on = cb?.checked ?? false;
    if (!state.inAlt1) {
        if (on && cb) cb.checked = false; // can't capture outside Alt1 — revert the check
        log("Not in Alt1");
        return;
    }
    if (on) {
        log("Tooltip debug: scanning within 30px of cursor for #2e251a...");
        tooltipNextScanAt = 0;
        tooltipScanTick(); // try immediately, then poll while the tooltip shows
        if (!tooltipScanTimer) tooltipScanTimer = setInterval(tooltipScanTick, TOOLTIP_SCAN_INTERVAL_MS);
    } else {
        if (tooltipScanTimer) { clearInterval(tooltipScanTimer); tooltipScanTimer = null; }
    }
}


