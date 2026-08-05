# Bronzeman Console Debug Reference

All commands run in the Alt1 plugin's browser console as `Bronzeman.<fn>(...)`.

## Slot scan diagnostics

| Command | What it logs |
|---|---|
| `Bronzeman.diagnoseSlotScan()` | One-shot report of all 28 slots: `prevHash`, `light`, `empty`, and why each slot is skipped (`covered: TL ref=... live=...` / `excluded: cursor/adjacent` / `baseline-pending`) |
| `Bronzeman.dumpSlotHash(index)` | Raw 192-char interior hash of one slot + whether it reads as `empty` (any `#000001`/`#000002` shadow pixel means an item is present) |
| `Bronzeman.debugCorners(index)` | Corner gate debug for one slot: each corner's coordinate, calibration ref colour, live colour, `MATCH` / `COVERED` — run while a menu/tooltip is up |

## Overlay / detection

| Command | What it logs |
|---|---|
| `Bronzeman.debugFindSlot()` | Runs grid fingerprint detection on a fresh capture: grid found (`cols×rows at (x,y)` + timing) or "No inventory found"; draws a numbered overlay for 5s |

## Unlock DB (IndexedDB)

| Command | What it logs |
|---|---|
| `Bronzeman.dumpTradableUnlocks()` | Every record in `unlocks_tradable` as a `console.table` (name, tradeable, hashes, unlockedAt) |
| `Bronzeman.dumpUntradableUnlocks()` | Every record in `unlocks_untradable` as a `console.table` (same columns) |
| `Bronzeman.dumpItemHashes("tradable"\|"untradable", "Item name")` | The hashes array of one named record, one per line |
| `Bronzeman.isHashUnlocked(hash)` | `true`/`false` — whether a hash is in the unlocked set (O(1) in-memory lookup) |
