// recent-unlocks.ts — session-only ring buffer of the last 8 unlocked items.
// Each entry stores the item name and the 36×32 interior pixels captured at
// unlock time. Data is held in memory only and resets on reload.

interface RecentEntry {
    name: string;
    /** Raw RGBA pixel data — 36 × 32 × 4 bytes */
    pixels: Uint8ClampedArray;
}

const MAX = 8;
const entries: RecentEntry[] = [];

/** Push a newly-unlocked item onto the front of the list (max 8). */
export function recordUnlock(name: string, pixels: Uint8ClampedArray): void {
    entries.unshift({ name, pixels });
    if (entries.length > MAX) entries.length = MAX;
}

/** Snapshot of the buffer — newest first. */
export function getRecentUnlocks(): ReadonlyArray<RecentEntry> {
    return entries;
}
