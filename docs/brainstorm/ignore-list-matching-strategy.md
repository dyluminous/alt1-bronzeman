# Item Ignore List — Matching Strategy Investigation

**Date:** 2026-07-26  
**Context:** Bronzeman Mode — Alt1 RuneScape plugin  
**Problem:** When a user clicks the ✕ button on a potential unlock, we need to permanently ignore that item so it doesn't reappear. The ignore list could grow to 15,000+ items, and every inventory slot change must check this list to suppress ignored items from the potential unlocks pane.

---

## Approaches considered

### Approach A: Center-pixel cascade

**Algorithm:**

1. Read the RGB value of the center pixel of the item's inventory slot image (36×32 pixels).
2. Compare against center pixel of every item in the ignore
 list (15,000+ entries).
3. If the center pixel matches ~500 other items (common case), read a second pixel further from center.
4. If still ambiguous (~50 matches), read a third, fourth, etc.
5. Only do a full pixel-by-pixel comparison if the cascade can't resolve the match.

**Assumptions (user-provided):**
- 90% of items have a non-background center pixel (not `#1a1a1c` inventory background).
- The center pixel is shared with ~500 other items on average.
- A second pixel prunes this to ~50.
- A third pixel resolves to near-uniqueness.

**Strengths:**
- When the center pixel IS unique, it resolves in 1 comparison (~10% of items).
- Pixel-exact matching is immune to hash collisions.
- Memory per ignored item: 3–9 bytes (1–3 RGB pixels).

**Weaknesses:**
- The cascade degrades to brute force for items where center hits inventory background (empty vials, herbs, planks, runes, empty potions — exactly the untradeable clutter users want to ignore).
- Branching logic: each cascade step needs subset iteration, increasing code complexity.
- JS array access + 3 int compares per pixel is slower than a CPU-level XOR.
- Common items (vials, herbs) are the ones most likely to be ignored and least likely to have unique centers — the worst case is the most frequent case.

**Performance (15,000 ignores):**

| Case | Operations |
|------|-----------|
| 90% of items (center not bg) | 15,000 + 500 + 50 = 15,550 pixel reads |
| 10% of items (center = bg) | 15,000 × many cascade steps |
| Per pixel read | Array index + 3 integer comparisons |

---

### Approach B: Perceptual hash (8×8 brightness grid)

**Algorithm:**

1. Compute an 8×8 averaged brightness grid over the item's slot image, yielding a 64-bit hash (same as the current slot change detection hash in `inventory.ts`).
2. On green-box, compare the item's hash against every hash in the ignore list using XOR + popcount.
3. If the XOR distance is 0 (exact match), the item is ignored.
4. Optionally: if distance is 1–2 (near-identical), treat as match.

**Strengths:**
- One comparison per item: single CPU instruction (XOR + popcount).
- 15,000 comparisons completes in microseconds.
- Handles the "center is background" case identically to any other item — no degradation.
- Reuses existing `hashDiff()` infrastructure from `inventory.ts`.
- The 8×8 grid captures the overall shape regardless of where the item sits in the slot.
- Using a center 24×24 crop (6px trim from edges) to compute the hash strips most inventory background, making the hash more item-distinctive.

**Weaknesses:**
- 64-bit space means theoretical collision is possible (though practically zero with 8×8 grid and center crop).
- If the hash source changes (tooltip vs slot capture, different render quality), the hash shifts.
- 8 bytes per ignored item (8 bytes more than the 3-byte minimum of cascade, though still tiny).

**Performance (15,000 ignores):**

| Case | Operations |
|------|-----------|
| Every item | 15,000 XORs |
| Per XOR | 1 CPU instruction |

---

## Comparison summary

| Metric | Center-pixel cascade | Perceptual hash |
|--------|---------------------|----------------|
| Best-case speed | 1 pixel read | 15,000 XORs |
| Worst-case speed | Degrades to brute force for common items | 15,000 XORs (constant) |
| Common-item performance | Bad (center = bg for vials/herbs/runes) | Good (constant) |
| Code complexity | New code: subsets, pixel indices, branching | Reuse `hashDiff()` |
| Memory per entry | 3–9 bytes | 8 bytes |
| 15,000 entries total | ~45–135 KB | ~120 KB |
| Collision risk | None (pixel-exact) | Possible but unlikely with center-crop |
| Immune to render changes | Yes | Hash must be recomputed if source changes |

---

## Recommendation

**Use perceptual hash with name as primary key.**

| Layer | Key | Purpose |
|-------|-----|---------|
| 1 | OCR item name | O(1) via `Set<string>`, handles 99% of cases |
| 2 | Perceptual hash | Exact-match fallback when no name yet |
| 3 | Threshold tiebreak | Only if hash distance = 1–2, do pixel cascade |

This hybrid approach delivers:
- O(1) name lookup for scanned items (primary path).
- Constant-time hash comparison for unnamed items (fallback).
- Cascade pixel comparison only in the rare ambiguous case (tiebreaker).
- Total memory for 15,000 ignores: ~120 KB (hash) + ~200 KB (names) ≈ negligible.

Both approaches are fast enough at 15,000 entries. The perceptual hash is chosen for its simplicity (reuse existing code) and consistent performance regardless of item shape or background content.

---

## Related code

- `src/inventory.ts` — `hashDiff()`, `cellsToHash()` (8×8 perceptual hash)
- `src/index.ts` — `doScan()` where green-box/pickup logic runs
- `src/index.html` — potential unlocks pickup cards with ✕ buttons
- `src/data.ts` — unlock persistence in localStorage
