// slot-hover.ts — poll cursor position and draw yellow square over hovered slot
import * as Inventory from "./inventory";
import * as a1lib from "alt1";
import { state } from "./core";
import { drawSlotHover, clearSlotHover, isGridDebugEnabled } from "./overlay";

const POLL_MS = 150;
let pollHandle: ReturnType<typeof setInterval> | null = null;

export function startSlotHover(): void {
    if (pollHandle) return;
    pollHandle = setInterval(() => {
        if (!state.inAlt1 || !state.autocapture) {
            stopSlotHover();
            return;
        }
        if (!isGridDebugEnabled()) {
            clearSlotHover();
            return;
        }
        const anc = Inventory.loadAnchor();
        if (!anc) { clearSlotHover(); return; }

        const m = a1lib.getMousePosition();
        if (!m) { clearSlotHover(); return; }

        const col = Math.floor((m.x - anc.x) / anc.colStride);
        const row = Math.floor((m.y - anc.y) / anc.rowStride);
        const cols = anc.gridCols;
        const rows = anc.gridRows;
        if (cols == null || rows == null) { clearSlotHover(); return; }
        if (col < 0 || col >= cols || row < 0 || row >= rows) {
            clearSlotHover();
            return;
        }
        const slotIndex = row * cols + col;
        // clamp to 28 slots (last row may be shorter)
        if (slotIndex >= 28) { clearSlotHover(); return; }

        drawSlotHover(anc, slotIndex);
    }, POLL_MS);
}

export function stopSlotHover(): void {
    if (pollHandle) { clearInterval(pollHandle); pollHandle = null; }
    clearSlotHover();
}
