# Ignore List — Perceptual Hash Rollout Plan

**Date:** 2026-07-28  
**Status:** Planned  
**Branch:** `feat/ignore-list`  
**Builds on:** `docs/brainstorm/ignore-list-matching-strategy.md`  
**Depends on:** `docs/improvements/diff-pickup-grid.md` (already implemented on `main`)

---

## Background

When a user clicks the ✕ button on a potential unlock card, that item should be permanently ignored — never appearing in potential unlocks again even across sessions. The ignore list may grow to 15,000+ entries, and every green-box detection must check against it.

The decision (from the matching-strategy doc) is to use the existing 8×8 perceptual hash as the primary match key, with OCR item name stored for future UI/search purposes but not required for the scan-time check.

---

## Key insight from code analysis

The 8×8 perceptual hash (`slot.hash`) is **already computed** in `inventory.ts→readSlots()` (line 529) from the full 36×32 slot interior and **already stored** in `PickupEntry` (line 411 in `doScan`). Item name is **not available** at scan time — it only comes later via tooltip OCR in the unlock flow. Therefore:

- **Scan-time ignore check** uses `slot.hash` (available immediately)
- **Name storage** happens if/when the item is later unlocked (OCR'd), or can be stored as `null` for purely-hash-based ignores
- **No new hash computation** is needed anywhere — `slot.hash` and `PickupEntry.hash` already exist

---

## Phase 0: Diff grid hardening (hash-based tracking + version counter)

The diff grid (`diffPickupGrid`) currently tracks rendered cards by array index. The ignore feature requires `splice` removal from `recentPickups`, which shifts indices and breaks the diff. Rather than adding a nuclear `resetPickupGrid()`, we switch the diff grid to track cards by **hash** instead of index. We also add a **version counter** so no-op ticks (nothing changed) cost O(1) instead of iterating the full array.

### 0.1 Current state

```typescript
// Current tracking (by index — breaks on splice)
const recentPickups: PickupEntry[] = [];
let renderedCardIndices: number[] = [];
let renderedCardNodes: HTMLElement[] = [];
```

### 0.2 New state

```typescript
const recentPickups: PickupEntry[] = [];
let renderedCardHashes: string[] = [];      // replaces renderedCardIndices
let renderedCardNodes: HTMLElement[] = [];
let pickupVersion = 0;                      // incremented on every mutation
let lastRenderedVersion = -1;               // tracked for no-op detection
```

### 0.3 `diffPickupGrid()` — hash-based + version gating

```typescript
function diffPickupGrid(): void {
    // No-op guard: if nothing mutated since last render, skip everything
    if (pickupVersion === lastRenderedVersion) return;

    const grid = document.getElementById("scan_pickup_grid");
    const ph = document.getElementById("scan_placeholder");
    if (!grid) return;

    // Empty state
    if (recentPickups.length === 0) {
        grid.innerHTML = "";
        if (ph) ph.style.display = "block";
        renderedCardHashes = [];
        renderedCardNodes = [];
        lastRenderedVersion = pickupVersion;
        return;
    }
    if (ph) ph.style.display = "none";

    const currentHashes = new Set(recentPickups.map(p => p.hash));

    // 1. Remove cards whose hash is gone
    for (let i = renderedCardNodes.length - 1; i >= 0; i--) {
        if (!currentHashes.has(renderedCardHashes[i])) {
            grid.removeChild(renderedCardNodes[i]);
            renderedCardNodes.splice(i, 1);
            renderedCardHashes.splice(i, 1);
        }
    }

    // 2. Add cards for hashes not yet rendered
    const renderedSet = new Set(renderedCardHashes);
    for (const p of recentPickups) {
        if (!renderedSet.has(p.hash)) {
            const card = buildCardNode(p);
            grid.appendChild(card);
            renderedCardNodes.push(card);
            renderedCardHashes.push(p.hash);
        }
    }

    lastRenderedVersion = pickupVersion;
}
```

### 0.4 `buildCardNode()` — resolve index by hash at click time

Instead of baking the array index at construction (which goes stale after a splice), capture the hash and resolve the index at click time:

```typescript
function buildCardNode(p: PickupEntry): HTMLElement {
    const hash = p.hash;
    const card = document.createElement("div");
    card.className = "pickup-card";
    card.addEventListener("click", () => {
        const idx = recentPickups.findIndex(e => e.hash === hash);
        if (idx >= 0) unlockPickup(idx);
    });

    const btn = document.createElement("button");
    btn.className = "btn-item-menu-overlay";
    btn.textContent = "✕";
    btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const idx = recentPickups.findIndex(entry => entry.hash === hash);
        if (idx >= 0) ignorePickup(idx);
    });
    card.appendChild(btn);

    const wrap = document.createElement("div");
    wrap.className = "pickup-img-wrap";
    const img = document.createElement("img");
    img.src = p.imageUrl;
    img.alt = "pickup";
    wrap.appendChild(img);
    card.appendChild(wrap);
    return card;
}
```

### 0.5 Why hash-based tracking works

When `ignorePickup(idx)` splices an item from `recentPickups`:

1. `pickupVersion` is incremented (see Phase 3.1)
2. Next `diffPickupGrid()` call: `pickupVersion !== lastRenderedVersion` → enters the method
3. `currentHashes` = Set of all remaining hashes (ignored hash is gone)
4. Removal pass: one card matches the disappeared hash → `removeChild` → splice from tracking arrays
5. Addition pass: nothing new (hash from step 4 was already removed)
6. Result: exactly one card removed from DOM, all other cards untouched, no full grid reset

### 0.6 Scale analysis

Red-team analysis confirmed this scales well at 300+ items. The version counter ensures the common case (idle inventory, nothing changed) costs exactly one integer comparison. The hash-based tracking avoids the index-shifting problem entirely — each card is identified by its immutable 64-char hash string.

| Scenario | Cost with version counter | Cost without |
|----------|--------------------------|-------------|
| Idle tick, 500 items | O(1) — single int compare | Two Set builds + 500 iterations |
| 1 item added | ~500 Set.has() + 1 append | Same |
| 1 item removed (✕) | ~500 Set.has() + 1 remove | Same |
| 3 items added at once | ~500 Set.has() + 3 appends | Same |

The actual bottleneck at 300+ items is not the diff algorithm but the **300 base64 images living in DOM nodes** (GPU memory). That's a separate concern — item limit in `MAX_PICKUPS` already caps this. No action needed now.

### 0.7 Mutation tracking in `doScan()`

Every mutation to `recentPickups` must increment `pickupVersion`:

```typescript
// In doScan(), wherever recentPickups is modified:
recentPickups.push({ slotIndex: slot.index, imageUrl: url, time: Date.now(), noted, hash: slot.hash });
pickupVersion++;   // <-- after every push
if (recentPickups.length > MAX_PICKUPS) {
    recentPickups.pop();
    pickupVersion++;  // <-- after pop as well
}
```

And in `ignorePickup()`:
```typescript
recentPickups.splice(idx, 1);
pickupVersion++;
```

---

## Phase 1: Data model and storage

### 1.1 Interface

```typescript
interface IgnoredItem {
    name: string | null;   // OCR item name (null if not yet scanned)
    hash: string;          // 64-char hex perceptual hash
    ignoredAt: number;     // Date.now()
}
```

### 1.2 localStorage

- Key: `"Bronzeman/ignores"`
- Serialized as `JSON.stringify(IgnoredItem[])`
- Loaded once on plugin init into a module-level array in `data.ts`
- Written to localStorage on every mutation (add / clear)

### 1.3 Internal state (in `data.ts`)

```typescript
let ignoredItems: IgnoredItem[] = [];

function loadIgnoredItems(): void {
    try {
        const raw = localStorage.getItem("Bronzeman/ignores");
        ignoredItems = raw ? JSON.parse(raw) : [];
    } catch {
        ignoredItems = [];
    }
}

function saveIgnoredItems(): void {
    localStorage.setItem("Bronzeman/ignores", JSON.stringify(ignoredItems));
}

// Call loadIgnoredItems() once on module init
```

### 1.4 Public functions (exported from `data.ts`, re-exported via `index.ts`)

| Function | Signature | Purpose |
|----------|-----------|---------|
| `isIgnored(hash)` | `(hash: string) => boolean` | O(n) scan of `ignoredItems` array — exact-match `===` on hash string. Called from `doScan` before push to `recentPickups` |
| `ignoreItem(hash, name?)` | `(hash: string, name?: string) => void` | Push `{ name: name ?? null, hash, ignoredAt: Date.now() }` to `ignoredItems`, then `saveIgnoredItems()`. If hash already exists, update name only (idempotent) |
| `getIgnoredItems()` | `() => IgnoredItem[]` | Returns a copy of `ignoredItems` (for debug UI / console dump) |
| `getIgnoredCount()` | `() => number` | `ignoredItems.length` — for status bar display |
| `clearIgnoredItems()` | `() => void` | Sets `ignoredItems = []`, calls `saveIgnoredItems()`. Used by "Reset ignores" button |

### 1.5 Performance of `isIgnored(hash)`

At 15,000 entries, each call does 15,000 string comparisons. A 64-char string `===` comparison in V8 is ~5–10 nanoseconds after JIT warmup. 28 slots × 15,000 = 420,000 comparisons per scan tick ≈ 2–4ms in the absolute worst case where every slot is occupied and filtered. In practice only changed/occupied slots are checked, bringing it well under 1ms.

If this ever becomes a bottleneck, the natural upgrade path is to change `ignoredItems` from `IgnoredItem[]` to `Set<string>` for O(1) lookup. But at current scale this isn't needed — the string `===` is fast enough.

---

## Phase 2: Ignore check in `doScan()`

### 2.1 Exact insertion point

In `src/index.ts`, inside `doScan()`, at the loop body that iterates `confirmedSlots` (around lines 383–414). The check goes **after** the dup detection (hash diff check against existing `recentPickups`) and **before** the `recentPickups.push()`:

```typescript
// (existing dup detection logic above)

// NEW: Check ignore list
if (isIgnored(slot.hash)) {
    if (state.debugLogIgnores) {
        log(`  🚫 Slot #${slot.index + 1} hash ${slot.hash.slice(0, 8)}… is ignored — skipping`);
    }
    continue;
}

// (existing push + image capture below)
recentPickups.push({ ... });
pickupVersion++;
```

### 2.2 Hash source

Use `slot.hash` directly — the same 64-char hex string already computed by `Inventory.scan()→readSlots()` and stored in each `SlotState` object. No new hash computation, no image processing, no center-crop.

### 2.3 Import

`isIgnored` is imported from `./data` at the top of `index.ts`:
```typescript
import { isIgnored, ignoreItem, getIgnoredItems, getIgnoredCount, clearIgnoredItems } from "./data";
```

---

## Phase 3: ✕ button wiring

### 3.1 Function: `ignorePickup(idx)`

New exported function in `src/index.ts`:

```typescript
function ignorePickup(idx: number): void {
    const entry = recentPickups[idx];
    if (!entry) return;

    // Add to ignore list (persists to localStorage internally)
    ignoreItem(entry.hash, null); // name = null; will be filled if item is later unlocked/OCR'd

    // Remove from recentPickups
    recentPickups.splice(idx, 1);
    pickupVersion++;

    // Diff grid handles DOM removal on next call (hash is gone from currentHashes)
    diffPickupGrid();

    // Show notification
    showNotification("Item ignored", 2000, "warning");
}
```

### 3.2 ✕ button click handler (already wired in Phase 0.4)

The ✕ button in `buildCardNode()` resolves the index by hash at click time:

```typescript
btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const idx = recentPickups.findIndex(entry => entry.hash === hash);
    if (idx >= 0) ignorePickup(idx);
});
```

### 3.3 Why this doesn't need a DOM reset

After `splice`, `pickupVersion` is incremented. The next `diffPickupGrid()` call sees the version mismatch and enters the method. The removed hash is absent from `currentHashes`, so the removal pass deletes that one card node. All other cards stay — their hashes are still in both the Set and the tracking arrays. No full rebuilds, no stale indices, no `resetPickupGrid()` needed.

---

## Phase 4: Debug support

### 4.1 Console log toggle

Add `state.debugLogIgnores: boolean` (default `false`) in `core.ts`. When enabled, `doScan` logs:

```
[Bronzeman] 🚫 Slot #5 hash a1b2c3d4… is ignored — skipping
```

### 4.2 Debug tab checkbox

Add a checkbox in the Debug tab under Grid Overlays:

```html
<label class="debug-label">
    <input type="checkbox" class="pixel-checkbox" onchange="Bronzeman.toggleIgnoreLog(this.checked)">
    Log ignored items
</label>
```

`toggleIgnoreLog(checked)` sets `state.debugLogIgnores = checked` and calls `updateUI()`.

### 4.3 Ignore count in status

Show ignored item count in the debug status bar alongside build number and anchor dot:

```
Build #123  ⏺  Ignored: 42
```

Rendered by `updateDebugStatus()` in `ui.ts`, reading `getIgnoredCount()`.

### 4.4 Dump ignore list button

Add a button in Debug > Output:

```html
<div class="btn btn-primary" onclick="Bronzeman.dumpIgnoredItems()">Ignored > Console</div>
```

`dumpIgnoredItems()` calls `console.table(getIgnoredItems().map(i => ({ name: i.name ?? "(unnamed)", hash: i.hash.slice(0, 16) + "…", ignoredAt: new Date(i.ignoredAt).toLocaleString() })))`.

---

## Phase 5: Separate "Reset ignores" button

### 5.1 Placement

Add a compact button at the bottom of the Unlocks tab, next to the existing Reset (unlocks) button:

```html
<div class="btn btn-primary" onclick="Bronzeman.resetIgnores()">Reset ignores</div>
```

### 5.2 Behavior

```typescript
function resetIgnores(): void {
    showModal(
        "Delete all ignored items? This will allow them to appear in potential unlocks again.",
        "DANGER",
        () => {
            clearIgnoredItems();
            showNotification("All ignored items cleared", 2000, "success");
            updateUI();
        }
    );
}
```

Uses the existing modal system — same `showModal()` that reset unlocks uses, same DANGER level styling, same callback pattern.

---

## Phase 6: Testing strategy

### 6.1 Manual test flow

| # | Action | Expected |
|---|--------|----------|
| 1 | Capture inventory, pick up several different items | They appear in potential unlocks grid |
| 2 | Click ✕ on one item | Card removed from grid; notification "Item ignored" shown |
| 3 | Move the ignored item out of inventory and back in | Item does NOT appear in potential unlocks |
| 4 | Enable "Log ignored items" in Debug tab | Console shows `🚫 Slot #X hash… is ignored — skipping` |
| 5 | Check console: `Bronzeman.dumpIgnoredItems()` | Shows the ignored entry with hash prefix |
| 6 | Reload plugin (Alt+F4 → reopen) and repeat step 3 | Previously ignored item still suppressed |
| 7 | Check `localStorage["Bronzeman/ignores"]` in devtools | Contains JSON array with the hash |
| 8 | Click "Reset ignores" → Confirm | Notification "All ignored items cleared" |
| 9 | Pick up the previously-ignored item again | It appears in potential unlocks (ignore list is empty) |
| 10 | Verify `localStorage["Bronzeman/ignores"]` | Key removed or contains `[]` |

### 6.2 Edge cases

| Case | Expected behavior |
|------|-------------------|
| Ignore an item, then pick up a different stack of the same item type | Same hash → suppressed |
| Ignore noted item vs unnoted item | Different hashes → treated as different items (correct) |
| Ignore item, move it in inventory, pick it up again | Same slot image = same hash → still ignored |
| Ignore item before its name is OCR'd | `name: null` stored in ignore entry; hash match still works |
| Ignore list grows to 15,000 | `isIgnored()` still completes in ~2ms per tick; no user-perceptible difference |
| Click ✕ twice on same card (race) | Second click: `findIndex` returns -1 → `ignorePickup(-1)` returns early (guard: `if (!entry) return`) |
| Click ✕ while card is in "scanning" mode | `ignorePickup` splices from array; `scanning.slotIndex` may become stale; cancel scan first (Phase 3.1 of the scan flow already handles this) |

### 6.3 Build verification

- `npm run build` compiles with zero errors
- Plugin loads in Alt1 without console errors
- `localStorage["Bronzeman/ignores"]` contains expected JSON after ignoring an item
- After reset ignores, key contains `[]`
- Version counter: add console.log to `diffPickupGrid` to confirm it short-circuits on idle ticks

---

## Phase 7: Rollout checklist

- [ ] Create branch `feat/ignore-list` from `main`
- [ ] Phase 0: Convert `renderedCardIndices` to `renderedCardHashes`, add `pickupVersion`/`lastRenderedVersion`, update `diffPickupGrid()` with version gate and hash-based loops
- [ ] Phase 0: Update `buildCardNode()` to use `p.hash` closure + `findIndex` resolve
- [ ] Phase 0: Add `pickupVersion++` after every `recentPickups` mutation in `doScan()`
- [ ] Phase 1: Add `IgnoredItem` interface, `ignoredItems` array, `loadIgnoredItems()`/`saveIgnoredItems()`, and the 5 public functions to `data.ts`
- [ ] Phase 1: Import `isIgnored`, `ignoreItem`, `getIgnoredCount`, `clearIgnoredItems` in `index.ts`
- [ ] Phase 2: Wire `isIgnored(slot.hash)` check in `doScan()` before push
- [ ] Phase 3: Add `ignorePickup(idx)` function to `index.ts`; export it
- [ ] Phase 4: Add `state.debugLogIgnores` to `core.ts`, `toggleIgnoreLog()` function, debug checkbox and dump button in `index.html`, ignore count in debug status bar
- [ ] Phase 5: Add "Reset ignores" button and `resetIgnores()` function
- [ ] Build and run Phase 6 test flow
- [ ] Merge to `main` and push
- [ ] Delete branch `feat/ignore-list`

---

## Files modified

| File | Changes |
|------|---------|
| `src/data.ts` | Add `IgnoredItem` interface; `ignoredItems` array; `loadIgnoredItems()`/`saveIgnoredItems()`; `isIgnored()`, `ignoreItem()`, `getIgnoredItems()`, `getIgnoredCount()`, `clearIgnoredItems()` |
| `src/core.ts` | Add `state.debugLogIgnores: boolean` |
| `src/ui.ts` | `updateDebugStatus()` reads `getIgnoredCount()` for status bar; `toggleIgnoreLog()` |
| `src/index.ts` | Replace `renderedCardIndices` with `renderedCardHashes`; add `pickupVersion`/`lastRenderedVersion`; update `diffPickupGrid()` with version gate + hash loops; update `buildCardNode()` to use hash closure; add `ignorePickup()`; wire `isIgnored()` check in `doScan()`; add `dumpIgnoredItems()` and `resetIgnores()`; export new functions |
| `src/index.html` | Add "Log ignored items" checkbox in Debug; "Ignored > Console" button; ignore count in status bar; "Reset ignores" button on Unlocks tab |
