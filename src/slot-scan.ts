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
/** Per-channel tolerance when matching a slot against the empty reference. */
const EMPTY_TOL = 4;
/** Max pixels allowed to differ from the empty reference and still count as empty.
 *  Data-derived: 28 empty slots mismatched the slot-27 ref by 41–84 px (mean ≈ 54),
 *  so 100 sits comfortably above the empties and below any item. */
const EMPTY_MISMATCH_PX = 100;

let scanHandle: ReturnType<typeof setInterval> | null = null;
/** Raw 36×32 interior RGBA of the known-empty slot (index 27), captured at calibration. */
let emptyRef: Uint8ClampedArray | null = null;

/** Slots whose current interior hash is not in the unlocked set. */
let nonUnlockedSlots: Set<number> = new Set();

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
    // Slot 27 is assumed always-empty (user-verified) — store its raw interior
    // as the empty reference. Any slot matching it exactly is empty.
    const emptySlot = inventory.getSlot(27);
    const data = emptySlot ? readInterior(emptySlot, img) : null;
    emptyRef = data ? new Uint8ClampedArray(data) : null;
}

// ============================================================
// Per-slot checks
// ============================================================

/** True when the corner pixel exactly matches its calibration ref. */
function cornerMatches(corner: [number, number, number], ref: [number, number, number]): boolean {
    return corner[0] === ref[0] && corner[1] === ref[1] && corner[2] === ref[2];
}

/** True when any corner no longer matches its calibration ref (slot is covered). */
function isCovered(slot: InventorySlot, img: ImgRef): boolean {
    if (slot.cornerRefs.length !== 4) return true;
    return slot.corners.some((c, i) => {
        const live = readPixel(img, c.x, c.y);
        return !live || !cornerMatches(live, slot.cornerRefs[i]);
    });
}

/** Number of interior pixels differing from the empty reference beyond tolerance. */
function emptyMismatchCount(data: Uint8ClampedArray): number {
    if (!emptyRef) return Infinity;
    let mismatched = 0;
    for (let i = 0; i < emptyRef.length; i += 4) {
        if (Math.abs(data[i] - emptyRef[i]) > EMPTY_TOL
            || Math.abs(data[i + 1] - emptyRef[i + 1]) > EMPTY_TOL
            || Math.abs(data[i + 2] - emptyRef[i + 2]) > EMPTY_TOL) {
            mismatched++;
        }
    }
    return mismatched;
}

/** True when the interior buffer is (near-)identical to the empty reference. */
function isEmptyInterior(data: Uint8ClampedArray): boolean {
    return emptyMismatchCount(data) <= EMPTY_MISMATCH_PX;
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
    const mismatch = data ? emptyMismatchCount(data) : -1;
    return `baseline-pending light=${light} emptyMismatch=${mismatch}`;
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
    log(`[diag] slot ${index}: rawHash=${h} emptyMismatch=${emptyMismatchCount(data)}`);
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

    for (const slot of inventory.slots) {
        if (obscured.has(slot.index)) continue;

        // Read the interior once per tick; feed the empty check, the hash and
        // the last-valid pixels from the same buffer.
        const data = readInterior(slot, img);
        if (!data) continue;
        slot.lastValidPixels = data;
        const cur = isEmptyInterior(data) ? EMPTY_HASH : hashInterior(data);

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
}

export function startSlotScan(): void {
    if (scanHandle) return;
    scanHandle = setInterval(scanTick, SCAN_MS);
}

export function stopSlotScan(): void {
    if (scanHandle) { clearInterval(scanHandle); scanHandle = null; }
}
