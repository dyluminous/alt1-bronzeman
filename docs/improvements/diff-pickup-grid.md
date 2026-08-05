# Diff-based pickup grid updates

**Date:** 2026-07-26  
**Status:** Planned, not implemented  
**Scope:** `src/index.ts` — `refreshPickupGrid()` and related DOM logic

---

## Current implementation

```typescript
// src/index.ts, line 849
function refreshPickupGrid(): void {
    const grid = document.getElementById("scan_pickup_grid");
    if (!grid) return;
    if (recentPickups.length === 0) {
        grid.innerHTML = "";
        return;
    }
    grid.innerHTML = recentPickups.map((p, i) =>
        `<div class="pickup-card" onclick="Bronzeman.unlockPickup(${i})">
            <button class="btn-item-menu-overlay" onclick="event.stopPropagation();void(0)">✕</button>
            <div class="pickup-img-wrap">
                <img src="${p.imageUrl}" alt="pickup">
            </div>
        </div>`
    ).join("");
}
```

Every call destroys all existing card DOM nodes, builds a new HTML string from the entire `recentPickups` array, and hands it to `innerHTML`. The browser must:

1. Tear down all existing nodes and their image decodes
2. Parse the HTML string
3. Create new nodes
4. Decode all base64 `data:` URLs again
5. Recalculate layout for every card
6. Repaint

---

## Proposed implementation

### State tracking

Add two module-level variables alongside `recentPickups`:

```typescript
let renderedCardIndices: number[] = [];   // indices of cards currently in the DOM
let renderedCardNodes: HTMLElement[] = []; // corresponding DOM nodes
```

### Diff-based update function

```typescript
function diffPickupGrid(): void {
    const grid = document.getElementById("scan_pickup_grid");
    const ph = document.getElementById("scan_placeholder");
    if (!grid) return;

    // Empty state
    if (recentPickups.length === 0) {
        grid.innerHTML = "";
        if (ph) ph.style.display = "block";
        renderedCardIndices = [];
        renderedCardNodes = [];
        return;
    }
    if (ph) ph.style.display = "none";

    const currentIndices = new Set(recentPickups.map((_, i) => i));

    // 1. Remove cards whose index no longer exists (items removed from array)
    for (let i = renderedCardNodes.length - 1; i >= 0; i--) {
        if (!currentIndices.has(renderedCardIndices[i])) {
            grid.removeChild(renderedCardNodes[i]);
            renderedCardNodes.splice(i, 1);
            renderedCardIndices.splice(i, 1);
        }
    }

    // 2. Add cards for indices not yet rendered (new items)
    const renderedSet = new Set(renderedCardIndices);
    for (let i = 0; i < recentPickups.length; i++) {
        if (!renderedSet.has(i)) {
            const card = buildCardNode(recentPickups[i], i);
            grid.appendChild(card);
            renderedCardNodes.push(card);
            renderedCardIndices.push(i);
        }
    }
}
```

### Node factory (replaces string concatenation)

```typescript
function buildCardNode(p: PickupEntry, index: number): HTMLElement {
    const card = document.createElement("div");
    card.className = "pickup-card";
    card.addEventListener("click", () => unlockPickup(index));

    const btn = document.createElement("button");
    btn.className = "btn-item-menu-overlay";
    btn.textContent = "✕";
    btn.addEventListener("click", (e) => {
        e.stopPropagation();
        // TODO: wire ignore
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

### Replacement points

In `doScan()`, replace every call to `refreshPickupGrid()` with `diffPickupGrid()`. The function name change makes rollout trivial — just rename the call site.

---

## Performance comparison

| Scenario | Today (`innerHTML`) | Proposed (diff) |
|----------|---------------------|-----------------|
| Grid idle, no changes | N tear-down + N build (~10ms for 20, ~50ms for 100) | 0ms (early return from empty check already handles 0) |
| 1 item added | Full rebuild (~10ms) | 1 `appendChild` (~0.2ms) |
| 5 items added | Full rebuild (~10ms) | 5 `appendChild` (~1ms) |
| 1 item removed | Full rebuild (~10ms) | 1 `removeChild` (~0.1ms) |
| No-op re-render (array unchanged) | Full rebuild | 0ms — rendered set matches current set, nothing to do |

> Note: the current `refreshPickupGrid()` function still executes and rebuilds even when `recentPickups` hasn't changed — the call site in `doScan()` fires on every tick that processes new pickups. With diffing, when no new items are picked up and none removed, the function returns immediately.

---

## Why diffing matters at scale

- **`innerHTML` is a sledgehammer.** At 20 cards it's 3–8ms and invisible. At 100+ cards it crosses 50ms and users perceive a stutter on every inventory change.
- **Browser incremental layout is fast.** Adding or removing a single child triggers a minor subtree recalc, not a full document relayout. The browser is optimized for this.
- **No image re-decode.** `innerHTML` parses the base64 string for every `<img>` tag every time. `appendChild` with a pre-decoded image node reuses the decoded bitmap.
- **No event listener re-attach.** String-based `onclick` attributes are re-parsed every rebuild. `addEventListener` is attached once and lives as long as the node.

---

## Edge cases

| Case | Handling |
|------|----------|
| All items removed at once (reset) | Full `innerHTML = ""` clear — diff would need N `removeChild` calls which is slower than a single clear |
| Array reordered | Currently not possible (items only pushed, never sorted). If added: would need index-based key matching, not Set-based |
| Max 20 → changed to 100+ | Diff approach scales linearly with changes, not with total card count |
| Duplicate prevention | Handled separately in `recentPickups` logic — diff only concerns DOM representation |

---

## Rollout

1. Add `renderedCardIndices` and `renderedCardNodes` module variables after `recentPickups` (line 35).
2. Add `buildCardNode()` and `diffPickupGrid()` functions.
3. Replace `refreshPickupGrid()` calls in `doScan()` with `diffPickupGrid()`.
4. Run existing flow: pickup items, ignore items, verify grid matches.
5. Delete the old `refreshPickupGrid()` function once verified.

No CSS changes needed. No HTML changes needed. Purely a TypeScript refactor.
