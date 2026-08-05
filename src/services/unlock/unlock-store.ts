// unlock-store.ts — UnlockStore: IndexedDB persistence + in-memory unlock lookup
import { state, log, showNotification } from "../../core";
import { lowerHalfOf, nibbleTolerantMatch } from "../../utils/hash";
import { hashChecksum } from "../../utils/helpers";
import type { HashEntry, UnlockedItemRecord, SearchEntry } from "../../types";

export type { HashEntry, UnlockedItemRecord, SearchEntry } from "../../types";

// ============================================================
// UnlockStore — IndexedDB (tradable + untradable stores) plus the
// in-memory Sets that back the scan tick's O(1) lookups
// ============================================================

const DB_NAME = "Bronzeman";
const DB_VERSION = 2;
const STORE_TRADABLE = "unlocks_tradable";
const STORE_UNTRADABLE = "unlocks_untradable";

class UnlockStore {
    private _db: IDBDatabase | null = null;

    /** Flat hash lookup — the O(1) hot path used by the scan tick. */
    private hashes: Set<string> = new Set();
    /** Checksum → hash[] — pre-filter for nibble-tolerant scan (login-out
     *  colour variance: the same item can render with ±1 nibble shifts in
     *  1-2 cells). Exact Set is checked first (O(1)); this index only runs
     *  when the exact lookup fails, which is rare. */
    private hashByChecksum: Map<number, string[]> = new Map();
    /** Names already in the unlock DB — a name hit means "append hash, no notify". */
    private names: Set<string> = new Set();
    /** Names of unlocked tradable items — synchronous O(1) lookup for the GE
     *  debug overlay so the icon draw path never touches IndexedDB. */
    private unlockedTradableNames: Set<string> = new Set();
    /** Quantity-invariant lower-half slice (cell rows 3–7) → record name. The
     *  scan tick consults this ONLY for slots proven stackable by the
     *  digit-color check (slot.isStackable), so a lower-half hit means
     *  "stackable variant of an already-unlocked item" → no dot. */
    private lowerHalfIndex: Map<string, string> = new Map();

    /** In-memory search index — light array of {name, tradeable} rebuilt at
     *  init and kept in sync on add / reset / restore. Read-only consumers
     *  use the exported accessor; mutations go through this cache directly. */
    private searchIndex: SearchEntry[] = [];

    private get ready(): boolean { return this._db !== null; }

    private storeName(store: string): string {
        return store === "untradable" ? STORE_UNTRADABLE : STORE_TRADABLE;
    }

    private addHashToChecksum(hash: string): void {
        const cs = hashChecksum(hash);
        const bucket = this.hashByChecksum.get(cs);
        if (bucket) bucket.push(hash);
        else this.hashByChecksum.set(cs, [hash]);
    }

    // ----------------------------------------------------------
    // IndexedDB helpers
    // ----------------------------------------------------------

    private openDB(): Promise<IDBDatabase> {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = () => {
                const db = req.result;
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

    private getAll(storeName: string): Promise<UnlockedItemRecord[]> {
        return new Promise((resolve, reject) => {
            const tx = this._db!.transaction(storeName, "readonly");
            const req = tx.objectStore(storeName).getAll();
            req.onsuccess = () => resolve(req.result ?? []);
            req.onerror = () => reject(req.error);
        });
    }

    /** Total number of unlock records across both stores. */
    countAll(): Promise<number> {
        if (!this.ready) return Promise.resolve(0);
        return Promise.all([
            this.count(STORE_TRADABLE),
            this.count(STORE_UNTRADABLE),
        ]).then(([a, b]) => a + b);
    }

    /** Number of tradable unlock records. */
    countTradable(): Promise<number> {
        if (!this.ready) return Promise.resolve(0);
        return this.count(STORE_TRADABLE);
    }

    private count(storeName: string): Promise<number> {
        return new Promise((resolve, reject) => {
            const tx = this._db!.transaction(storeName, "readonly");
            const req = tx.objectStore(storeName).count();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    private getByKey(storeName: string, name: string): Promise<UnlockedItemRecord | undefined> {
        return new Promise((resolve, reject) => {
            const tx = this._db!.transaction(storeName, "readonly");
            const req = tx.objectStore(storeName).get(name);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    private put(storeName: string, record: UnlockedItemRecord): Promise<void> {
        return new Promise((resolve, reject) => {
            const tx = this._db!.transaction(storeName, "readwrite");
            tx.objectStore(storeName).put(record);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    private clear(storeName: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const tx = this._db!.transaction(storeName, "readwrite");
            tx.objectStore(storeName).clear();
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    // ----------------------------------------------------------
    // Public API
    // ----------------------------------------------------------

    /** Open the DB, load both unlock stores, rebuild the flat hash Set. */
    async init(): Promise<void> {
        try {
            this._db = await this.openDB();
            const [tradable, untradable] = await Promise.all([
                this.getAll(STORE_TRADABLE),
                this.getAll(STORE_UNTRADABLE),
            ]);
            this.rebuildIndexes([...tradable, ...untradable]);
            log(`Unlock DB ready: ${tradable.length} tradable, ${untradable.length} untradable, ${this.hashes.size} hashes.`);
        } catch (e) {
            log(`Unlock DB init error: ${e}`);
        }
    }

    /** Rebuild the in-memory hash lookup, name set, and quantity-invariant
     *  lower-half index from the given records. Used at init and after restore.
     *  The lower half of every hash is indexed with no flag filter — the scan
     *  tick only consults it for yellow-detected stackable slots, so
     *  non-stackables never reach it. */
    private rebuildIndexes(records: UnlockedItemRecord[]): void {
        this.hashes.clear();
        this.hashByChecksum.clear();
        this.names.clear();
        this.lowerHalfIndex.clear();
        this.searchIndex.length = 0;
        for (const r of records) {
            for (const h of r.hashes) {
                this.hashes.add(h.hash);
                this.addHashToChecksum(h.hash);
                this.lowerHalfIndex.set(lowerHalfOf(h.hash), r.name);
            }
            this.names.add(r.name);
            if (r.tradeable) this.unlockedTradableNames.add(r.name);
            this.searchIndex.push({ name: r.name, tradeable: r.tradeable });
        }
    }

    /** Return records sorted by lastUpdatedOn desc, limited to `limit`. */
    async getRecentRecords(limit = 8): Promise<UnlockedItemRecord[]> {
        if (!this.ready) return [];
        const all = [...(await this.getAll(this.storeName("tradable"))), ...(await this.getAll(this.storeName("untradable")))];
        return all.sort((a, b) => b.lastUpdatedOn - a.lastUpdatedOn).slice(0, limit);
    }

    /** One unlock record by store ("tradable" | "untradable") and name. */
    async getRecord(store: string, name: string): Promise<UnlockedItemRecord | undefined> {
        if (!this.ready) return undefined;
        return this.getByKey(this.storeName(store), name);
    }

    /** Record an unlocked item (called after the wiki query resolves). Routes
     *  to the tradable/untradable store by tradeable flag; appends the hash so
     *  stackable quantity variants share one record. Idempotent by name — a
     *  name already in the DB appends silently (no notification), only
     *  genuinely new names notify. */
    add(name: string, tradeable: boolean, hash: string, stackableQuantity: number | null = null, force = false): void {
        const store = this.storeName(tradeable ? "tradable" : "untradable");
        if (!force && this.hashes.has(hash)) {
            log(`Hash already unlocked for "${name}" — skipped.`);
            return;
        }
        this.hashes.add(hash);
        this.addHashToChecksum(hash);
        this.lowerHalfIndex.set(lowerHalfOf(hash), name);
        const entry: HashEntry = { hash, stackableQuantity, addedOn: Date.now() };
        const isNewName = !this.names.has(name);
        if (isNewName) {
            this.names.add(name);
            if (tradeable) this.unlockedTradableNames.add(name);
            this.searchIndex.push({ name, tradeable });
        }

        // Load the record, append the hash, persist. If the DB isn't ready
        // yet, the hash is in memory and the record is lost on reload —
        // acceptable while the async init finishes (ms).
        const persist = async (): Promise<void> => {
            if (!this.ready) return;
            const existing = (await this.getAll(store)).find(r => r.name === name);
            if (existing) {
                if (!existing.hashes.some(h => h.hash === hash)) existing.hashes.push(entry);
                existing.lastUpdatedOn = Date.now();
                await this.put(store, existing);
            } else {
                const rec: UnlockedItemRecord = {
                    name, tradeable, hashes: [entry], lastUpdatedOn: Date.now(),
                };
                await this.put(store, rec);
            }
        };
        void persist();
        if (isNewName) {
            log(`UNLOCKED: "${name}" (${tradeable ? "tradable" : "untradable"}) hash=${hash.slice(0, 12)}…`);
            if (state.inAlt1) showNotification("Unlocked: " + name, 3000, "success");
        } else {
            log(`New hash appended to existing item "${name}" (${hash.slice(0, 12)}…)`);
        }
    }

    isHashUnlocked(hash: string): boolean {
        return this.hashes.has(hash);
    }

    /** Nibble-tolerant unlock check — for items whose hash varies by ±1
     *  nibble across login sessions (same item, slightly different render).
     *  Uses a checksum pre-filter to avoid scanning all stored hashes;
     *  only the ±5 checksum buckets are scanned with full nibble tolerance.
     *  Called ONLY when the exact Set lookup returns false (rare). */
    isHashNibbleUnlocked(hash: string): boolean {
        const cs = hashChecksum(hash);
        for (let d = -5; d <= 5; d++) {
            const bucket = this.hashByChecksum.get(cs + d);
            if (!bucket) continue;
            for (const stored of bucket) {
                if (nibbleTolerantMatch(hash, stored)) return true;
            }
        }
        return false;
    }

    /** Synchronous O(1) check — returns true when `name` is in the unlocked
     *  tradable names set. Used by the GE debug overlay to avoid IndexedDB
     *  calls on every tick. */
    isNameUnlocked(name: string): boolean {
        return this.unlockedTradableNames.has(name);
    }

    /** Return a read-only snapshot of the in-memory search index. The array
     *  is defensively copied so consumers can't mutate the canonical cache. */
    getSearchIndex(): ReadonlyArray<SearchEntry> {
        return this.searchIndex.slice();
    }

    /** True when the hash's lower-half slice matches an already-unlocked item's
     *  lower half. Only meaningful for yellow-detected stackable slots — a hit
     *  means the item is a quantity-variant of something already unlocked. */
    isLowerHalfUnlocked(lowerHalf: string): boolean {
        return this.lowerHalfIndex.has(lowerHalf);
    }

    /** Debug: log every record in the tradable unlock store to the console. */
    async dumpTradable(): Promise<void> {
        if (!this.ready) { log("[diag] Unlock DB not ready"); return; }
        try {
            console.table(await this.getAll(STORE_TRADABLE));
        } catch (e) {
            log(`[diag] dump error: ${e}`);
        }
    }

    /** Debug: log every record in the untradable unlock store to the console. */
    async dumpUntradable(): Promise<void> {
        if (!this.ready) { log("[diag] Unlock DB not ready"); return; }
        try {
            console.table(await this.getAll(STORE_UNTRADABLE));
        } catch (e) {
            log(`[diag] dump error: ${e}`);
        }
    }

    /** Debug: log the hashes array of one item record.
     *  store: "tradable" | "untradable". */
    async dumpItemHashes(store: string, name: string): Promise<void> {
        if (!this.ready) { log("[diag] Unlock DB not ready"); return; }
        const storeName = this.storeName(store);
        try {
            const rec = await this.getByKey(storeName, name);
            if (!rec) {
                log(`[diag] no record "${name}" in ${storeName}`);
                return;
            }
            console.log(`[diag] "${rec.name}" hashes (${rec.hashes.length}):`);
            rec.hashes.forEach((h, i) => console.log(`  [${i}] ${h.hash} qty=${h.stackableQuantity ?? "-"} added=${new Date(h.addedOn).toISOString()}`));
        } catch (e) {
            log(`[diag] dump error: ${e}`);
        }
    }

    /** Clear every unlock (both stores + all in-memory indexes). */
    resetUnlocks(): void {
        this.hashes.clear();
        this.hashByChecksum.clear();
        this.names.clear();
        this.unlockedTradableNames.clear();
        this.lowerHalfIndex.clear();
        this.searchIndex.length = 0;
        if (this.ready) {
            void this.clear(STORE_TRADABLE).catch(() => {});
            void this.clear(STORE_UNTRADABLE).catch(() => {});
        }
        log("Unlocks cleared.");
    }

    /** Serialize every unlock record in both stores to a JSON string with a
     *  version header, ready to be written to a backup file. */
    async exportUnlockData(): Promise<string> {
        if (!this.ready) throw new Error("Unlock DB not ready");
        const [tradable, untradable] = await Promise.all([
            this.getAll(STORE_TRADABLE),
            this.getAll(STORE_UNTRADABLE),
        ]);
        return JSON.stringify({
            version: 1,
            exportedOn: Date.now(),
            stores: {
                tradable,
                untradable,
            },
        }, null, 2);
    }

    /** Replace the entire unlock DB with the contents of a backup export.
     *  Parses + validates the JSON, then clears both stores and writes every
     *  record inside a single transaction, and rebuilds the in-memory indexes
     *  (hashes / names / lowerHalfIndex) so lookups keep working. Throws on
     *  malformed input — nothing is touched before validation passes. */
    async importUnlockData(json: string): Promise<void> {
        if (!this.ready) throw new Error("Unlock DB not ready");
        let parsed: unknown;
        try {
            parsed = JSON.parse(json);
        } catch {
            throw new Error("Invalid backup file: not valid JSON");
        }
        const doc = parsed as Record<string, unknown>;
        if (doc?.version !== 1) throw new Error("Unsupported backup version");
        const tradable: UnlockedItemRecord[] = Array.isArray((doc?.stores as Record<string, unknown>)?.tradable) ? (doc.stores as Record<string, unknown>).tradable as UnlockedItemRecord[] : [];
        const untradable: UnlockedItemRecord[] = Array.isArray((doc?.stores as Record<string, unknown>)?.untradable) ? (doc.stores as Record<string, unknown>).untradable as UnlockedItemRecord[] : [];
        const isRecord = (r: unknown): r is UnlockedItemRecord =>
            !!r && typeof (r as Record<string, unknown>).name === "string" && Array.isArray((r as Record<string, unknown>).hashes);
        if (!tradable.every(isRecord) || !untradable.every(isRecord)) {
            throw new Error("Invalid backup file: malformed records");
        }

        // Single readwrite transaction across both stores: clear + rewrite.
        await new Promise<void>((resolve, reject) => {
            const tx = this._db!.transaction([STORE_TRADABLE, STORE_UNTRADABLE], "readwrite");
            tx.objectStore(STORE_TRADABLE).clear();
            tx.objectStore(STORE_UNTRADABLE).clear();
            for (const r of tradable) tx.objectStore(STORE_TRADABLE).put(r);
            for (const r of untradable) tx.objectStore(STORE_UNTRADABLE).put(r);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });

        // Rebuild the in-memory indexes from the restored records.
        this.rebuildIndexes([...tradable, ...untradable]);
        log(`Unlock DB restored: ${tradable.length} tradable, ${untradable.length} untradable, ${this.hashes.size} hashes.`);
    }
}

/** Module-wide singleton. */
const unlockStore = new UnlockStore();

// ============================================================
// Re-exports — keep the module's public API surface stable for
// importers (index.ts, ui.ts, slot-scan.ts, overlay.ts)
// ============================================================

export const initUnlockDB = (): Promise<void> => unlockStore.init();
export const getRecentRecords = (limit = 8): Promise<UnlockedItemRecord[]> => unlockStore.getRecentRecords(limit);
export const getItemRecord = (store: string, name: string): Promise<UnlockedItemRecord | undefined> => unlockStore.getRecord(store, name);
export const getUnlockCount = (): Promise<number> => unlockStore.countAll();
export const getTradableUnlockCount = (): Promise<number> => unlockStore.countTradable();
export const getSearchIndex = (): ReadonlyArray<SearchEntry> => unlockStore.getSearchIndex();
export const addUnlockedItem = (name: string, tradeable: boolean, hash: string, stackableQuantity: number | null = null, force = false): void => unlockStore.add(name, tradeable, hash, stackableQuantity, force);
export const isHashUnlocked = (hash: string): boolean => unlockStore.isHashUnlocked(hash);
export const isHashNibbleUnlocked = (hash: string): boolean => unlockStore.isHashNibbleUnlocked(hash);
export const isLowerHalfUnlocked = (lowerHalf: string): boolean => unlockStore.isLowerHalfUnlocked(lowerHalf);
export const isNameUnlocked = (name: string): boolean => unlockStore.isNameUnlocked(name);
export const dumpTradableUnlocks = (): Promise<void> => unlockStore.dumpTradable();
export const dumpUntradableUnlocks = (): Promise<void> => unlockStore.dumpUntradable();
export const dumpItemHashes = (store: string, name: string): Promise<void> => unlockStore.dumpItemHashes(store, name);
export const resetUnlocks = (): void => unlockStore.resetUnlocks();
export const exportUnlockData = (): Promise<string> => unlockStore.exportUnlockData();
export const importUnlockData = (json: string): Promise<void> => unlockStore.importUnlockData(json);

// ============================================================
// Debug rendering — hash → colour-grid PNG for the debug panes
// ============================================================

/** Render an 8×8 grid PNG from a 192-char hash (3 hex nibbles per cell: R, G,
 *  B channel averages) as a data URL. Cells render in their actual colour —
 *  each nibble ×17 recovers the channel average. */
export function hashToPngDataUrl(hash: string, scale: number): string {
    const canvas = document.createElement("canvas");
    canvas.width = 8 * scale;
    canvas.height = 8 * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) return "";
    for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
            const i = (y * 8 + x) * 3;
            const r = parseInt(hash[i] ?? "0", 16) * 17;
            const g = parseInt(hash[i + 1] ?? "0", 16) * 17;
            const b = parseInt(hash[i + 2] ?? "0", 16) * 17;
            ctx.fillStyle = `rgb(${r},${g},${b})`;
            ctx.fillRect(x * scale, y * scale, scale, scale);
        }
    }
    return canvas.toDataURL("image/png");
}
