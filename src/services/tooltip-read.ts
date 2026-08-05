// tooltip-read.ts — RS tooltip border scan + OCR for item names
import * as a1lib from "alt1";
import type { ImgRef } from "alt1";
import * as OCR from "alt1/ocr";
import { captureFullRs, log } from "../core";
import type { TooltipHit, TooltipRun, TooltipVerticalRun, TooltipMeasure } from "../types";
import { RS_GOLD, RS_GREEN, OVERLAY_MAGENTA } from "../utils/colors";

const tooltipFont = require("alt1/fonts/chatbox/14pt");

// Patch the font: the 'l' glyph's AA pixel at (2,3) expects the dark tooltip
// background, but when 'l' is followed by 't' the crossbar's anti-aliased edge
// lands on it (e.g. "bolts" → misread as "boits"). Dropping that one pixel
// leaves 'l' matching on its distinctive 11px full-gold column instead.
const lGlyph = tooltipFont.chars.find((c: { chr: string }) => c.chr === "l");
if (lGlyph) {
    const px: number[] = [];
    for (let a = 0; a < lGlyph.pixels.length; a += 4) {
        if (!(lGlyph.pixels[a] === 2 && lGlyph.pixels[a + 1] === 3)) {
            px.push(lGlyph.pixels[a], lGlyph.pixels[a + 1], lGlyph.pixels[a + 2], lGlyph.pixels[a + 3]);
        }
    }
    lGlyph.pixels = px;
    log("OCR font patched: removed 'l' AA pixel (2,3) (t-crossbar collision)");
}

// ============================================================
// Constants
// ============================================================

/** Tooltip border outer edge colour (#2E251A). Also the first entry in
 *  BORDER_GRADIENT — both must agree. */
const TOOLTIP_BORDER_OUTER: [number, number, number] = [0x2e, 0x25, 0x1a];
/** The tooltip border is a 4-pixel gradient, outer → inner:
 *  #2e251a, #665a3a, #59482e, #33281d (verified against tooltip_example.png).
 *  A lone #2e251a pixel could be any UI element — only the full sequence
 *  proves we're on the tooltip border. */
const BORDER_GRADIENT: readonly (readonly [number, number, number])[] = [
    [0x2e, 0x25, 0x1a],
    [0x66, 0x5a, 0x3a],
    [0x59, 0x48, 0x2e],
    [0x33, 0x28, 0x1d],
];
/** Per-channel tolerance for the inner border pixels — the gold frame rows
 *  have anti-aliased shade variants (#695d3d, #6d6141, #706444) at gap
 *  positions. The outer #2e251a edge stays exact. */
const BORDER_TOL = 10;
/** Polling cadence while the debug checkbox is on. */
const SCAN_INTERVAL_MS = 100;
/** Max pixels searched from the cursor in each direction. */
const MAX_DIST = 40;
/** Shade tolerance for the width run — the corner pixel is one shade lighter. */
const RUN_TOL = 1;
/** The border run sits 3px inside the tooltip's outer bounds on every side. */
const BOX_OFFSET = 3;
/** How long the debug box stays on screen. */
const BOX_DURATION_MS = 4000;
/** Shrink the drawn box by this inset on each side (TL +4, BR −4). */
const BOX_INSET = 4;
/** Pause between successful hits before the scan starts over. */
const COOLDOWN_MS = 2000;

/** Tooltip OCR colours — gold item-name text, cyan secondary text. */
const TOOLTIP_OCR_GOLD: OCR.ColortTriplet[] = [[248, 213, 107]]; // #F8D56B
const TOOLTIP_OCR_CYAN: OCR.ColortTriplet[] = [[184, 209, 209]]; // #B8D1D1

// ============================================================
// Helpers
// ============================================================

/** Draw a 1px-thick hollow rectangle — DRY courtesy for the gold & green boxes. */
function drawBox(color: number, x: number, y: number, w: number, h: number, dur: number): void {
    alt1.overLayRect(color, x, y, w, 1, dur, 1);
    alt1.overLayRect(color, x, y + h - 1, w, 1, dur, 1);
    alt1.overLayRect(color, x, y, 1, h, dur, 1);
    alt1.overLayRect(color, x + w - 1, y, 1, h, dur, 1);
}

/** True when the pixel at (x, y) is within tol (per channel) of the tooltip color.
 *  tol=0 is exact; the width run uses tol=1 so the slightly-lighter corner pixel counts. */
function isTooltipColor(img: ImgRef, x: number, y: number, tol = 0): boolean {
    const d = img.toData(x, y, 1, 1);
    if (!d) return false;
    return Math.abs(d.data[0] - TOOLTIP_BORDER_OUTER[0]) <= tol
        && Math.abs(d.data[1] - TOOLTIP_BORDER_OUTER[1]) <= tol
        && Math.abs(d.data[2] - TOOLTIP_BORDER_OUTER[2]) <= tol;
}

/** True when the pixel at (x, y) is the tooltip border's outer #2e251a edge,
 *  i.e. the full 4-pixel gradient follows it in the walk direction. The outer
 *  edge is an exact match; the inner pixels tolerate anti-aliased shades. */
function isTooltipBorder(img: ImgRef, x: number, y: number, dir: "down" | "up"): boolean {
    const dy = dir === "down" ? 1 : -1;
    for (let i = 1; i < BORDER_GRADIENT.length; i++) {
        const d = img.toData(x, y + dy * i, 1, 1);
        if (!d) return false;
        const g = BORDER_GRADIENT[i];
        if (Math.abs(d.data[0] - g[0]) > BORDER_TOL
            || Math.abs(d.data[1] - g[1]) > BORDER_TOL
            || Math.abs(d.data[2] - g[2]) > BORDER_TOL) return false;
    }
    return true;
}

/** Strip common RS3 action prefixes from tooltip text to get the item name. */
export function extractItemName(raw: string): string {
    if (!raw) return "";
    const t = raw.trim();
    const actions = [
        "Use", "Wield", "Equip", "Wear", "Eat", "Drink", "Drop", "Examine",
        "Bury", "Clean", "Empty", "Fill", "Light", "String", "Craft", "Fletch",
        "Open", "Close", "Read", "Teleport", "Cast", "Rub", "Activate",
        "Deactivate", "Check", "Mix", "Grind", "Cook", "Smelt", "Smith",
        "Enchant", "Charge", "Alch", "Disassemble", "Augment", "Siphon",
        "Dissolve", "Take", "Remove", "Withdraw", "Deposit", "Store",
        "Release", "Toggle", "Configure", "Convert", "Combine",
    ];
    for (const act of actions) {
        if (t.startsWith(act + " ")) return t.substring(act.length + 1).trim();
    }
    return t;
}

// ============================================================
// Standalone tooltip reader — used by both the debug scanner and the
// gold-dot hover path to OCR an item name from the tooltip at the cursor.
// ============================================================



/** Walk ±MAX_DIST from the cursor along the X column: down first, then up.
 *  The walk is clamped to the RS window edges (the capture is full-window). */
function walkToColor(img: ImgRef): TooltipHit | null {
    const m = a1lib.getMousePosition();
    if (!m) return null;
    const x = m.x, y0 = m.y;
    const yMax = img.y + img.height - 1;
    for (let y = y0; y <= Math.min(y0 + MAX_DIST, yMax); y++) {
        if (isTooltipColor(img, x, y) && isTooltipBorder(img, x, y, "down")) {
            return { x, y, dist: y - y0, dir: "down" };
        }
    }
    for (let y = y0 - 1; y >= Math.max(y0 - MAX_DIST, img.y); y--) {
        if (isTooltipColor(img, x, y) && isTooltipBorder(img, x, y, "up")) {
            return { x, y, dist: y0 - y, dir: "up" };
        }
    }
    return null;
}

/** Horizontal run of tooltip-colored pixels through (x, y) with a small shade
 *  tolerance so the slightly-lighter corner pixel counts. */
function measureRun(img: ImgRef, x: number, y: number): TooltipRun {
    let leftX = x, rightX = x;
    while (isTooltipColor(img, leftX - 1, y, RUN_TOL)) leftX--;
    while (isTooltipColor(img, rightX + 1, y, RUN_TOL)) rightX++;
    return { width: rightX - leftX + 1, leftX };
}

/** Locate the left border near the run's left end and travel along it to
 *  measure the tooltip's vertical run. */
function measureHeight(img: ImgRef, runLeftX: number, y: number, dir: "down" | "up"): TooltipVerticalRun {
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
            if (h > 1) return { startX: ax, startY: ay, height: h };
        }
    }
    return { startX: 0, startY: 0, height: 0 };
}

/** Walk down from (x, y+1) to the next #2E251A pixel, capped at limit.
 *  Returns the number of steps walked (the item-name section height). */
function measureItemSection(img: ImgRef, x: number, y: number, limit: number): number {
    let steps = 0;
    for (let yy = y + 1; yy <= y + limit; yy++) {
        steps++;
        if (isTooltipColor(img, x, yy)) break;
    }
    return steps;
}

/** OCR the item name from a region of the image bounded by a green box. */
function ocrItemName(img: ImgRef, x: number, y: number, w: number, h: number): string {
    if (h <= 0 || w <= 20) return "";
    try {
        const fullBuf = img.toData();
        if (!fullBuf) return "";
        const colors: OCR.ColortTriplet[] = [...TOOLTIP_OCR_GOLD, ...TOOLTIP_OCR_CYAN];
        const ocrLine = (cy: number, ch: number): string => {
            const result = OCR.findReadLine(fullBuf, tooltipFont, colors, x, cy, w, ch);
            return result?.text?.length > 1 ? result.text : "";
        };
        const halfH = Math.round(h / 2);
        const line1 = ocrLine(y + Math.round(h / 4), halfH);
        const line2 = ocrLine(y + Math.round(h * 3 / 4), halfH);
        const raw = (line1 + " " + line2).trim();
        return raw ? extractItemName(raw) : "";
    } catch (e) {
        return "";
    }
}

/** Capture the screen and run the full tooltip measurement pipeline: walk to
 *  the border, measure width + height, compute the boxes and the item-name
 *  section height. Returns null when no tooltip is found. */
function measureTooltip(): TooltipMeasure | null {
    const img = captureFullRs();
    if (!img) return null;
    const hit = walkToColor(img);
    if (!hit) return null;
    const run = measureRun(img, hit.x, hit.y);
    const vrun = measureHeight(img, run.leftX, hit.y, hit.dir);
    if (vrun.height === 0) return null;
    const boxX = vrun.startX;
    const boxY = hit.dir === "down"
        ? vrun.startY - BOX_OFFSET
        : vrun.startY - vrun.height + 1 - BOX_OFFSET;
    const boxW = run.width + 2 * BOX_OFFSET;
    const boxH = vrun.height + 2 * BOX_OFFSET;
    const inX = boxX + BOX_INSET;
    const inY = boxY + BOX_INSET;
    const inW = boxW - 2 * BOX_INSET;
    const inH = boxH - 2 * BOX_INSET;
    const midX = inX + Math.floor(inW / 2);
    const midY = inY;
    const itemSectionH = measureItemSection(img, midX, midY, vrun.height);
    return { img, hit, run, vrun, boxX, boxY, boxW, boxH, inX, inY, inW, inH, midX, midY, itemSectionH };
}

/** Capture the screen, locate the tooltip at the cursor, and OCR the item name.
 *  Returns the measured geometry plus the name, or null when the tooltip
 *  can't be found/read. */
function measureAndRead(): { name: string; m: TooltipMeasure } | null {
    const m = measureTooltip();
    if (!m) return null;
    const name = ocrItemName(m.img, m.inX, m.inY, m.inW, m.itemSectionH);
    if (!name) return null;
    return { name, m };
}

/** Capture the screen, locate the tooltip at the cursor, and OCR the item name.
 *  Returns the item name or null when the tooltip can't be found/read. */
export function readTooltipItemName(): string | null {
    return measureAndRead()?.name ?? null;
}

// ============================================================
// TooltipScanner — the debug scan engine (draws overlay boxes)
// ============================================================

export class TooltipScanner {
    private static readonly GROUP = "bronzeman_tooltipbox";

    private timer: ReturnType<typeof setInterval> | null = null;
    /** No scans fire before this time (epoch ms) — cooldown after each hit. */
    private nextScanAt = 0;

    get running(): boolean { return this.timer !== null; }

    /** Start the scan loop. */
    start(): void {
        if (this.timer) return;
        log("Tooltip debug: scanning within 40px of cursor for #2e251a...");
        this.nextScanAt = 0;
        this.tick();
        this.timer = setInterval(() => this.tick(), SCAN_INTERVAL_MS);
    }

    /** Stop the scan loop. */
    stop(): void {
        if (this.timer) { clearInterval(this.timer); this.timer = null; }
    }

    // ----------------------------------------------------------
    // Per-tick pipeline
    // ----------------------------------------------------------

    private tick(): void {
        if (Date.now() < this.nextScanAt) return; // cooldown
        // Clear previous boxes so the capture is clean (Alt1 includes overlays).
        alt1.overLaySetGroup(TooltipScanner.GROUP);
        alt1.overLayClearGroup(TooltipScanner.GROUP);

        // Single capture: measure once, reuse the geometry for both the OCR
        // and the debug boxes (no double capture, no frame-skew between them).
        const result = measureAndRead();
        if (!result) return;
        const { name: itemName, m } = result;

        const gold = RS_GOLD;
        const green = RS_GREEN;
        const magenta = OVERLAY_MAGENTA;

        alt1.overLaySetGroup(TooltipScanner.GROUP);
        alt1.overLayClearGroup(TooltipScanner.GROUP);
        drawBox(gold, m.inX, m.inY, m.inW, m.inH, BOX_DURATION_MS);
        drawBox(green, m.inX, m.inY, m.inW, m.itemSectionH, BOX_DURATION_MS);
        alt1.overLayRect(magenta, m.midX, m.midY, 1, 1, BOX_DURATION_MS, 1);

        log(`Tooltip debug: #2e251a ${m.hit.dist}px ${m.hit.dir} of cursor, tooltip width ${m.run.width}px, tooltip height ${m.vrun.height}px, item name section height ${m.itemSectionH}px, item name "${itemName}"`);

        this.nextScanAt = Date.now() + COOLDOWN_MS;
    }
}
