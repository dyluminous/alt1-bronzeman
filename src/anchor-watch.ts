// anchor-watch.ts — watches border pixels spread across the inventory grid.
// When the grid is resized/moved, at least one watched pixel changes; once the
// new values hold stable for a few ticks (resize settled), the callback fires.
// Reference colors are kept in memory only (no localStorage).
import { inventory } from "./inventory";
import { capturePixel } from "./core";
import type { Point } from "./inventory-slot";

/** The border pixels the watch monitors — overlay drawing must avoid these. */
export function getAnchorWatchPoints(): Point[] {
    const slots = inventory.slots;
    if (slots.length === 0) return [];
    return [
        slots[inventory.getLastColumnFirstRowIndex()].tr,
        slots[inventory.getLastSlotIndex()].br,
        slots[inventory.getFirstColumnLastRowIndex()].bl,
    ];
}

let watchHandle: ReturnType<typeof setInterval> | null = null;
/** Watched border pixels (TR of top-right slot, BR of last slot, BL of bottom-left slot). */
let points: Point[] = [];
/** Reference colors captured at start, one per point. */
let refs: [number, number, number][] = [];
/** Combined snapshot + how many consecutive ticks it has been stable. */
let stableSnapshot: [number, number, number][] | null = null;
let stableCount = 0;
/** Ticks (500ms each) a new snapshot must hold before we recapture — a settled resize. */
const STABLE_TICKS = 3; // ~1.5s

function samePixel(a: [number, number, number], b: [number, number, number]): boolean {
    return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

/** Watch grid border pixels; call onChange when they settle on new values. */
export function startAnchorWatch(onChange: () => void, onTick?: () => void): void {
    stopAnchorWatch();
    const slots = inventory.slots;
    if (slots.length === 0) return;
    points = [
        slots[inventory.getLastColumnFirstRowIndex()].tr,
        slots[inventory.getLastSlotIndex()].br,
        slots[inventory.getFirstColumnLastRowIndex()].bl,
    ];

    refs = [];
    for (const p of points) {
        const c = capturePixel(p.x, p.y);
        if (!c) return;
        refs.push(c);
    }

    watchHandle = setInterval(() => {
        if (!inventory.isCalibrated) { stopAnchorWatch(); return; }
        const vals: [number, number, number][] = [];
        for (const p of points) {
            const c = capturePixel(p.x, p.y);
            if (!c) return;
            vals.push(c);
        }

        const changed = vals.some((v, i) => !samePixel(v, refs[i]));
        if (!changed) {
            stableSnapshot = null;
            stableCount = 0;
            onTick?.();
            return;
        }

        // Something moved — debounce until the whole snapshot stops changing.
        // While resizing, at least one point keeps moving, so this only fires
        // once the grid has fully settled.
        if (stableSnapshot && stableSnapshot.every((v, i) => samePixel(v, vals[i]))) {
            stableCount++;
            if (stableCount >= STABLE_TICKS) {
                stableSnapshot = null;
                stableCount = 0;
                onChange();
            }
        } else {
            stableSnapshot = vals;
            stableCount = 1;
        }
        onTick?.();
    }, 500);
}

export function stopAnchorWatch(): void {
    if (watchHandle) { clearInterval(watchHandle); watchHandle = null; }
    points = [];
    refs = [];
    stableSnapshot = null;
    stableCount = 0;
}
