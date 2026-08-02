// slot-scan.ts — monitors inventory slot contents for changes.
// Each tick: one region capture; per slot, the 4 border corners must still match
// their calibration refs (else a tooltip/menu is covering it) and the slot must
// not be under or adjacent to the cursor. Clean slots are hashed and compared
// against the slot's previousHash to detect appeared / removed / changed / moved.
import * as a1lib from "alt1";
import { inventory } from "./inventory";
import { captureFullRs, log, lightness } from "./core";
import type { ImgRef } from "alt1/base";
import { InventorySlot } from "./inventory-slot";
import { isHashUnlocked } from "./data";

const SCAN_MS = 500;
/** Sentinel previousHash for an empty slot. */
const EMPTY_HASH = "empty";

/** Noted-item marker, relative to the slot TL border corner (0,0): a #95865e
 *  pixel at (12,1) beside a #000002 shadow pixel at (13,1). Both must match. */
const NOTED_MARK: [number, number, number] = [0x95, 0x86, 0x5e];
const NOTED_SHADOW: [number, number, number] = [0x00, 0x00, 0x02];
const NOTED_MARK_X = 12;
const NOTED_MARK_Y = 1;
const NOTED_SHADOW_X = 13;

let scanHandle: ReturnType<typeof setInterval> | null = null;

/** Slots whose current interior hash is not in the unlocked set. */
let nonUnlockedSlots: Set<number> = new Set();
/** Slots that were skipped by the noted/Use gate in the previous tick. */
let prevExcluded: Set<number> = new Set();

export function getNonUnlockedSlotIndices(): Set<number> {
    return nonUnlockedSlots;
}

// ============================================================
// Low-level reads from a captured image
// ============================================================

/** Read one RGB pixel from an image, or null when unavailable. */
function readPixel(img: ImgRef, x: number, y: number): [number, number, number] | null {
    const d = img.toData(x, y, 1, 1);
    return d ? [d.data[0], d.data[1], d.data[2]] : null;
}

/** Read a slot's interior (36×32, inside the 1px border) from an image, or null. */
function readInterior(slot: InventorySlot, img: ImgRef): Uint8ClampedArray | null {
    const d = img.toData(slot.interiorX, slot.interiorY, InventorySlot.INTERIOR_W, InventorySlot.INTERIOR_H);
    return d ? d.data : null;
}

/** Average lightness of an interior buffer, or -1 when empty. */
function interiorLightness(data: Uint8ClampedArray): number {
    if (!data || data.length === 0) return -1;
    let sum = 0, cnt = 0;
    for (let i = 0; i < data.length; i += 4) {
        sum += lightness(data[i], data[i + 1], data[i + 2]);
        cnt++;
    }
    return cnt > 0 ? Math.round((sum / cnt) * 10) / 10 : -1;
}

// ============================================================
// Baseline — fill cornerRefs from a fresh capture (once per calibrate)
// ============================================================

export function captureCornerRefs(img: ImgRef): void {
    for (const slot of inventory.slots) {
        slot.cornerRefs = slot.corners.map(c => readPixel(img, c.x, c.y) ?? [0, 0, 0]);
        slot.previousHash = null;
        slot.lastValidPixels = null;
    }
}

// ============================================================
// Per-slot checks
// ============================================================

/** True when the corner pixel exactly matches its calibration ref. */
function cornerMatches(corner: [number, number, number], ref: [number, number, number]): boolean {
    return corner[0] === ref[0] && corner[1] === ref[1] && corner[2] === ref[2];
}

/** True when the slot holds a noted item — the #95865e mark + #000002 shadow
 *  beside it. Noted items are ignored completely (no gold dot, no tracking). */
export function isNotedItem(slot: InventorySlot, img: ImgRef): boolean {
    const mark = readPixel(img, slot.x + NOTED_MARK_X, slot.y + NOTED_MARK_Y);
    const shadow = readPixel(img, slot.x + NOTED_SHADOW_X, slot.y + NOTED_MARK_Y);
    return !!mark && !!shadow
        && mark[0] === NOTED_MARK[0] && mark[1] === NOTED_MARK[1] && mark[2] === NOTED_MARK[2]
        && shadow[0] === NOTED_SHADOW[0] && shadow[1] === NOTED_SHADOW[1] && shadow[2] === NOTED_SHADOW[2];
}

/** True when the item is in "Use" state — the white outline replaces the
 *  item shadow. Captures the 38×34 cell once, then scans the buffer BR→BL
 *  upward for a #FFFFFF pixel surrounded on all 4 sides by shadow. */
export function isInUseState(slot: InventorySlot, img: ImgRef): boolean {
    const W = InventorySlot.CELL_W;
    const H = InventorySlot.CELL_H;
    const buf = img.toData(slot.x, slot.y, W, H);
    if (!buf) return false;
    const d = buf.data;
    const stride = W * 4;
    const shadow = (i: number): boolean =>
        d[i] === 0 && d[i + 1] === 0 && (d[i + 2] === 1 || d[i + 2] === 2);
    for (let y = H - 1; y >= 0; y--) {
        const row = y * stride;
        for (let x = W - 1; x >= 0; x--) {
            const i = row + x * 4;
            if (d[i] !== 255 || d[i + 1] !== 255 || d[i + 2] !== 255) continue;
            if (y > 0 && shadow(i - stride)
                && y < H - 1 && shadow(i + stride)
                && x > 0 && shadow(i - 4)
                && x < W - 1 && shadow(i + 4)) {
                return true;
            }
        }
    }
    return false;
}

/** True when any corner no longer matches its calibration ref (slot is covered). */
function isCovered(slot: InventorySlot, img: ImgRef): boolean {
    if (slot.cornerRefs.length !== 4) return true;
    return slot.corners.some((c, i) => {
        const live = readPixel(img, c.x, c.y);
        return !live || !cornerMatches(live, slot.cornerRefs[i]);
    });
}

/** True when the interior has no item shadow pixels (#000001 or #000002).
 *  Every RS item has a 1px drop shadow; empty brown slots never do. */
function isSlotEmpty(data: Uint8ClampedArray): boolean {
    for (let i = 0; i < data.length; i += 4) {
        if (data[i] === 0 && data[i + 1] === 0 && (data[i + 2] === 1 || data[i + 2] === 2)) return false;
    }
    return true;
}

/** 8×8 cells, 4-bit brightness → 64-char hex. */
function hashInterior(data: Uint8ClampedArray): string {
    const W = InventorySlot.INTERIOR_W, H = InventorySlot.INTERIOR_H;
    const cw = Math.max(1, Math.floor(W / 8));
    const ch = Math.max(1, Math.floor(H / 8));
    let h = "";
    for (let cy = 0; cy < 8; cy++) {
        for (let cx = 0; cx < 8; cx++) {
            let sum = 0, cnt = 0;
            for (let dy = 0; dy < ch; dy++) {
                for (let dx = 0; dx < cw; dx++) {
                    const px = cx * cw + dx, py = cy * ch + dy;
                    if (px >= W || py >= H) continue;
                    const i = (py * W + px) * 4;
                    sum += data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
                    cnt++;
                }
            }
            h += Math.min(15, cnt > 0 ? Math.round((sum / cnt) / 10.5) : 0).toString(16);
        }
    }
    return h;
}

/** Slots the scan must not read: covered (corner mismatch) or under/adjacent to the
 *  cursor. Their previousHash is left untouched so no false change is recorded. */
export function getObscuredSlotIndices(img: ImgRef): Set<number> {
    const obscured = new Set<number>();
    const hovered = inventory.getHoveredSlotIndex();
    if (hovered !== null) {
        obscured.add(hovered);
        for (const a of inventory.getAdjacentSlotIndices(hovered)) obscured.add(a);
    }
    for (const slot of inventory.slots) {
        if (isCovered(slot, img)) obscured.add(slot.index);
    }
    return obscured;
}

// ============================================================
// Scan loop
// ============================================================

/** Why a slot is not being baselined right now — for diagnostics. */
function skipReason(slot: InventorySlot, img: ImgRef, obscured: Set<number>): string {
    if (obscured.has(slot.index)) {
        const bad: string[] = [];
        slot.corners.forEach((c, i) => {
            const live = readPixel(img, c.x, c.y);
            const ref = slot.cornerRefs[i];
            const ok = !!live && !!ref && cornerMatches(live, ref);
            if (!ok) {
                bad.push(`${InventorySlot.CORNER_NAMES[i]} ref=(${ref?.join(",")}) live=(${live?.join(",") ?? "null"})`);
            }
        });
        if (bad.length > 0) return "covered: " + bad.join(" ");
        return "excluded: cursor/adjacent";
    }
    const data = readInterior(slot, img);
    const light = interiorLightness(data);
    const empty = data ? isSlotEmpty(data) : false;
    return `baseline-pending light=${light} empty=${empty}`;
}

/** One-shot full report of every slot's scan state — call from console: Bronzeman.diagnoseSlotScan(). */
export function diagnoseSlotScan(): void {
    if (!inventory.isCalibrated) { log("[diag] inventory not calibrated"); return; }
    const img = captureFullRs();
    if (!img) { log("[diag] capture failed"); return; }
    const m = a1lib.getMousePosition();
    const hovered = m ? inventory.getSlotIndexAt(m.x, m.y) : null;
    const obscured = getObscuredSlotIndices(img);
    log(`[diag] mouse=(${m?.x},${m?.y}) hoveredSlot=${hovered} cols=${inventory.cols} rows=${inventory.rows}`);
    for (const slot of inventory.slots) {
        log(`[diag] slot ${slot.index}: prevHash=${slot.previousHash ?? "null"} → ${skipReason(slot, img, obscured)}`);
    }
}

/** Dump the raw 64-char interior hash of one slot — call from console:
 *  Bronzeman.dumpSlotHash(27)  (slot 27 = your "slot 28", last slot). */
export function dumpSlotHash(index: number): void {
    if (!inventory.isCalibrated) { log("[diag] inventory not calibrated"); return; }
    const slot = inventory.getSlot(index);
    if (!slot) { log(`[diag] slot ${index} does not exist`); return; }
    const img = captureFullRs();
    if (!img) { log("[diag] capture failed"); return; }
    const data = readInterior(slot, img);
    if (!data) { log("[diag] interior unreadable"); return; }
    const h = hashInterior(data);
    log(`[diag] slot ${index}: rawHash=${h} empty=${isSlotEmpty(data)}`);
}

/** Debug one slot's corner gate — call while a menu covers the slot:
 *  Bronzeman.debugCorners(10). Prints each corner's coordinate, ref colour,
 *  live colour, and whether the gate flags it as covered. */
export function debugCorners(index: number): void {
    if (!inventory.isCalibrated) { log("[diag] inventory not calibrated"); return; }
    const slot = inventory.getSlot(index);
    if (!slot) { log(`[diag] slot ${index} does not exist`); return; }
    const img = captureFullRs();
    if (!img) { log("[diag] capture failed"); return; }
    const refs = slot.cornerRefs;
    log(`[diag] slot ${index}: x=${slot.x} y=${slot.y} cornerRefsLen=${refs.length}`);
    slot.corners.forEach((c, i) => {
        const live = readPixel(img, c.x, c.y);
        const ref = refs[i];
        const ok = !!live && !!ref && cornerMatches(live, ref);
        log(`[diag]   ${InventorySlot.CORNER_NAMES[i]} (${c.x},${c.y}): ref=(${ref?.join(",")}) live=(${live?.join(",") ?? "null"}) ${ok ? "MATCH" : "COVERED"}`);
    });
}

function scanTick(): void {
    if (!inventory.isCalibrated) { stopSlotScan(); return; }
    const img = captureFullRs();
    if (!img) return;

    // Slots under/adjacent to the cursor or with covered corners are obscured —
    // their previousHash is left untouched so no false change is recorded.
    const obscured = getObscuredSlotIndices(img);

    const appeared: { index: number; hash: string }[] = [];
    const removed: { index: number; hash: string }[] = [];
    const changed: { index: number }[] = [];

    // Track which slots are excluded by noted/Use this tick.  When a slot
    // exits Use state, the dot must reappear instantly — if the slot is still
    // obscured the normal scan won't touch it, so we re-add it here.
    const excludedThisTick = new Set<number>();

    for (const slot of inventory.slots) {
        // Noted and "Use"‑state items are ignored regardless of occlusion —
        // the mouse is often over the slot when Use is clicked, so these
        // checks must run before the obscured gate.
        if (isNotedItem(slot, img)) {
            nonUnlockedSlots.delete(slot.index);
            excludedThisTick.add(slot.index);
            continue;
        }
        if (isInUseState(slot, img)) {
            nonUnlockedSlots.delete(slot.index);
            excludedThisTick.add(slot.index);
            continue;
        }

        // Re‑add slots that were excluded last tick but are scannable now —
        // this is the instant‑reappear path (e.g. Use state cleared).
        if (prevExcluded.has(slot.index)) {
            prevExcluded.delete(slot.index);
            nonUnlockedSlots.add(slot.index);
        }

        if (obscured.has(slot.index)) continue;

        // Read the interior once per tick; feed the empty check, the hash and
        // the last-valid pixels from the same buffer.
        const data = readInterior(slot, img);
        if (!data) continue;
        slot.lastValidPixels = data;
        const cur = isSlotEmpty(data) ? EMPTY_HASH : hashInterior(data);

        // Non-unlocked tracking — always update every tick so the gold dot
        // appears immediately after baseline and persists across steady-state.
        if (cur === EMPTY_HASH || isHashUnlocked(cur)) {
            nonUnlockedSlots.delete(slot.index);
        } else {
            nonUnlockedSlots.add(slot.index);
        }

        const prev = slot.previousHash;
        if (prev === null) {
            // First clean sighting since calibrate — record the baseline, no event.
            slot.previousHash = cur;
            continue;
        }
        if (cur === prev) continue;

        if (cur === EMPTY_HASH) removed.push({ index: slot.index, hash: prev });
        else if (prev === EMPTY_HASH) appeared.push({ index: slot.index, hash: cur });
        else changed.push({ index: slot.index });
        slot.previousHash = cur;
    }

    // Pair same-tick removals + appearances by matching hash → "moved".
    for (const a of appeared) {
        const rIdx = removed.findIndex(r => r.hash === a.hash);
        if (rIdx >= 0) {
            log(`Slot ${removed[rIdx].index} → ${a.index}: item moved`);
            removed.splice(rIdx, 1);
            appeared.splice(appeared.indexOf(a), 1);
        }
    }
    for (const r of removed) log(`Slot ${r.index}: item removed`);
    for (const a of appeared) log(`Slot ${a.index}: item appeared`);
    for (const c of changed) log(`Slot ${c.index}: item changed`);

    prevExcluded = excludedThisTick;
}

export function startSlotScan(): void {
    if (scanHandle) return;
    scanHandle = setInterval(scanTick, SCAN_MS);
}

export function stopSlotScan(): void {
    if (scanHandle) { clearInterval(scanHandle); scanHandle = null; }
}
