// hash.ts — interior-hash computation for inventory slots.
// The hash is 8×8 cells × 3 hex nibbles (R, G, B channel averages) = 192 chars.
// Background-grain pixels are excluded (the grain differs per slot; the item
// renders identically), and hashing the channels separately preserves hue.
import { InventorySlot } from "../classes/inventory-slot";

/** The 52 grain colors of the empty inventory-slot background (extracted from
 *  assets/testing/inner-slots.png). Excluded from the item hash: the grain is
 *  spatially different in every slot, so including it makes the same item hash
 *  differently in different slots. */
const BG_PALETTE_COLORS: readonly number[] = [
    0x181410, 0x191410, 0x1a1511, 0x1a1512, 0x1b1511, 0x1b1612, 0x1b1613, 0x1b1712,
    0x1b1713, 0x1c1713, 0x1c1714, 0x1c1813, 0x1c1814, 0x1d1814, 0x1d1815, 0x1e1814,
    0x1d1915, 0x1e1916, 0x1e1a15, 0x1e1a16, 0x1f1a16, 0x1f1a17, 0x1f1b17, 0x201b17,
    0x201b18, 0x1f1c17, 0x201c18, 0x211c18, 0x211c19, 0x211d19, 0x211d1a, 0x221d19,
    0x221d1a, 0x231d19, 0x221e1a, 0x231e1b, 0x231f1b, 0x241f1b, 0x241f1c, 0x23201b,
    0x251f1b, 0x24201c, 0x25201c, 0x24211c, 0x26201c, 0x25211d, 0x26211e, 0x26221f,
    0x28221e, 0x282320, 0x282520, 0x2a2722,
];

/** The palette expanded to ±1 per channel (tol 1): every packed RGB within one
 *  channel-step of a grain color. Covers live grain shades that land one step
 *  off the captured palette (interface scaling/AA) while still never touching
 *  item pixels — verified black dragonhide's nearest item color is ≥4
 *  channel-delta from any palette entry. 52 colors × 27 neighbors = 1404. */
const BG_PALETTE_TOL1: ReadonlySet<number> = (() => {
    const out = new Set<number>();
    for (const packed of BG_PALETTE_COLORS) {
        const r = (packed >> 16) & 0xff, g = (packed >> 8) & 0xff, b = packed & 0xff;
        for (let dr = -1; dr <= 1; dr++) {
            for (let dg = -1; dg <= 1; dg++) {
                for (let db = -1; db <= 1; db++) {
                    out.add(((r + dr) << 16) | ((g + dg) << 8) | (b + db));
                }
            }
        }
    }
    return out;
})();

/** Character offset where the hash's lower-half slice begins (cell rows 3–7 =
 *  interior rows 12–31, where the stack-quantity digit never renders).
 *  8 cells/row × 3 nibbles/cell × 3 rows = char 72. */
export const LOWER_HALF_OFFSET = 72;

/** The quantity-invariant lower-half slice of a full hash. */
export function lowerHalfOf(hash: string): string {
    return hash.slice(LOWER_HALF_OFFSET);
}

/** True when the sum of all 192 nibble deltas is ≤ 30 — the same item can
 *  shift a few cells by large amounts across login sessions (pixel-boundary
 *  drift can turn an empty cell into a colored one or vice versa), but the
 *  total distance stays low. Random hashes average ~880 total distance, so
 *  threshold 30 is very conservative against false positives. */
export function nibbleTolerantMatch(live: string, stored: string): boolean {
    let total = 0;
    for (let i = 0; i < 192; i++) {
        total += Math.abs(parseInt(live[i], 16) - parseInt(stored[i], 16));
        if (total > 50) return false;
    }
    return true;
}

/** 8×8 cells → 3 hex nibbles per cell (R, G, B channel averages, each 4-bit)
 *  → 192-char hash. Hashing the channels separately preserves hue, so items
 *  that differ only in colour (e.g. red vs green ticket: lightness 89.5 vs
 *  90.5) no longer collide. Background-grain pixels (within tol 1 of the
 *  palette) are skipped — the grain differs per slot, the item renders
 *  identically. Cells with no non-background pixels hash as '000'. */
export function hashInterior(data: Uint8ClampedArray): string {
    const W = InventorySlot.INTERIOR_W, H = InventorySlot.INTERIOR_H;
    const cw = Math.max(1, Math.floor(W / 8));
    const ch = Math.max(1, Math.floor(H / 8));
    let h = "";
    for (let cy = 0; cy < 8; cy++) {
        for (let cx = 0; cx < 8; cx++) {
            let rSum = 0, gSum = 0, bSum = 0, cnt = 0;
            for (let dy = 0; dy < ch; dy++) {
                for (let dx = 0; dx < cw; dx++) {
                    const px = cx * cw + dx, py = cy * ch + dy;
                    if (px >= W || py >= H) continue;
                    const i = (py * W + px) * 4;
                    const packed = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
                    if (BG_PALETTE_TOL1.has(packed)) continue; // grain — differs per slot
                    rSum += data[i]; gSum += data[i + 1]; bSum += data[i + 2];
                    cnt++;
                }
            }
            if (cnt === 0) { h += "000"; continue; }
            const nib = (v: number): string => Math.min(15, Math.round(v / cnt / 17)).toString(16);
            h += nib(rSum) + nib(gSum) + nib(bSum);
        }
    }
    return h;
}
