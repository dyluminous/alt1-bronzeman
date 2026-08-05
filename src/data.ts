// data.ts — persistence and Bronzeman unlock logic
import * as a1lib from "alt1";
import * as Inventory from "./inventory";
import { state, LS_KEYS, log, showOverlay } from "./core";

// ============================================================
// State
// ============================================================

let unlockedItems: Set<string> = new Set();

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
        if (!localStorage.getItem(LS_KEYS.scanHistory)) {
            localStorage.setItem(LS_KEYS.scanHistory, JSON.stringify([]));
        }
    } catch (e) { log("ERROR loading: " + e); }
}

function saveState(): void {
    try { localStorage.setItem(LS_KEYS.unlockedItems, JSON.stringify(Array.from(unlockedItems))); }
    catch (e) { log("ERROR saving: " + e); }
}

// ============================================================
// Bronzeman logic
// ============================================================

export function unlockItem(itemName: string): boolean {
    const n = itemName.trim();
    if (!n || unlockedItems.has(n)) return false;
    unlockedItems.add(n);
    saveState();
    addScanHistory(n, "unlocked");
    log(`UNLOCKED: "${n}"`);
    if (state.inAlt1) showOverlay(`Unlocked: ${n}`, a1lib.mixColor(100, 255, 100), 3000);
    return true;
}

export function isUnlocked(name: string): boolean { return unlockedItems.has(name.trim()); }
export function getUnlockedCount(): number { return unlockedItems.size; }
export function getUnlockedItems(): string[] { return Array.from(unlockedItems).sort(); }

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
    localStorage.removeItem(LS_KEYS.unlockedItems);
    localStorage.removeItem(LS_KEYS.scanHistory);
    localStorage.setItem(LS_KEYS.unlockedItems, JSON.stringify([]));
    localStorage.setItem(LS_KEYS.scanHistory, JSON.stringify([]));
    Inventory.clearAnchor();
    Inventory.resetHashes();
    state.scanCount = 0;
    state.lastScanResult = null;
    log("All reset.");
}
