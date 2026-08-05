# Unlock Storage — memory & IndexedDB sizing

How unlocked-item hashes are stored and projected cost at scale.

## How it's stored

**IndexedDB** (`Bronzeman` DB, v2) — two stores, keyPath `name`:

| store | contents |
|---|---|
| `unlocks_tradable` | tradeable items |
| `unlocks_untradable` | untradeable items |

Record shape: `{ name, tradeable, stackable, hashes[], unlockedAt }`.

**In-memory** (loaded once at boot, kept hot):

| structure | purpose | cost |
|---|---|---|
| `unlockedHashes` — `Set<string>` | O(1) "is this hash unlocked?" per slot per tick | ~200 B / hash |
| `unlockedNames` — `Set<string>` | avoid re-notifying on new stackable hash | ~100 B / name |

Hash format: 192 hex chars (8×8 cells × 3 RGB nibbles) ≈ 192 B per hash string.

## Sizing at 100,000 items

Assumes 1.2 hashes per item on average (stackables store multiple quantity-model hashes) → **120,000 hashes**.

| layer | calc | total |
|---|---|---|
| IndexedDB | 100k records × ~500 B | **~50 MB** |
| Memory — hash Set | 120k × ~200 B | **~24 MB** |
| Memory — name Set | 100k × ~100 B | **~10 MB** |
| Boot (getAll + rebuild) | parse + Set insert | ~100–200 ms one-time |

Flat costs, not per-operation. Per-item membership checks stay O(1) regardless of size.

## Notes

- Stackables: a quantity change that alters the item model (e.g. 1 coin vs 10k coins) is a *new* hash appended to the same record — the record grows, name stays.
- Old 64-char (lightness-only) hashes no longer match the 192-char scheme — re-unlock needed after the switch.
- If memory ever matters: pack hashes into `Uint8Array(96)` (~100 B) or base64 (~128 chars) to roughly halve both layers.
