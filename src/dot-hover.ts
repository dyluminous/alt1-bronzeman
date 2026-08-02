// dot-hover.ts — the gold-dot refresh + hover-to-unlock pipeline.
// Every non-unlocked slot gets a gold dot (kept alive by redraw); hovering a
// dot runs the slot loading animation while the tooltip name is OCR'd and the
// wiki is queried for tradeability; success stores the unlock and the dot
// disappears. The disambiguation pane blocks new scans until resolved.
import * as a1lib from "alt1";
import { inventory } from "./inventory";
import { InventorySlot } from "./inventory-slot";
import { state, captureFullRs, log, showNotification } from "./core";
import { SlotLoadingAnimation } from "./slot-animation";
import { SLOT_DOT_X, SLOT_DOT_Y, SLOT_DOT_W, loadGoldDotEncoded } from "./gold-dot";
import { getNonUnlockedSlotIndices } from "./slot-scan";
import { readStackableQuantity } from "./slot-scan";
import { readTooltipItemName } from "./tooltip-read";
import { fetchItemTradeable, pickImageForQuantity } from "./wiki";
import type { WikiQueryResult } from "./wiki";
import { addUnlockedItem, isHashUnlocked } from "./data";
import { recordUnlock } from "./recent-unlocks";
import { showDisambiguation, closeDisambiguation, updateUI } from "./ui";

const NON_UNLOCKED_DOT_GROUP = "bronzeman_nonunlock";
/** Redraw cadence for the dots — Alt1 overlay elements have a finite lifetime
 *  even when frozen, so dots are re-drawn with a fresh duration on a timer. */
const DOT_INTERVAL_MS = 250;
const DOT_DURATION_MS = 1000;

/** Hover-to-unlock pipeline state machine + dot redraw loop. */
class UnlockHoverFlow {
    private timer: ReturnType<typeof setInterval> | null = null;
    private encoded: string | null = null;
    /** The slots we've already drawn — redraw is skipped when nothing changed. */
    private drawnSlots: Set<number> = new Set();

    /** Which slot's gold dot is being hovered. */
    private hoveredDotSlot: number | null = null;
    private hoverAnimation: SlotLoadingAnimation | null = null;
    /** True once the hover flow fully resolved (success or failure) — no restart
     *  while the mouse stays on the dot. Reset when the mouse leaves. */
    private hoverResolved = false;
    /** True while a wiki query is in flight. */
    private queryBusy = false;
    /** True while the disambiguation pane is open — blocks new scans until the
     *  user picks an option or closes the pane. */
    private disambigOpen = false;

    start(): void {
        void loadGoldDotEncoded().then(encoded => {
            this.encoded = encoded;
            if (!this.timer) this.timer = setInterval(() => this.refresh(), DOT_INTERVAL_MS);
        }).catch(() => log("Failed to load gold dot image"));
    }

    stop(): void {
        if (this.timer) { clearInterval(this.timer); this.timer = null; }
        this.encoded = null;
        this.drawnSlots = new Set();
        this.hoveredDotSlot = null;
        this.hoverResolved = false;
        this.queryBusy = false;
        this.disambigOpen = false;
        closeDisambiguation();
        if (this.hoverAnimation) { this.hoverAnimation.stop(); this.hoverAnimation = null; }
        try {
            alt1.overLaySetGroup(NON_UNLOCKED_DOT_GROUP);
            alt1.overLayClearGroup(NON_UNLOCKED_DOT_GROUP);
        } catch { /* group already gone */ }
    }

    // ----------------------------------------------------------
    // Hover → wiki pipeline
    // ----------------------------------------------------------

    private finishHoverFlow(): void {
        if (this.hoverAnimation) { this.hoverAnimation.stop(); this.hoverAnimation = null; }
        this.hoverResolved = true;
    }

    private handleWikiResult(result: WikiQueryResult, queriedName: string, slotHash: string | null, slotIndex: number, stackQty: number | null): void {
        this.queryBusy = false;
        if (result.ok) {
            log(`Wiki: "${queriedName}" tradeable = ${result.tradeable}`);
            // Pick the stackable tier count from the wiki images: find the
            // largest count ≤ the OCR'd quantity.
            const slot = inventory.getSlot(slotIndex);
            const isStackable = !!slot?.isStackable;
            let qtyToStore: number | null = null;
            if (isStackable && result.images && result.images.length > 0 && stackQty) {
                const picked = pickImageForQuantity(result.images, stackQty);
                qtyToStore = picked?.count ?? null;
            }
            if (slotHash) {
                addUnlockedItem(queriedName, result.tradeable?.toLowerCase() === "yes", slotHash, qtyToStore);
            } else {
                log(`No slot hash available — skipping unlock record for "${queriedName}"`);
            }
            // Capture the slot interior for the recent-unlocks UI
            const img = captureFullRs();
            if (img) {
                const slot = inventory.getSlot(slotIndex);
                if (slot) {
                    const d = img.toData(slot.interiorX, slot.interiorY, InventorySlot.INTERIOR_W, InventorySlot.INTERIOR_H);
                    if (d) { recordUnlock(queriedName, new Uint8ClampedArray(d.data)); updateUI(); }
                }
            }
            this.finishHoverFlow();
        } else if (result.disambig && result.disambig.length > 0) {
            // Only one item option after filtering — continue without a dialog.
            if (result.disambig.length === 1) {
                const name = result.disambig[0].name;
                log(`Wiki disambiguation: only one item "${name}", continuing`);
                this.queryBusy = true;
                void fetchItemTradeable(name).then(r => this.handleWikiResult(r, name, slotHash, slotIndex, stackQty));
                return;
            }
            // Ask the user which option is the right item — animation keeps running.
            this.disambigOpen = true;
            showDisambiguation(result.disambig,
                (name) => {
                    this.disambigOpen = false;
                    log(`Wiki disambiguation: selected "${name}"`);
                    this.queryBusy = true;
                    void fetchItemTradeable(name).then(r => this.handleWikiResult(r, name, slotHash, slotIndex, stackQty));
                },
                () => {
                    // ✕ or click-outside — abandoned, end the flow.
                    this.disambigOpen = false;
                    log("Wiki disambiguation: abandoned");
                    this.finishHoverFlow();
                });
        } else if (result.status !== undefined) {
            showNotification(`Failed to query item via Wiki API (${result.status})`, 3000, "danger");
            this.finishHoverFlow();
        } else {
            showNotification("Failed to query item via Wiki API (no tradeable data)", 3000, "danger");
            this.finishHoverFlow();
        }
    }

    private startHoverFlow(slotIndex: number): void {
        if (this.hoverAnimation === null) {
            const slot = inventory.getSlot(slotIndex);
            if (slot) {
                this.hoverAnimation = new SlotLoadingAnimation(slot);
                this.hoverAnimation.start();
            }
        }
        // The scanned interior hash of this slot — the item identity used for storage.
        const slot = inventory.getSlot(slotIndex);
        const slotHash = slot && slot.previousHash && slot.previousHash !== "empty" ? slot.previousHash : null;
        let stackQty: number | null = null;
        if (slot?.isStackable) {
            const qty = readStackableQuantity(slotIndex);
            if (qty) {
                const n = parseInt(qty, 10);
                if (!isNaN(n)) { stackQty = n; log(`Stackable quantity slot ${slotIndex}: ${n}`); }
            }
        }
        const itemName = readTooltipItemName();
        if (!itemName) {
            showNotification("Failed to read item name", 3000, "danger");
            if (this.hoverAnimation) { this.hoverAnimation.stop(); this.hoverAnimation = null; }
            // Mark resolved so the guard doesn't retry (and re-notify) every
            // 250ms tick while the mouse stays on the dot. The mouse leaving
            // the dot resets hoverResolved, allowing one retry per hover.
            this.hoverResolved = true;
            return;
        }
        log(`Hovered item: "${itemName}" (slot ${slotIndex}) hash=${slotHash ? slotHash.slice(0, 12) + "…" : "n/a"}`);
        this.queryBusy = true;
        void fetchItemTradeable(itemName).then(result => this.handleWikiResult(result, itemName, slotHash, slotIndex, stackQty));
    }

    // ----------------------------------------------------------
    // Dot redraw loop
    // ----------------------------------------------------------

    private refresh(): void {
        if (!state.inAlt1 || !inventory.isCalibrated || !this.encoded) return;
        const indices = getNonUnlockedSlotIndices();

        // Hover detection over the gold dots. The animation is NOT stopped when
        // the mouse leaves — it runs until the wiki pipeline resolves or is
        // abandoned.
        const mouse = a1lib.getMousePosition();
        let overIdx: number | null = null;
        if (mouse) {
            indices.forEach(idx => {
                if (overIdx !== null) return; // already found
                const s = inventory.getSlot(idx);
                if (!s) return;
                const dx = s.x + SLOT_DOT_X, dy = s.y + SLOT_DOT_Y;
                if (mouse.x >= dx && mouse.x < dx + SLOT_DOT_W && mouse.y >= dy && mouse.y < dy + SLOT_DOT_W) {
                    overIdx = idx;
                }
            });
        }
        if (overIdx !== this.hoveredDotSlot) {
            this.hoveredDotSlot = overIdx;
            this.hoverResolved = false;
        }
        // Guard: no new scan while a query is in flight or the disambiguation
        // pane is up — prevents overlapping query boxes / breaking the workflow.
        if (this.hoveredDotSlot !== null && !this.hoverResolved && !this.queryBusy && !this.disambigOpen && this.hoverAnimation === null) {
            this.startHoverFlow(this.hoveredDotSlot);
        }

        // Filter out slots whose previousHash is already unlocked — the
        // scanner hasn't re-read these yet (they're covered by the tooltip),
        // but the hover flow already stored the hash. The dot must disappear
        // immediately after the unlock, not after mouse-leave.
        const toDrawArr: number[] = [];
        indices.forEach(idx => {
            const slot = inventory.getSlot(idx);
            if (slot?.previousHash && slot.previousHash !== "empty" && isHashUnlocked(slot.previousHash)) return;
            toDrawArr.push(idx);
        });

        // Redraw with a fresh duration every tick so dots never expire mid-frame
        // (no clear on steady state = no flicker). Only clear when the set changed,
        // so removed slots' dots vanish promptly.
        const same = toDrawArr.length === this.drawnSlots.size
            && toDrawArr.every(i => this.drawnSlots.has(i));
        alt1.overLaySetGroup(NON_UNLOCKED_DOT_GROUP);
        if (!same) {
            alt1.overLayClearGroup(NON_UNLOCKED_DOT_GROUP);
            this.drawnSlots = new Set(toDrawArr);
        }
        toDrawArr.forEach(idx => {
            const slot = inventory.getSlot(idx);
            if (!slot) return;
            alt1.overLayImage(slot.x + SLOT_DOT_X, slot.y + SLOT_DOT_Y, this.encoded!, SLOT_DOT_W, DOT_DURATION_MS);
        });
    }
}

/** Module-wide singleton. */
const unlockHoverFlow = new UnlockHoverFlow();

export const startNonUnlockedDotRefresh = (): void => unlockHoverFlow.start();
export const stopNonUnlockedDotRefresh = (): void => unlockHoverFlow.stop();
