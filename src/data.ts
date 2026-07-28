// data.ts — persistence and Bronzeman unlock logic
import * as a1lib from "alt1";
import * as Inventory from "./inventory";
import { state, LS_KEYS, log, showNotification } from "./core";

// ============================================================
// Types
// ============================================================

export interface UnlockedItemData {
    name: string;
    base64: string;  // base64 data URL of the item raster
    time: number;     // Date.now() when unlocked
}

// ============================================================
// State
// ============================================================

let unlockedItems: Set<string> = new Set();
let unlockedItemDataList: UnlockedItemData[] = [];

// ============================================================
// Persistence
// ============================================================

export function loadState(): void {
    loadIgnoredItems();
    try {
        const raw = localStorage.getItem(LS_KEYS.unlockedItems);
        if (raw) {
            unlockedItems = new Set(JSON.parse(raw));
            log(`Loaded ${unlockedItems.size} unlocked items.`);
        } else {
            localStorage.setItem(LS_KEYS.unlockedItems, JSON.stringify([]));
        }
        const rawData = localStorage.getItem(LS_KEYS.unlockedItemData);
        if (rawData) {
            unlockedItemDataList = JSON.parse(rawData);
            log(`Loaded ${unlockedItemDataList.length} unlocked item rasters.`);
        } else {
            localStorage.setItem(LS_KEYS.unlockedItemData, JSON.stringify([]));
        }
        if (!localStorage.getItem(LS_KEYS.scanHistory)) {
            localStorage.setItem(LS_KEYS.scanHistory, JSON.stringify([]));
        }
    } catch (e) { log("ERROR loading: " + e); }
}

function saveState(): void {
    try {
        localStorage.setItem(LS_KEYS.unlockedItems, JSON.stringify(Array.from(unlockedItems)));
        localStorage.setItem(LS_KEYS.unlockedItemData, JSON.stringify(unlockedItemDataList));
    }
    catch (e) { log("ERROR saving: " + e); }
}

// ============================================================
// Bronzeman logic
// ============================================================

export function unlockItem(itemName: string, base64: string = ""): boolean {
    const n = itemName.trim();
    if (!n || unlockedItems.has(n)) return false;
    unlockedItems.add(n);
    if (base64) {
        unlockedItemDataList.push({ name: n, base64, time: Date.now() });
    }
    saveState();
    addScanHistory(n, "unlocked");
    log(`UNLOCKED: "${n}"${base64 ? " (with raster)" : ""}`);
    if (state.inAlt1) showNotification("Unlocked: " + n, 3000, "success");
    return true;
}

export function isUnlocked(name: string): boolean { return unlockedItems.has(name.trim()); }
export function getUnlockedCount(): number { return unlockedItems.size; }
export function getUnlockedItems(): string[] { return Array.from(unlockedItems).sort(); }
export function getUnlockedItemData(): UnlockedItemData[] { return unlockedItemDataList; }

function addScanHistory(item: string, action: string): void {
    try {
        const raw = localStorage.getItem(LS_KEYS.scanHistory);
        const h: { item: string; action: string; time: string }[] = raw ? JSON.parse(raw) : [];
        h.push({ item, action, time: new Date().toISOString() });
        while (h.length > 500) h.shift();
        localStorage.setItem(LS_KEYS.scanHistory, JSON.stringify(h));
    } catch (e) { /* ignore */ }
}

// ============================================================
// Reset
// ============================================================

export function resetData(): void {
    if (!confirm("Delete all unlocked items and calibration?")) return;
    unlockedItems.clear();
    unlockedItemDataList = [];
    localStorage.removeItem(LS_KEYS.unlockedItems);
    localStorage.removeItem(LS_KEYS.unlockedItemData);
    localStorage.removeItem(LS_KEYS.scanHistory);
    localStorage.setItem(LS_KEYS.unlockedItems, JSON.stringify([]));
    localStorage.setItem(LS_KEYS.unlockedItemData, JSON.stringify([]));
    localStorage.setItem(LS_KEYS.scanHistory, JSON.stringify([]));
    Inventory.clearAnchor();
    Inventory.resetHashes();
    state.scanCount = 0;
    state.lastScanResult = null;
    log("All reset.");
}

export function resetUnlocks(): void {
    unlockedItems.clear();
    unlockedItemDataList = [];
    localStorage.setItem(LS_KEYS.unlockedItems, JSON.stringify([]));
    localStorage.setItem(LS_KEYS.unlockedItemData, JSON.stringify([]));
    log("Unlocks cleared.");
}

// ============================================================
// Ignore list
// ============================================================

export interface IgnoredItem {
    name: string | null;
    hash: string;
    ignoredAt: number;
}

let ignoredItems: IgnoredItem[] = [];

function loadIgnoredItems(): void {
    try {
        const raw = localStorage.getItem(LS_KEYS.ignores);
        ignoredItems = raw ? JSON.parse(raw) : [];
    } catch {
        ignoredItems = [];
    }
}

function saveIgnoredItems(): void {
    localStorage.setItem(LS_KEYS.ignores, JSON.stringify(ignoredItems));
}



export function isIgnored(hash: string): boolean {
    return ignoredItems.some(i => i.hash === hash);
}

export function ignoreItem(hash: string, name?: string): void {
    // Update name if entry already exists
    const existing = ignoredItems.find(i => i.hash === hash);
    if (existing) {
        if (name !== undefined) existing.name = name;
        saveIgnoredItems();
        return;
    }
    ignoredItems.push({ name: name ?? null, hash, ignoredAt: Date.now() });
    saveIgnoredItems();
}

export function getIgnoredItems(): IgnoredItem[] {
    return ignoredItems.slice();
}

export function getIgnoredCount(): number {
    return ignoredItems.length;
}

export function clearIgnoredItems(): void {
    ignoredItems = [];
    localStorage.removeItem(LS_KEYS.ignores);
}
