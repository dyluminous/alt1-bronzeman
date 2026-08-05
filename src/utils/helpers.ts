// utils/helpers.ts — shared pure helper functions used across the codebase.
// No DOM, no side effects, no module state.

import type { ImgRef } from "alt1/base";

// ---------------------------------------------------------------------------
// Pixel utilities
// ---------------------------------------------------------------------------

/** Read one RGB pixel from an image, or null when out of bounds. */
export function readPixel(img: ImgRef, x: number, y: number): [number, number, number] | null {
    const d = img.toData(x, y, 1, 1);
    return d ? [d.data[0], d.data[1], d.data[2]] : null;
}

/** True when two RGB triples are exactly equal. */
export function rgbMatch(
    a: readonly [number, number, number],
    b: readonly [number, number, number],
): boolean {
    return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

/** True when a pixel matches a reference colour within per-channel tolerance. */
export function rgbNear(
    pixel: readonly [number, number, number],
    ref: readonly [number, number, number],
    tol: number,
): boolean {
    return Math.abs(pixel[0] - ref[0]) <= tol
        && Math.abs(pixel[1] - ref[1]) <= tol
        && Math.abs(pixel[2] - ref[2]) <= tol;
}

// ---------------------------------------------------------------------------
// Hash utilities
// ---------------------------------------------------------------------------

/** Sum of all 192 hex nibbles in a hash — used as a cheap pre-filter for
 *  tolerant lookups. Two hashes that differ by at most 1 nibble per position
 *  can have checksum differences up to 192, but in practice the variance is
 *  ≤ 5 nibble positions (≥ 180-d checksum guard still prunes vast majority). */
export function hashChecksum(hash: string): number {
    let s = 0;
    for (let i = 0; i < 192; i++) s += parseInt(hash[i], 16);
    return s;
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** Format ms as mm:ss (e.g. "00:05"), or hh:mm:ss once an hour elapses. */
export function formatElapsed(ms: number): string {
    const total = Math.floor(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const mm = String(m).padStart(2, "0");
    const ss = String(s).padStart(2, "0");
    return h > 0
        ? `${String(h).padStart(2, "0")}:${mm}:${ss}`
        : `${mm}:${ss}`;
}
