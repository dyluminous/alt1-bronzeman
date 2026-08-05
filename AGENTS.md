# Bronzeman — Alt1 RuneScape inventory tracker

Build: `npm run build` — webpack bundles into `dist/main.js`

## File map

| File | Owns |
|---|---|
| `index.ts` | Bootstrap + `Bronzeman.*` re-exports for HTML onclick. Add nothing else here. |
| `core.ts` | `state`, `captureFullRs`, `showNotification`, `log`, `escHtml` — zero DOM logic |
| `data.ts` | Unlock/ignore persistence (IndexedDB + localStorage) |
| `inventory.ts` | RS grid fingerprint detection (`detectInventoryGrid`, `validateAnchor`) |
| `ui.ts` | DOM rendering + UI action handlers (ignore tooltips, reset buttons, modal calls) |
| `capture.ts` | Auto-capture lifecycle + retry loop |
| `overlay.ts` | RS overlay drawing (`drawDetectDebug`, `debugFindSlot`, `updateGridBoundary`) |
| `modal.ts` | Confirm dialog |
| `style.css` | All CSS — imported by index.ts, injected at runtime via style-loader |

## Rules

- Don't commit unless the user explicitly asks you to commit.
- New code goes in the file that owns its concern. If no file owns it, create one.
- `index.ts` only imports + bootstraps + re-exports. Never dump logic there.
- HTML buttons use `onclick="Bronzeman.fn(...)"`. Those fns are re-exported by index.ts.
- Dependency direction: `core` ← `data`/`inventory` ← `ui`/`overlay`/`modal` ← `capture` ← `index`
