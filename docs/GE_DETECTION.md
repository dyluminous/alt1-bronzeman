# GE Interface Detection

How the Developer-mode GE overlay (`src/ge-debug.ts`) identifies the GE interface state.

## Overview

A 100ms tick loop with two phases:

- **Hunt**: full-screen capture → `findSubimage(ge_identifier.png)` → cache GE position
- **Locked**: 768×572 region capture → pixel probes → draw overlays

## GE position

`ge_identifier.png` is a sub-image of a unique visual element on the GE interface.  
When found, its top-left maps to `(_bx, _by)` via `match.x - 26, match.y - 26`.  
All subsequent coordinates are relative to `(_bx, _by)`.

## GE open/close detection

**Pixel**: `(35, 31)`  
**Color**: `#8557c4` (`GE_SCALES_GEM_IDENTIFIER`)  

This pixel is always present while the GE interface is visible, regardless of which tab or sub-interface is open. When it disappears, `_geLocated` is set false and the overlay clears.

## Buy offer detection

**Pixel**: `(36, 128)`  
**Color**: `#b3c603` (lime green)  

Present only when the user has the "Buy offer" interface open (not the main GE search). This gates almost everything below — if the user isn't buying, we don't check for star, item name, or dropdown size.

## Item selected (star)

**Pixel**: `(531, 130)`  
**Color**: `#7b7b7b` (grey, unfavorited) or `#d4ae6d` (gold, favorited)  

When either color is present, the user has selected an item in the buy interface. This triggers:

1. Magenta box drawn around the item name area: `(182, 120)` 340×17
2. Item name OCR (gated by loading pixel — see below)

## Item name OCR

**Magenta name box**: `(182, 120)` 340×17  
**Text color**: `#f0be79` (gold)  
**Font**: chatbox 14pt (same as tooltip)

### Loading pixel gate

**Pixel**: `(229, 147)`  
**Color**: `#b3a9a3`  

This pixel is the first dot of the "Loading…" ellipsis that appears briefly when RS switches between items. OCR only fires when:

- This pixel IS `#b3a9a3` (loading — name is changing), **or**
- `_lastItemName` is empty (star just appeared, no cached name yet)

Once the name is captured and loading fades, OCR stops. The name comparison guard (`name !== _lastItemName`) prevents redundant icon redraws.

### Name comparison

The OCR result is compared with `_lastItemName`. Only if different does the icon redraw happen — this covers the case where the user switches to a different item without triggering the loading pixel.

## Dropdown size

**Pixel**: `(42, 327)`  
**Color**: `#e3bc7d`  

If present → **small dropdown**. If absent → **large dropdown**.  
The unlock/not-unlocked icon only draws when the dropdown is **small**.

## Unlock icon

**Position**: `(184, 330)`  
**Images**: `ge_item_unlocked_button.png` / `ge_item_not_unlocked_button.png`  

The icon is drawn synchronously using:
- `isNameUnlocked(name)` — O(1) in-memory `Set<string>` lookup, no IndexedDB
- Cached base64-encoded PNGs, loaded once on toggle

**Duration**: 250ms per draw, refreshed every tick in steady-state (no IndexedDB on the refresh path).

## Unlock status lookup

`UnlockStore` maintains `unlockedTradableNames: Set<string>` — populated at DB init from tradable records, updated on add/reset. Exported as `isNameUnlocked(name)`. Synchronous, O(1).

## Search box text

**Only active when the dropdown is large** (`dropdownSmall=false`).  

**Background probe**: `(52, 225)` and `(53, 225)` — normally `#1b1d1d`; if EITHER differs, text is present  

Once text is detected, scan for the cursor:

**Cursor scan line**: `y=217`, `x=49..217` — walk left→right for `#ffffff` (normal) or `#ff0000` (character limit reached)  

| Cursor position | Meaning |
|---|---|
| `(49, 217)` | Box focused but empty — skip |
| `x > 49` | Text present — OCR region is `(49, 217)` to `(x - 1, 217 + 16)` |
| Not found | Do nothing |

**Text color**: `#ffffff` (white, anti-aliased)  
**Font**: chatbox 12pt  
**OCR gating**: only fires when `cursorX` or `ocrW` changes (tracked via `_lastCursorX`/`_lastOcrW`); survives cursor blink (reset only on `hasText` false)  

## State diffing

The tick compares each pixel value against the last known state (`_lastBuying`, `_lastStar`, `_lastDropdownSmall`, `_lastItemName`). Downstream work (OCR, icon draw, clears) only fires when the relevant state changes — not on every tick.
