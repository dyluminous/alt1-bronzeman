// data.ts — persistence and Bronzeman unlock logic
import * as a1lib from "alt1";
import * as Inventory from "./inventory";
import { state, LS_KEYS, log, showOverlay } from "./core";

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
    if (state.inAlt1) showOverlay(`Unlocked: ${n}`, a1lib.mixColor(100, 255, 100), 3000);
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
