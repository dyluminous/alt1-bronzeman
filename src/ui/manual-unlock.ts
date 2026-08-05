// manual-unlock.ts — user picks an inventory slot, hovers to OCR the tooltip,
// queries the wiki, and adds the item to the unlock DB. Activated from the
// Settings tab's "Manual item unlock" button.
import { inventory } from "../classes/inventory";
import { log, showNotification } from "../core";
import { addUnlockedItem } from "../services/data";
import { recordUnlock, resolveImageUrl } from "./recent-unlocks";
import { readStackableQuantity } from "../services/slot-scan";
import type { WikiQueryResult } from "../services/wiki";
import { fetchItemTradeable, pickImageForQuantity } from "../services/wiki";
import { SlotLoadingAnimation } from "../classes/slot-animation";
import { readTooltipItemName } from "../services/tooltip-read";
import { showInlinePanel, hideInlinePanel, showDisambiguation, closeDisambiguation } from "./ui";

// ============================================================
// State
// ============================================================

/** Active manual-unlock state; null when idle. */
let state: {
    targetIndex: number;
    animation: SlotLoadingAnimation;
    timer: ReturnType<typeof setInterval>;
    abort: () => void;
} | null = null;

// ============================================================
// Public API — called from HTML onclick handlers
// ============================================================

export function openManualUnlock(): void {
    const msg = document.getElementById("manual_unlock_msg");
    if (msg) msg.textContent = "Select the inventory slot containing the item you want to unlock.";
    const btn = document.getElementById("manual_unlock_start_btn");
    if (btn) btn.textContent = "Unlock";
    showInlinePanel("settings_content", "manual_unlock_inline");
}

export function closeManualUnlock(): void {
    if (state) state.abort();
    hideInlinePanel("settings_content", "manual_unlock_inline");
}

export function manualUnlock(): void {
    if (state) { state.abort(); return; }

    if (!inventory.isCalibrated) {
        showNotification("Inventory not calibrated — capture it first", 3000, "danger");
        return;
    }

    const input = document.getElementById("manual_unlock_slot_input") as HTMLInputElement | null;
    const userSlot = parseInt(input?.value ?? "1", 10);
    const targetIndex = Math.min(27, Math.max(0, userSlot - 1));
    const slot = inventory.getSlot(targetIndex);
    if (!slot) {
        showNotification(`Slot ${userSlot} is out of range for the current grid`, 3000, "danger");
        return;
    }

    const anim = new SlotLoadingAnimation(slot);
    anim.start();

    const btn = document.getElementById("manual_unlock_start_btn");
    if (btn) btn.textContent = "Cancel";
    const msg = document.getElementById("manual_unlock_msg");
    if (msg) msg.textContent = "Hover over the target inventory slot";

    const POLL_MS = 200;
    const TIMEOUT_MS = 30_000;
    let elapsed = 0;
    let resolved = false;

    const cleanup = (): void => {
        if (btn) btn.textContent = "Unlock";
        if (msg) msg.textContent = "Select the inventory slot containing the item you want to unlock.";
        if (!state) return;
        clearInterval(state.timer);
        state.animation.stop();
        state = null;
        closeDisambiguation();
    };

    const abort = (): void => { resolved = true; cleanup(); };

    const tick = (): void => {
        elapsed += POLL_MS;
        if (elapsed > TIMEOUT_MS) {
            cleanup();
            showNotification("Timed out waiting for tooltip", 3000, "danger");
            return;
        }

        const hoveredIndex = inventory.getHoveredSlotIndex();
        if (hoveredIndex !== targetIndex) return;

        anim.stop();
        const itemName = readTooltipItemName();
        if (!itemName) { anim.start(); return; }

        if (resolved) return;
        resolved = true;

        log(`Manual unlock: "${itemName}" (slot ${targetIndex})`);

        let stackQty: number | null = null;
        if (slot.isStackable) {
            const n = readStackableQuantity(targetIndex);
            if (n !== null) stackQty = n;
        }

        const slotHash = slot.previousHash && slot.previousHash !== "empty" ? slot.previousHash : null;

        void fetchItemTradeable(itemName).then(result => {
            handleWikiResult(result, itemName, slotHash, targetIndex, stackQty, anim, abort);
        });
    };

    state = { targetIndex, animation: anim, timer: setInterval(tick, POLL_MS), abort };
    log(`Manual unlock: waiting for hover on slot ${userSlot} (index ${targetIndex})...`);
}

// ============================================================
// Wiki pipeline — mirrors dot-hover's handleWikiResult
// ============================================================

function handleWikiResult(
    result: WikiQueryResult,
    itemName: string,
    slotHash: string | null,
    slotIndex: number,
    stackQty: number | null,
    anim: SlotLoadingAnimation,
    abort: () => void,
): void {
    if (result.ok && result.tradeable) {
        let qtyToStore: number | null = null;
        if (slotIndex >= 0 && stackQty) {
            const slot = inventory.getSlot(slotIndex);
            if (slot?.isStackable && result.images && result.images.length > 0) {
                const picked = pickImageForQuantity(result.images, stackQty);
                qtyToStore = picked?.count ?? null;
            }
        }
        log(`Manual unlock Wiki: "${itemName}" tradeable = ${result.tradeable}`);
        if (slotHash) {
            addUnlockedItem(itemName, result.tradeable.toLowerCase() === "yes", slotHash, qtyToStore, true);
        }
        void resolveImageUrl(itemName, qtyToStore).then(({ url, displayLabel }) => {
            recordUnlock(itemName, url, displayLabel).catch(() => {});
        });
        closeManualUnlock();
    } else if (result.disambig && result.disambig.length > 0) {
        if (result.disambig.length === 1) {
            const name = result.disambig[0].name;
            log(`Manual unlock disambig: only one "${name}", continuing`);
            void fetchItemTradeable(name).then(r =>
                handleWikiResult(r, name, slotHash, slotIndex, stackQty, anim, abort));
            return;
        }
        showDisambiguation(result.disambig,
            (name: string) => {
                log(`Manual unlock disambig: selected "${name}"`);
                void fetchItemTradeable(name).then(r =>
                    handleWikiResult(r, name, slotHash, slotIndex, stackQty, anim, abort));
            },
            () => { log("Manual unlock disambig: abandoned"); abort(); });
    } else if (result.status !== undefined) {
        showNotification(`Failed to query Wiki API (${result.status})`, 3000, "danger");
        abort();
    } else {
        showNotification("Failed to query Wiki API (no tradeable data)", 3000, "danger");
        abort();
    }
}
