// data.ts — persistence and Bronzeman unlock logic
import { inventory } from "./inventory";
import { state, LS_KEYS, log, showNotification } from "./core";

// ============================================================
// Types
// ============================================================

interface UnlockedItemData {
    name: string;
    base64: string;  // base64 data URL of the item raster
    time: number;     // Date.now() when unlocked
}

/** One item record in the unlock IndexedDB stores. */
export interface UnlockedItemRecord {
    name: string;
    tradeable: boolean;
    stackable: boolean;
    /** Every known interior hash for this item (stackables can have several). */
    hashes: string[];
    unlockedAt: number;
}

// ============================================================
// State
// ============================================================

let unlockedItems: Set<string> = new Set();
let unlockedItemDataList: UnlockedItemData[] = [];

/** Flat hash lookup — the O(1) hot path used by the scan tick. */
let unlockedHashes: Set<string> = new Set();
/** Names already in the unlock DB — a name hit means "append hash, no notify". */
let unlockedNames: Set<string> = new Set();

// ============================================================
// IndexedDB — unlock storage (tradable + untradable stores)
// ============================================================

const DB_NAME = "Bronzeman";
const DB_VERSION = 2;
const STORE_TRADABLE = "unlocks_tradable";
const STORE_UNTRADABLE = "unlocks_untradable";

let _db: IDBDatabase | null = null;

function openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            // v1 had an "ignores" store — now unused, drop it.
            if (db.objectStoreNames.contains("ignores")) {
                db.deleteObjectStore("ignores");
            }
            if (!db.objectStoreNames.contains(STORE_TRADABLE)) {
                db.createObjectStore(STORE_TRADABLE, { keyPath: "name" });
            }
            if (!db.objectStoreNames.contains(STORE_UNTRADABLE)) {
                db.createObjectStore(STORE_UNTRADABLE, { keyPath: "name" });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function dbGetAll(db: IDBDatabase, storeName: string): Promise<UnlockedItemRecord[]> {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, "readonly");
        const req = tx.objectStore(storeName).getAll();
        req.onsuccess = () => resolve(req.result ?? []);
        req.onerror = () => reject(req.error);
    });
}

/** Fetch a single record by its name key (keyPath: "name"). */
function dbGetByKey(db: IDBDatabase, storeName: string, name: string): Promise<UnlockedItemRecord | undefined> {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, "readonly");
        const req = tx.objectStore(storeName).get(name);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

/** Public access to one unlock record. store: "tradable" | "untradable". */
export async function getItemRecord(store: string, name: string): Promise<UnlockedItemRecord | undefined> {
    if (!_db) return undefined;
    const storeName = store === "untradable" ? STORE_UNTRADABLE : STORE_TRADABLE;
    return dbGetByKey(_db, storeName, name);
}

/** Render an 8×8 brightness-grid PNG (one cell per hash char, scaled) as a data URL. */
export function hashToPngDataUrl(hash: string, scale: number): string {
    const canvas = document.createElement("canvas");
    canvas.width = 8 * scale;
    canvas.height = 8 * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";
    for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
            const v = parseInt(hash[y * 8 + x] ?? "0", 16);
            const lum = Math.round((v / 15) * 255);
            ctx.fillStyle = `rgb(${lum},${lum},${lum})`;
            ctx.fillRect(x * scale, y * scale, scale, scale);
        }
    }
    return canvas.toDataURL("image/png");
}

function dbPut(db: IDBDatabase, storeName: string, record: UnlockedItemRecord): Promise<void> {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, "readwrite");
        tx.objectStore(storeName).put(record);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

function dbClear(db: IDBDatabase, storeName: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, "readwrite");
        tx.objectStore(storeName).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

/** Open the DB, load both unlock stores, rebuild the flat hash Set.
 *  Also migrates any localStorage unlockedHashes from the old scheme. */
export async function initUnlockDB(): Promise<void> {
    try {
        _db = await openDB();
        const [tradable, untradable] = await Promise.all([
            dbGetAll(_db, STORE_TRADABLE),
            dbGetAll(_db, STORE_UNTRADABLE),
        ]);

        // Migrate the old localStorage hash list into the tradable store once.
        const rawHashes = localStorage.getItem(LS_KEYS.unlockedHashes);
        if (rawHashes) {
            const legacy: string[] = JSON.parse(rawHashes);
            if (legacy.length > 0) {
                const existing = new Set<string>();
                for (const r of [...tradable, ...untradable]) for (const h of r.hashes) existing.add(h);
                const fresh = legacy.filter(h => !existing.has(h));
                if (fresh.length > 0) {
                    const rec: UnlockedItemRecord = {
                        name: "(unknown)",
                        tradeable: true,
                        stackable: false,
                        hashes: fresh,
                        unlockedAt: Date.now(),
                    };
                    await dbPut(_db, STORE_TRADABLE, rec);
                    log(`Migrated ${fresh.length} legacy hashes to IndexedDB.`);
                }
            }
            localStorage.removeItem(LS_KEYS.unlockedHashes);
        }

        for (const r of [...tradable, ...untradable]) {
            for (const h of r.hashes) unlockedHashes.add(h);
            unlockedNames.add(r.name);
        }
        log(`Unlock DB ready: ${tradable.length} tradable, ${untradable.length} untradable, ${unlockedHashes.size} hashes.`);
    } catch (e) {
        log(`Unlock DB init error: ${e}`);
    }
}

/** Record an unlocked item (called after the wiki query resolves). Routes to
 *  the tradable/untradable store by tradeable flag; appends the hash so
 *  stackable quantity variants share one record. Idempotent by name — a name
 *  already in the DB appends silently (no notification), only genuinely new
 *  names notify. */
export function addUnlockedItem(name: string, tradeable: boolean, stackable: boolean, hash: string): void {
    const store = tradeable ? STORE_TRADABLE : STORE_UNTRADABLE;
    if (unlockedHashes.has(hash)) {
        log(`Hash already unlocked for "${name}" — skipped.`);
        return;
    }
    unlockedHashes.add(hash);
    const isNewName = !unlockedNames.has(name);
    if (isNewName) unlockedNames.add(name);

    // Load the record, append the hash, persist. If the DB isn't ready yet,
    // the hash is in memory and the record is lost on reload — acceptable
    // while the async init finishes (ms).
    const persist = async (): Promise<void> => {
        if (!_db) return;
        const existing = (await dbGetAll(_db, store)).find(r => r.name === name);
        if (existing) {
            if (!existing.hashes.includes(hash)) existing.hashes.push(hash);
            await dbPut(_db, store, existing);
        } else {
            const rec: UnlockedItemRecord = {
                name, tradeable, stackable, hashes: [hash], unlockedAt: Date.now(),
            };
            await dbPut(_db, store, rec);
        }
    };
    void persist();
    if (isNewName) {
        log(`UNLOCKED: "${name}" (${tradeable ? "tradable" : "untradable"}, ${stackable ? "stackable" : "non-stackable"}) hash=${hash.slice(0, 12)}…`);
        if (state.inAlt1) showNotification("Unlocked: " + name, 3000, "success");
    } else {
        log(`New hash appended to existing item "${name}" (${hash.slice(0, 12)}…)`);
    }
}

export function isHashUnlocked(hash: string): boolean {
    return unlockedHashes.has(hash);
}

/** Debug: log every record in the tradable unlock store to the console. */
export async function dumpTradableUnlocks(): Promise<void> {
    if (!_db) { log("[diag] Unlock DB not ready"); return; }
    try {
        console.table(await dbGetAll(_db, STORE_TRADABLE));
    } catch (e) {
        log(`[diag] dump error: ${e}`);
    }
}

/** Debug: log every record in the untradable unlock store to the console. */
export async function dumpUntradableUnlocks(): Promise<void> {
    if (!_db) { log("[diag] Unlock DB not ready"); return; }
    try {
        console.table(await dbGetAll(_db, STORE_UNTRADABLE));
    } catch (e) {
        log(`[diag] dump error: ${e}`);
    }
}

/** Debug: log the hashes array of one item record. store: "tradable" | "untradable". */
export async function dumpItemHashes(store: string, name: string): Promise<void> {
    if (!_db) { log("[diag] Unlock DB not ready"); return; }
    const storeName = store === "untradable" ? STORE_UNTRADABLE : STORE_TRADABLE;
    try {
        const rec = await dbGetByKey(_db, storeName, name);
        if (!rec) {
            log(`[diag] no record "${name}" in ${storeName}`);
            return;
        }
        console.log(`[diag] "${rec.name}" hashes (${rec.hashes.length}):`);
        rec.hashes.forEach((h, i) => console.log(`  [${i}] ${h}`));
    } catch (e) {
        log(`[diag] dump error: ${e}`);
    }
}

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
    log(`UNLOCKED: "${n}"${base64 ? " (with raster)" : ""}`);
    if (state.inAlt1) showNotification("Unlocked: " + n, 3000, "success");
    return true;
}

export function isUnlocked(name: string): boolean { return unlockedItems.has(name.trim()); }
export function getUnlockedCount(): number { return unlockedItems.size; }
export function getUnlockedItems(): string[] { return Array.from(unlockedItems).sort(); }
export function getUnlockedItemData(): UnlockedItemData[] { return unlockedItemDataList; }

// ============================================================
// Reset
// ============================================================

export function resetData(): void {
    if (!confirm("Delete all unlocked items and calibration?")) return;
    unlockedItems.clear();
    unlockedItemDataList = [];
    unlockedHashes.clear();
    unlockedNames.clear();
    localStorage.removeItem(LS_KEYS.unlockedItems);
    localStorage.removeItem(LS_KEYS.unlockedItemData);
    localStorage.setItem(LS_KEYS.unlockedItems, JSON.stringify([]));
    localStorage.setItem(LS_KEYS.unlockedItemData, JSON.stringify([]));
    if (_db) {
        void dbClear(_db, STORE_TRADABLE).catch(() => {});
        void dbClear(_db, STORE_UNTRADABLE).catch(() => {});
    }
    inventory.clear();
    log("All reset.");
}

export function resetUnlocks(): void {
    unlockedItems.clear();
    unlockedItemDataList = [];
    unlockedHashes.clear();
    unlockedNames.clear();
    localStorage.setItem(LS_KEYS.unlockedItems, JSON.stringify([]));
    localStorage.setItem(LS_KEYS.unlockedItemData, JSON.stringify([]));
    if (_db) {
        void dbClear(_db, STORE_TRADABLE).catch(() => {});
        void dbClear(_db, STORE_UNTRADABLE).catch(() => {});
    }
    log("Unlocks cleared.");
}
