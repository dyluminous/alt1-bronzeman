// slot-hover.ts — poll cursor position and draw yellow square over hovered slot
import { inventory } from "./inventory";
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
        const anc = inventory.anchor;
        if (!anc) { clearSlotHover(); return; }

        const m = a1lib.getMousePosition();
        if (!m) { clearSlotHover(); return; }

        const slotIndex = inventory.getSlotIndexAt(m.x, m.y);
        if (slotIndex === null) { clearSlotHover(); return; }

        drawSlotHover(slotIndex);
    }, POLL_MS);
}

export function stopSlotHover(): void {
    if (pollHandle) { clearInterval(pollHandle); pollHandle = null; }
    clearSlotHover();
}
