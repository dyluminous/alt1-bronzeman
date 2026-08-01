# Bronzeman — Alt1 RuneScape inventory tracker

Build: `npm run build` — webpack bundles into `dist/main.js`

## File map

| File | Owns |
|---|---|
| `index.ts` | Bootstrap + `Bronzeman.*` re-exports for HTML onclick. Add nothing else here. |
| `core.ts` | `state`, `captureFullRs`, `showNotification`, `log`, `escHtml` — zero DOM logic |
| `data.ts` | Unlock/ignore persistence (IndexedDB + localStorage) |
| `inventory.ts` | `Inventory` class — calibrated grid state + slot access, hovered-slot + adjacency mapping (singleton `inventory`) |
| `inventory-detect.ts` | Pure grid detection: fingerprints, `measureGapToSlot2`, `countColumns`, `detectInventoryGrid` |
| `ui.ts` | DOM rendering + UI action handlers (ignore tooltips, reset buttons, modal calls, slot hash debug pane) |
| `capture.ts` | Auto-capture lifecycle + retry loop |
| `overlay.ts` | RS overlay drawing (`drawDetectDebug`, `debugFindSlot`, `updateGridBoundary`, `drawSlotHover`) |
| `inventory-slot.ts` | `InventorySlot` class — geometry (x,y,cx,cy,interiorX/Y, tl/tr/bl/br) + scan state (cornerRefs, previousHash) |
| `slot-hover.ts` | Polls cursor, maps to slot via `inventory.getHoveredSlotIndex`, draws yellow hover square |
| `slot-scan.ts` | Monitors slot contents — corner occlusion + empty-ref + interior hash → appeared/removed/changed/moved events; console diag fns |
| `anchor-watch.ts` | Watches the top-right slot's TR border pixel (in-memory ref); fires re-calibration on change |
| `modal.ts` | Confirm dialog |
| `style.css` | All CSS — imported by index.ts, injected at runtime via style-loader |

## Rules

- Don't commit unless the user explicitly asks you to commit.
- New code goes in the file that owns its concern. If no file owns it, create one.
- `index.ts` only imports + bootstraps + re-exports. Never dump logic there.
- HTML buttons use `onclick="Bronzeman.fn(...)"`. Those fns are re-exported by index.ts.
- Dependency direction: `core` ← `data`/`inventory`/`detect` ← `ui`/`overlay`/`modal` ← `capture` ← `index`
