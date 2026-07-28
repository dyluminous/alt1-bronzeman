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
    base64?: string;
    ignoredAt: number;
}

let ignoredItems: IgnoredItem[] = [];

// ── IndexedDB ──────────────────────────────────────────────

const DB_NAME = "Bronzeman";
const DB_VERSION = 1;
const STORE_NAME = "ignores";

let idbReady = false;

function openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            if (!req.result.objectStoreNames.contains(STORE_NAME)) {
                req.result.createObjectStore(STORE_NAME, { keyPath: "hash" });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function dbPut(db: IDBDatabase, item: IgnoredItem): Promise<void> {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).put(item);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

function dbDelete(db: IDBDatabase, hash: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).delete(hash);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

function dbClear(db: IDBDatabase): Promise<void> {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        tx.objectStore(STORE_NAME).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

function dbGetAll(db: IDBDatabase): Promise<IgnoredItem[]> {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readonly");
        const req = tx.objectStore(STORE_NAME).getAll();
        req.onsuccess = () => resolve(req.result ?? []);
        req.onerror = () => reject(req.error);
    });
}

// ── Synced persistence (localStorage hot path + IndexedDB async) ──

let _db: IDBDatabase | null = null;

export async function initIgnoreDB(): Promise<void> {
    try {
        _db = await openDB();
        const dbItems = await dbGetAll(_db);
        if (dbItems.length > 0) {
            // IndexedDB has data — load it (includes base64 images)
            ignoredItems = dbItems;
            // Also sync to localStorage for fast future startups
            localStorage.setItem(LS_KEYS.ignores, JSON.stringify(dbItems.map(({ base64, ...rest }) => rest)));
        } else {
            // Check localStorage for migration
            const raw = localStorage.getItem(LS_KEYS.ignores);
            if (raw) {
                const lsItems: IgnoredItem[] = JSON.parse(raw);
                if (lsItems.length > 0) {
                    // Migrate: write each to IndexedDB
                    for (const item of lsItems) await dbPut(_db, item);
                    log(`Migrated ${lsItems.length} ignores from localStorage to IndexedDB.`);
                }
            }
        }
        idbReady = true;
        log(`Ignore DB ready: ${ignoredItems.length} item(s)`);
    } catch (e) {
        log(`IndexedDB init error (falling back to localStorage): ${e}`);
        idbReady = false;
    }
}

function loadIgnoredItems(): void {
    try {
        const raw = localStorage.getItem(LS_KEYS.ignores);
        ignoredItems = raw ? JSON.parse(raw) : [];
    } catch {
        ignoredItems = [];
    }
}

function dbSaveAll(): Promise<void> {
    return new Promise((resolve, reject) => {
        if (!idbReady || !_db) { resolve(); return; }
        const tx = _db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        store.clear();
        for (const item of ignoredItems) store.put(item);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

function saveIgnoredItems(): void {
    // Always save meta to localStorage (sync — ensures hot path works on next startup)
    localStorage.setItem(LS_KEYS.ignores, JSON.stringify(ignoredItems.map(({ base64, ...rest }) => rest)));
    // Also save to IndexedDB if ready (async — includes base64 images)
    dbSaveAll().catch(() => {});
}



export function isIgnored(hash: string): boolean {
    return ignoredItems.some(i => i.hash === hash);
}

export function ignoreItem(hash: string, name?: string, base64?: string): void {
    // Update name if entry already exists
    const existing = ignoredItems.find(i => i.hash === hash);
    if (existing) {
        if (name !== undefined) existing.name = name;
        if (base64 !== undefined) existing.base64 = base64;
        saveIgnoredItems();
        return;
    }
    ignoredItems.push({ name: name ?? null, hash, base64, ignoredAt: Date.now() });
    saveIgnoredItems();
}

export function getIgnoredItems(): IgnoredItem[] {
    return ignoredItems.slice();
}

export function getIgnoredCount(): number {
    return ignoredItems.length;
}

export function removeIgnoredItem(hash: string): void {
    ignoredItems = ignoredItems.filter(i => i.hash !== hash);
    saveIgnoredItems();
}

export function clearIgnoredItems(): void {
    ignoredItems = [];
    localStorage.removeItem(LS_KEYS.ignores);
    if (idbReady && _db) dbClear(_db).catch(() => {});
}

export function fillTestIgnores(): void {
    if (ignoredItems.length === 0) return;
    const originals = ignoredItems.slice();
    const target = 5000;
    let i = 0;
    while (ignoredItems.length < target) {
        const src = originals[i % originals.length];
        const suffix = (ignoredItems.length).toString(16).padStart(8, '0');
        ignoredItems.push({
            name: src.name ? `${src.name} #${ignoredItems.length}` : null,
            hash: src.hash.slice(0, 56) + suffix,
            base64: undefined,
            ignoredAt: Date.now()
        });
        i++;
    }
    saveIgnoredItems();
}
