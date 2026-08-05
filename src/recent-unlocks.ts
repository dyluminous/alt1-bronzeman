// recent-unlocks.ts — ring buffer of the last 8 items unlocked, persisted via
// IndexedDB and rehydrated on boot. Images are resolved from the wiki CDN.
import { log } from "./core";
import { updateUI } from "./ui";
import { getRecentRecords, type UnlockedItemRecord, type HashEntry } from "./data";

interface RecentEntry {
    name: string;
    imageUrl: string;
    displayLabel: string;
}

const MAX = 8;
const entries: RecentEntry[] = [];

/** Push a newly-unlocked item onto the front. Called from dot-hover. */
export async function recordUnlock(name: string, imageUrl: string, displayLabel: string): Promise<void> {
    entries.unshift({ name, imageUrl, displayLabel });
    if (entries.length > MAX) entries.length = MAX;
    updateUI();
}

/** Populate the buffer from the last 8 hash unlocks across all records. */
export async function initRecentUnlocks(): Promise<void> {
    const recs = await getRecentRecords(MAX);
    // One display entry per hash (not per record) — so multiple stackable
    // tiers of the same item each get their own slot.
    const flat: { rec: UnlockedItemRecord; entry: HashEntry }[] = [];
    for (const rec of recs) {
        for (const h of rec.hashes) flat.push({ rec, entry: h });
    }
    flat.sort((a, b) => b.entry.addedOn - a.entry.addedOn);
    for (let i = 0; i < flat.length && entries.length < MAX; i++) {
        const { rec, entry: h } = flat[i];
        const qty = h.stackableQuantity;
        const displayLabel = qty != null ? `${rec.name} (${qty})` : rec.name;
        const { url } = await resolveImageUrl(rec.name, qty);
        entries.push({ name: rec.name, imageUrl: url, displayLabel });
    }
    updateUI();
}

/** Snapshot of the buffer — newest first. */
export function getRecentUnlocks(): ReadonlyArray<RecentEntry> {
    return entries;
}

// ----------------------------------------------------------
// Wiki CDN URL helpers
// ----------------------------------------------------------

const WIKI_IMAGES = "https://runescape.wiki/images";

/** Build a wiki CDN URL for an item filename. Spaces → underscore,
 *  everything else (including brackets) stays as-is. */
function imageUrlFor(filename: string): string {
    return `${WIKI_IMAGES}/${filename.replace(/ /g, "_")}`;
}

/** Try to resolve a wiki CDN image URL via HEAD request. Returns the URL on
 *  200, or empty string on failure (404, network error, etc). */
async function probeUrl(url: string): Promise<string> {
    try {
        const res = await fetch(url, { method: "HEAD" });
        if (res.ok) return url;
        // 404 or other non-ok → fall through to fallback
    } catch { /* network error → fall through */ }
    return "";
}

/** Build a filename from item name + optional stackable tier, e.g.
 *  "Radiant energy", 500 → "Radiant energy 500.png". */
function buildFilename(name: string, qtyTier?: number | null): string {
    const base = qtyTier != null ? `${name} ${qtyTier}` : name;
    return `${base}.png`;
}

/** Resolve a wiki image URL for the given item. Tries the exact name first;
 *  on 404 strips a trailing parenthesised suffix (e.g. "(empty)") and retries
 *  once. Returns the resolved URL or empty string. */
export async function resolveImageUrl(name: string, qtyTier?: number | null): Promise<{ url: string; displayLabel: string }> {
    const label = qtyTier != null ? `${name} (${qtyTier})` : name;
    const filename = buildFilename(name, qtyTier);
    const url = imageUrlFor(filename);
    const ok = await probeUrl(url);
    if (ok) return { url: ok, displayLabel: label };

    // Fallback: strip trailing "(…)" and retry.
    const stripped = name.replace(/\s*\([^)]*\)\s*$/, "").trim();
    if (stripped && stripped !== name) {
        const altFile = buildFilename(stripped, qtyTier);
        const altUrl = imageUrlFor(altFile);
        const altOk = await probeUrl(altUrl);
        if (altOk) return { url: altOk, displayLabel: label };
    }

    log(`Wiki image not found for "${name}"${qtyTier != null ? ` (tier ${qtyTier})` : ""}`);
    return { url: "", displayLabel: label };
}
