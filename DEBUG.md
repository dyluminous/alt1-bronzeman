# Bronzeman Console Debug Reference

All commands run in the Alt1 plugin's browser console as `Bronzeman.<fn>(...)`.

## Slot scan diagnostics

| Command | What it logs |
|---|---|
| `Bronzeman.diagnoseSlotScan()` | One-shot report of all 28 slots: `prevHash`, `light`, `empty`, and why each slot is currently skipped (`covered: TL ref=... live=...` / `excluded: cursor/adjacent` / `baseline-pending`) |
| `Bronzeman.dumpSlotHash(index)` | Raw 64-char interior hash of one slot + whether it reads as `empty` (`isSlotEmpty` — any `#000001`/`#000002` shadow pixel means an item is present) |
| `Bronzeman.debugCorners(index)` | Corner gate debug for one slot: each corner's coordinate, its calibration ref colour, its live colour, and `MATCH` / `COVERED` verdict — run while a menu/tooltip is up |

## Overlay / detection

| Command | What it logs |
|---|---|
| `Bronzeman.debugFindSlot()` | Runs grid fingerprint detection on a fresh capture and logs the result: grid found (`cols×rows at (x,y)` + timing) or "No inventory found"; also draws a numbered overlay for 5s |
| `Bronzeman.updateGridDebug()` | Re-reads the "Inventory debugging" checkbox and logs the new state; redraws/clears overlays (no meaningful console output on its own, but included for completeness) |

## Unlock DB (IndexedDB)

| Command | What it logs |
|---|---|
| `Bronzeman.dumpTradableUnlocks()` | Every record in the `unlocks_tradable` store as a `console.table` (columns: name, tradeable, stackable, hashes, unlockedAt) |
| `Bronzeman.dumpUntradableUnlocks()` | Every record in the `unlocks_untradable` store as a `console.table` (same columns) |
| `Bronzeman.isHashUnlocked(hash)` | `true`/`false` — whether a given interior hash is in the unlocked set (O(1) in-memory lookup) |