// slot-scan.ts — monitors inventory slot contents for changes.
// Each tick: one region capture; per slot, the 4 border corners must still match
// their calibration refs (else a tooltip/menu is covering it) and the slot must
// not be under or adjacent to the cursor. Clean slots are hashed and compared
// against the slot's previousHash to detect appeared / removed / changed / moved.
import * as a1lib from "alt1";
import { inventory } from "./inventory";
import { captureFullRs, log, lightness } from "./core";
import type { ImgRef } from "alt1/base";
import type { InventorySlot } from "./inventory-slot";

const SCAN_MS = 500;
/** Per-channel tolerance when comparing a corner to its calibration ref. */
const CORNER_TOL = 8;
/** Sentinel previousHash for an empty slot. */
const EMPTY_HASH = "empty";
/** Per-channel tolerance when matching a slot against the empty reference. */
const EMPTY_TOL = 4;
/** Max pixels allowed to differ from the empty reference and still count as empty.
 *  Data-derived: 28 empty slots mismatched the slot-27 ref by 41–84 px (mean ≈ 54),
 *  so 100 sits comfortably above the empties and below any item. */
const EMPTY_MISMATCH_PX = 100;

let scanHandle: ReturnType<typeof setInterval> | null = null;
/** Last logged skip reason per slot (null = not logged yet) — for change-only diag logging. */
let lastSkipReason: (string | null)[] = [];
/** Raw 36×32 interior RGBA of the known-empty slot (index 27), captured at calibration. */
let emptyRef: Uint8ClampedArray | null = null;

// ============================================================
// Baseline — fill cornerRefs from a fresh capture (once per calibrate)
// ============================================================

export function captureCornerRefs(img: ImgRef): void {
    for (const slot of inventory.slots) {
        slot.cornerRefs = slot.corners.map(c => {
            const d = img.toData(c.x, c.y, 1, 1);
            return d ? [d.data[0], d.data[1], d.data[2]] : [0, 0, 0];
        });
        slot.previousHash = null;
    }
    // Slot 27 is assumed always-empty (user-verified) — store its raw interior
    // as the empty reference. Any slot matching it exactly is empty.
    const emptySlot = inventory.getSlot(27);
    if (emptySlot) {
        const d = img.toData(emptySlot.x + 1, emptySlot.y + 1, 36, 32);
        emptyRef = d ? new Uint8ClampedArray(d.data) : null;
    } else {
        emptyRef = null;
    }
}

// ============================================================
// Per-slot checks
// ============================================================

function cornerMatches(corner: [number, number, number], ref: [number, number, number]): boolean {
    return Math.abs(corner[0] - ref[0]) <= CORNER_TOL
        && Math.abs(corner[1] - ref[1]) <= CORNER_TOL
        && Math.abs(corner[2] - ref[2]) <= CORNER_TOL;
}

/** True when any corner no longer matches its calibration ref (slot is covered). */
function isCovered(slot: InventorySlot, img: ImgRef): boolean {
    if (slot.cornerRefs.length !== 4) return true;
    return slot.corners.some((c, i) => {
        const d = img.toData(c.x, c.y, 1, 1);
        if (!d) return true;
        return !cornerMatches([d.data[0], d.data[1], d.data[2]], slot.cornerRefs[i]);
    });
}

/** Number of interior pixels differing from the empty reference beyond tolerance. */
function emptyMismatchCount(slot: InventorySlot, img: ImgRef): number {
    if (!emptyRef) return Infinity;
    const d = img.toData(slot.x + 1, slot.y + 1, 36, 32);
    if (!d) return Infinity;
    let mismatched = 0;
    for (let i = 0; i < emptyRef.length; i += 4) {
        if (Math.abs(d.data[i] - emptyRef[i]) > EMPTY_TOL
            || Math.abs(d.data[i + 1] - emptyRef[i + 1]) > EMPTY_TOL
            || Math.abs(d.data[i + 2] - emptyRef[i + 2]) > EMPTY_TOL) {
            mismatched++;
        }
    }
    return mismatched;
}

/** True when the slot's interior is (near-)identical to the empty reference. */
function isEmptySlot(slot: InventorySlot, img: ImgRef): boolean {
    return emptyMismatchCount(slot, img) <= EMPTY_MISMATCH_PX;
}

/** 8×8 cells, 4-bit brightness → 64-char hex. */
function hashInterior(slot: InventorySlot, img: ImgRef): string {
    const W = 36, H = 32;
    const d = img.toData(slot.x + 1, slot.y + 1, W, H);
    if (!d) return "";
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
                    sum += d.data[i] * 0.299 + d.data[i + 1] * 0.587 + d.data[i + 2] * 0.114;
                    cnt++;
                }
            }
            h += Math.min(15, cnt > 0 ? Math.round((sum / cnt) / 10.5) : 0).toString(16);
        }
    }
    return h;
}

// ============================================================
// Scan loop
// ============================================================

/** Why a slot is not being baselined right now — for diagnostics. */
function skipReason(
    slot: InventorySlot,
    img: ImgRef,
    excluded: Set<number>,
    hovered: number | null,
): string {
    if (excluded.has(slot.index)) {
        return hovered === slot.index
            ? "excluded: under cursor"
            : `excluded: adjacent to cursor slot ${hovered}`;
    }
    const names = ["TL", "TR", "BL", "BR"];
    const bad: string[] = [];
    slot.corners.forEach((c, i) => {
        const d = img.toData(c.x, c.y, 1, 1);
        const live = d ? [d.data[0], d.data[1], d.data[2]] as [number, number, number] : null;
        const ref = slot.cornerRefs[i];
        const ok = !!live && !!ref && cornerMatches(live, ref);
        if (!ok) {
            bad.push(`${names[i]} ref=(${ref?.join(",")}) live=(${live?.join(",") ?? "null"})`);
        }
    });
    if (bad.length > 0) return "covered: " + bad.join(" ");
    const d = img.toData(slot.x + 1, slot.y + 1, 36, 32);
    let sum = 0, cnt = 0;
    if (d) {
        for (let i = 0; i < d.data.length; i += 4) {
            sum += lightness(d.data[i], d.data[i + 1], d.data[i + 2]);
            cnt++;
        }
    }
    const avg = cnt > 0 ? Math.round((sum / cnt) * 10) / 10 : -1;
    return `baseline-pending light=${avg} emptyMismatch=${emptyMismatchCount(slot, img)}`;
}

/** One-shot full report of every slot's scan state — call from console: Bronzeman.diagnoseSlotScan(). */
export function diagnoseSlotScan(): void {
    if (!inventory.isCalibrated) { log("[diag] inventory not calibrated"); return; }
    const img = captureFullRs();
    if (!img) { log("[diag] capture failed"); return; }
    const excluded = new Set<number>();
    let hovered: number | null = null;
    const m = a1lib.getMousePosition();
    if (m) {
        hovered = inventory.getSlotIndexAt(m.x, m.y);
        if (hovered !== null) {
            excluded.add(hovered);
            for (const a of inventory.getAdjacentSlotIndices(hovered)) excluded.add(a);
        }
    }
    log(`[diag] mouse=(${m?.x},${m?.y}) hoveredSlot=${hovered} cols=${inventory.cols} rows=${inventory.rows}`);
    for (const slot of inventory.slots) {
        log(`[diag] slot ${slot.index}: prevHash=${slot.previousHash ?? "null"} → ${skipReason(slot, img, excluded, hovered)}`);
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
    const h = hashInterior(slot, img);
    log(`[diag] slot ${index}: rawHash=${h} emptyMismatch=${emptyMismatchCount(slot, img)}`);
}

function scanTick(): void {
    if (!inventory.isCalibrated) { stopSlotScan(); return; }
    const img = captureFullRs();
    if (!img) return;

    // Slots under the cursor or adjacent to it are excluded — the hovered slot's
    // interior is visually altered and its neighbours may be under the tooltip.
    const excluded = new Set<number>();
    let hovered: number | null = null;
    const m = a1lib.getMousePosition();
    if (m) {
        hovered = inventory.getSlotIndexAt(m.x, m.y);
        if (hovered !== null) {
            excluded.add(hovered);
            for (const a of inventory.getAdjacentSlotIndices(hovered)) excluded.add(a);
        }
    }

    const appeared: { index: number; hash: string }[] = [];
    const removed: { index: number; hash: string }[] = [];
    const changed: { index: number }[] = [];

    for (const slot of inventory.slots) {
        if (excluded.has(slot.index)) continue;
        if (isCovered(slot, img)) continue;

        const cur = isEmptySlot(slot, img) ? EMPTY_HASH : hashInterior(slot, img);
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

    // Diagnostics: when a slot stays un-baselined, log WHY — but only when the
    // reason changes, so we don't spam identical lines every tick.
    if (lastSkipReason.length !== inventory.slots.length) {
        lastSkipReason = new Array(inventory.slots.length).fill(null);
    }
    for (const slot of inventory.slots) {
        if (slot.previousHash !== null) { lastSkipReason[slot.index] = null; continue; }
        const reason = skipReason(slot, img, excluded, hovered);
        if (reason !== lastSkipReason[slot.index]) {
            lastSkipReason[slot.index] = reason;
            log(`[diag] slot ${slot.index} greyed: ${reason}`);
        }
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
