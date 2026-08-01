# Bronzeman Console Debug Reference

All commands run in the Alt1 plugin's browser console as `Bronzeman.<fn>(...)`.
Everything here logs to the console only — nothing is written to localStorage.

## Slot scan diagnostics

| Command | What it logs |
|---|---|
| `Bronzeman.diagnoseSlotScan()` | One-shot report of all 28 slots: `prevHash`, `light`, `emptyMismatch`, and why each slot is currently skipped (`covered` / `excluded: cursor/adjacent` / `baseline-pending`) |
| `Bronzeman.dumpSlotHash(index)` | Raw 64-char interior hash of one slot + `emptyMismatch` (pixels differing from the empty reference) |
| `Bronzeman.debugCorners(index)` | Corner gate debug for one slot: each corner's coordinate, its calibration ref colour, its live colour, and `MATCH` / `COVERED` verdict — run while a menu/tooltip is up |

## Overlay / detection

| Command | What it logs |
|---|---|
| `Bronzeman.debugFindSlot()` | Runs grid fingerprint detection on a fresh capture and logs the result: grid found (`cols×rows at (x,y)` + timing) or "No inventory found"; also draws a numbered overlay for 5s |
| `Bronzeman.updateGridBoundary()` | Re-reads the "Inventory debugging" checkbox and logs the new state; redraws/clears overlays (no meaningful console output on its own, but included for completeness) |

## Ignore list

| Command | What it logs |
|---|---|
| `Bronzeman.dumpIgnoredItems()` | Logs the full ignore list as a `console.table` (name, hash prefix, ignoredAt) + a count line |

## Notes

- Console spam guard: the only *automatic* console output is real change events (appeared / removed / changed / moved). Everything above is one-shot — it prints once per call.
- `dumpSlotHash` and `debugCorners` expect a slot index `0`–`27` (slot 27 = the last slot, the user-verified empty reference).
- To loop all slots from the console:
  ```js
  for (let i = 0; i < 28; i++) Bronzeman.dumpSlotHash(i)
  ```
