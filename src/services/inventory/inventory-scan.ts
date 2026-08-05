// slot-scan.ts — monitors inventory slot contents for changes.
// Each tick: one region capture; per slot, the 4 border corners must still match
// their calibration refs (else a tooltip/menu is covering it) and the slot must
// not be under or adjacent to the cursor. Clean slots are hashed and compared
// against the slot's previousHash to detect appeared / removed / changed / moved.
import * as a1lib from "alt1";
import * as OCR from "alt1/ocr";
import { inventory } from "../../classes/inventory";
import { captureFullRs, log, lightness } from "../../core";
import type { ImgRef } from "alt1/base";
import { InventorySlot } from "../../classes/inventory-slot";
import { isHashUnlocked, isLowerHalfUnlocked, isHashNibbleUnlocked } from "../unlock/unlock-store";
import { hashInterior, LOWER_HALF_OFFSET } from "../../utils/hash";
import { readPixel } from "../../utils/helpers";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const stackableFont = require("alt1/fonts/pixel_8px_digits");

const SCAN_MS = 500;
/** Sentinel previousHash for an empty slot. */
const EMPTY_HASH = "empty";

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
// SlotScanner — the per-tick scan + the gold-dot slot set
// ============================================================

class SlotScanner {
    private handle: ReturnType<typeof setInterval> | null = null;

    /** Slots whose current interior hash is not in the unlocked set. */
    private nonUnlockedSlots: Set<number> = new Set();
    /** Slots that were in Use state in the previous tick — re‑added to the dot
     *  set on exit so the dot reappears instantly even while the mouse is
     *  nearby. */
    private prevUseSlots: Set<number> = new Set();

    /** Slots whose current interior hash is not in the unlocked set. */
    getNonUnlockedSlotIndices(): Set<number> {
        return this.nonUnlockedSlots;
    }

    /** Fill cornerRefs from a fresh capture (once per calibrate). */
    captureCornerRefs(img: ImgRef): void {
        for (const slot of inventory.slots) {
            slot.cornerRefs = slot.corners.map(c => readPixel(img, c.x, c.y) ?? [0, 0, 0]);
            slot.previousHash = null;
            slot.lastValidPixels = null;
        }
    }

    start(): void {
        if (this.handle) return;
        this.handle = setInterval(() => this.tick(), SCAN_MS);
    }

    stop(): void {
        if (this.handle) { clearInterval(this.handle); this.handle = null; }
    }

    // ----------------------------------------------------------
    // Gate helpers
    // ----------------------------------------------------------

    /** Slots the scan must not read: covered (corner mismatch) or under/adjacent
     *  to the cursor. Their previousHash is left untouched so no false change is
     *  recorded. */
    getObscuredSlotIndices(img: ImgRef): Set<number> {
        const obscured = new Set<number>();
        const hovered = inventory.getHoveredSlotIndex();
        if (hovered !== null) {
            obscured.add(hovered);
            for (const a of inventory.getAdjacentSlotIndices(hovered)) obscured.add(a);
        }
        for (const slot of inventory.slots) {
            if (slot.isCovered(img)) obscured.add(slot.index);
        }
        return obscured;
    }

    /** Slots with a corner pixel mismatch — a tooltip or context menu is covering
     *  them. STRICT set: used to gate interior reads so no tooltip-polluted hash
     *  is ever stored. */
    private getCoveredSlotIndices(img: ImgRef): Set<number> {
        const covered = new Set<number>();
        for (const slot of inventory.slots) {
            if (slot.isCovered(img)) covered.add(slot.index);
        }
        return covered;
    }

    /** Covered slots for DOT HIDING: the strict set minus the hovered row, which
     *  keeps dots visible across the row the player is inspecting. */
    private getCoveredForDots(img: ImgRef): Set<number> {
        const covered = this.getCoveredSlotIndices(img);
        const hovered = inventory.getHoveredSlotIndex();
        // The entire row of the hovered slot should keep dots visible — the
        // player's tooltip often extends across the row when inspecting an item.
        if (hovered !== null) {
            const hSlot = inventory.getSlot(hovered);
            if (hSlot) {
                for (const s of inventory.slots) {
                    if (s.row === hSlot.row) covered.delete(s.index);
                }
            }
        }
        return covered;
    }

    // ----------------------------------------------------------
    // Diagnostics
    // ----------------------------------------------------------

    /** Why a slot is not being baselined right now — for diagnostics. */
    private skipReason(slot: InventorySlot, img: ImgRef, obscured: Set<number>): string {
        if (obscured.has(slot.index)) {
            const bad: string[] = [];
            slot.corners.forEach((c, i) => {
                const live = readPixel(img, c.x, c.y);
                const ref = slot.cornerRefs[i];
                const ok = !!live && !!ref && InventorySlot.cornerMatches(live, ref);
                if (!ok) {
                    bad.push(`${InventorySlot.CORNER_NAMES[i]} ref=(${ref?.join(",")}) live=(${live?.join(",") ?? "null"})`);
                }
            });
            if (bad.length > 0) return "covered: " + bad.join(" ");
            return "excluded: cursor/adjacent";
        }
        const data = readInterior(slot, img);
        const light = interiorLightness(data);
        const empty = data ? InventorySlot.isEmpty(data) : false;
        return `baseline-pending light=${light} empty=${empty}`;
    }

    /** One-shot full report of every slot's scan state — call from console:
     *  Bronzeman.diagnoseSlotScan(). */
    diagnose(): void {
        if (!inventory.isCalibrated) { log("[diag] inventory not calibrated"); return; }
        const img = captureFullRs();
        if (!img) { log("[diag] capture failed"); return; }
        const m = a1lib.getMousePosition();
        const hovered = m ? inventory.getSlotIndexAt(m.x, m.y) : null;
        const obscured = this.getObscuredSlotIndices(img);
        log(`[diag] mouse=(${m?.x},${m?.y}) hoveredSlot=${hovered} cols=${inventory.cols} rows=${inventory.rows}`);
        for (const slot of inventory.slots) {
            log(`[diag] slot ${slot.index}: prevHash=${slot.previousHash ?? "null"} → ${this.skipReason(slot, img, obscured)}`);
        }
    }

    /** Dump the raw 192-char interior hash of one slot — call from console:
     *  Bronzeman.dumpSlotHash(27)  (slot 27 = your "slot 28", last slot). */
    dumpSlotHash(index: number): void {
        if (!inventory.isCalibrated) { log("[diag] inventory not calibrated"); return; }
        const slot = inventory.getSlot(index);
        if (!slot) { log(`[diag] slot ${index} does not exist`); return; }
        const img = captureFullRs();
        if (!img) { log("[diag] capture failed"); return; }
        const data = readInterior(slot, img);
        if (!data) { log("[diag] interior unreadable"); return; }
        const h = hashInterior(data);
        log(`[diag] slot ${index}: rawHash=${h} empty=${InventorySlot.isEmpty(data)}`);
    }

    /** Debug one slot's corner gate — call while a menu covers the slot:
     *  Bronzeman.debugCorners(10). Prints each corner's coordinate, ref colour,
     *  live colour, and whether the gate flags it as covered. */
    debugCorners(index: number): void {
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
            const ok = !!live && !!ref && InventorySlot.cornerMatches(live, ref);
            log(`[diag]   ${InventorySlot.CORNER_NAMES[i]} (${c.x},${c.y}): ref=(${ref?.join(",")}) live=(${live?.join(",") ?? "null"}) ${ok ? "MATCH" : "COVERED"}`);
        });
    }

    // ----------------------------------------------------------
    // Scan loop
    // ----------------------------------------------------------

    private tick(): void {
        if (!inventory.isCalibrated) { this.stop(); return; }
        const img = captureFullRs();
        if (!img) return;

        // Strict covered set gates interior reads (no tooltip-polluted hashes);
        // the row-excepted set is used only for hiding dots. (Cursor-adjacent
        // slots are intentionally NOT excluded from reads — see getCoveredForDots.)
        let covered: Set<number>;
        let coveredForDots: Set<number>;
        try {
            covered = this.getCoveredSlotIndices(img);
            coveredForDots = this.getCoveredForDots(img);
        } catch (_) {
            return;
        }

        const appeared: { index: number; hash: string }[] = [];
        const removed: { index: number; hash: string }[] = [];
        const changed: { index: number }[] = [];

        // Track which slots are in Use state this tick.  When a slot exits Use
        // state, the dot must reappear instantly — if the slot is still obscured
        // the normal scan won't touch it, so we re‑add it here.
        const useSlotsThisTick = new Set<number>();

        for (const slot of inventory.slots) {
            // Stackable check runs for every slot (cheap, 2 px) — the digit is
            // visible regardless of the noted/use-state gates below.
            slot.isStackable = slot.isStackableItem(img);
            // Noted, dragged and "Use"‑state items are ignored regardless of
            // occlusion — the mouse is often over the slot when Use is clicked
            // or an item is dragged, so these checks must run before the
            // obscured gate.
            if (slot.isNoted(img)) {
                this.nonUnlockedSlots.delete(slot.index);
                continue;
            }
            // Dragged items are also ignored — the mouse is over the slot
            // while dragging, so this must run before the obscured gate.
            if (slot.isDraggingItem(img)) {
                this.nonUnlockedSlots.delete(slot.index);
                continue;
            }
            if (slot.isInUseState(img)) {
                this.nonUnlockedSlots.delete(slot.index);
                useSlotsThisTick.add(slot.index);
                continue;
            }

            // Re‑add slots that were in Use state last tick but aren't now —
            // this is the instant‑reappear path (Use state cleared).
            if (this.prevUseSlots.has(slot.index)) {
                this.prevUseSlots.delete(slot.index);
                this.nonUnlockedSlots.add(slot.index);
            }

            if (covered.has(slot.index)) continue;

            // Read the interior once per tick; feed the empty check, the hash and
            // the last-valid pixels from the same buffer.
            const data = readInterior(slot, img);
            if (!data) continue;
            slot.lastValidPixels = data;
            const cur = InventorySlot.isEmpty(data) ? EMPTY_HASH : hashInterior(data);

            // Non-unlocked tracking — always update every tick so the gold dot
            // appears immediately after baseline and persists across steady-state.
            // A stackable slot whose lower-half slice matches an unlocked item is
            // a quantity-variant of it → treated as unlocked (no dot, no wiki).
            if (cur === EMPTY_HASH || isHashUnlocked(cur)
                || (slot.isStackable && isLowerHalfUnlocked(cur.slice(LOWER_HALF_OFFSET)))
                || isHashNibbleUnlocked(cur)) {
                this.nonUnlockedSlots.delete(slot.index);
            } else {
                this.nonUnlockedSlots.add(slot.index);
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

        // Slots covered by a tooltip/context menu shouldn't show dots —
        // the player may be inspecting or manipulating them.
        coveredForDots.forEach(idx => this.nonUnlockedSlots.delete(idx));

        this.prevUseSlots = useSlotsThisTick;
    }
}

/** Module-wide singleton. */
const slotScanner = new SlotScanner();

// ============================================================
// Re-exports — stable public API for importers + console
// ============================================================

export const getNonUnlockedSlotIndices = (): Set<number> => slotScanner.getNonUnlockedSlotIndices();
export const captureCornerRefs = (img: ImgRef): void => slotScanner.captureCornerRefs(img);
export const getObscuredSlotIndices = (img: ImgRef): Set<number> => slotScanner.getObscuredSlotIndices(img);
export const diagnoseSlotScan = (): void => slotScanner.diagnose();
export const dumpSlotHash = (index: number): void => slotScanner.dumpSlotHash(index);
export const debugCorners = (index: number): void => slotScanner.debugCorners(index);
export const startSlotScan = (): void => slotScanner.start();
export const stopSlotScan = (): void => slotScanner.stop();

// ============================================================
// Stackable quantity OCR test — debug
// ============================================================
// Interior-relative bounds of the yellow quantity digits: (3,1)–(35,8)

const STACK_DIGIT_X = 0;
const STACK_DIGIT_Y = 0;
const STACK_DIGIT_W = InventorySlot.INTERIOR_W; // 36
const STACK_DIGIT_H = 9;

export function ocrStackableDebug(): void {
    const img = captureFullRs();
    if (!img) { log("ocrStackableDebug: no capture"); return; }
    const slot = inventory.slots[27];
    if (!slot) { log("ocrStackableDebug: slot 27 not available"); return; }

    const sx = slot.interiorX + STACK_DIGIT_X;
    const sy = slot.interiorY + STACK_DIGIT_Y;
    const color = slot.stackDigitColor(img);
    if (!color) { log(`ocrStackableDebug: no digit color at slot 27`); return; }
    log(`ocrStackableDebug: digit region screen=(${sx},${sy}) ${STACK_DIGIT_W}×${STACK_DIGIT_H} color=#${[color[0], color[1], color[2]].map(c => c.toString(16).padStart(2, "0")).join("")}`);

    // Full RS buffer + absolute coords — the pattern that worked on first attempt.
    const fullBuf = img.toData();
    const result = OCR.findReadLine(
        fullBuf, stackableFont, [[color[0], color[1], color[2]]],
        sx, sy, STACK_DIGIT_W, STACK_DIGIT_H,
    );
    log(`ocrStackableDebug slot 27: text="${result?.text ?? ""}"`);
}

/** OCR the stackable quantity from a slot's digit region. Returns the scaled
 *  number (e.g. 105000 for a white "105K" display) or null on failure. Uses
 *  the tier color detected at the slot's digit pixels as the OCR filter. */
export function readStackableQuantity(slotIndex: number): number | null {
    const img = captureFullRs();
    if (!img) return null;
    const slot = inventory.slots[slotIndex];
    if (!slot) return null;
    const color = slot.stackDigitColor(img);
    if (!color) return null;
    const sx = slot.interiorX + STACK_DIGIT_X;
    const sy = slot.interiorY + STACK_DIGIT_Y;
    const result = OCR.findReadLine(
        img.toData(), stackableFont, [[color[0], color[1], color[2]]],
        sx, sy, STACK_DIGIT_W, STACK_DIGIT_H,
    );
    const digits = parseInt(result?.text ?? "", 10);
    if (isNaN(digits)) return null;
    return digits * InventorySlot.stackDigitMultiplier(color);
}
