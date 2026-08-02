// ui.ts — DOM rendering and UI action handlers for Bronzeman Mode
import { inventory } from "./inventory";
import { InventorySlot } from "./inventory-slot";
import { state, escHtml, showNotification, log, captureFullRs } from "./core";
import { getUnlockedCount, getUnlockedItemData, resetUnlocks as dataResetUnlocks } from "./data";
import { getItemRecord, hashToPngDataUrl } from "./data";
import { showModal } from "./modal";
import { getObscuredSlotIndices, isNotedItem, isInUseState } from "./slot-scan";
import type { DisambiguationOption } from "./wiki";
import { BUILD_NUM } from "./version";

// ============================================================
// Status bar
// ============================================================

export function updateAlt1Status(): void {
    const dot = document.getElementById("alt1_status_dot");
    const text = document.getElementById("alt1_status_text");
    if (!dot || !text) return;
    if (state.inAlt1) {
        dot.className = "status-dot green";
        text.textContent = `Build #${BUILD_NUM}`;
    } else {
        dot.className = "status-dot red";
        text.textContent = `Build #${BUILD_NUM} (no alt1)`;
    }
}

// ============================================================
// Anchor dot + warning
// ============================================================

function updateAnchorDot(): void {
    const el = document.getElementById("anchor_dot");
    if (!el) return;
    const anc = inventory.anchor;
    el.className = anc ? "anchor-dot" : "anchor-dot hidden";
}

let anchorWarningHandle: import("./core").NotificationHandle | null = null;

function updateAnchorWarning(): void {
    try {
        if (inventory.anchor) {
            if (anchorWarningHandle) { anchorWarningHandle.remove(); anchorWarningHandle = null; }
        } else {
            if (!anchorWarningHandle) {
                // Don't show during retry — capture.ts handles its own notifications
                anchorWarningHandle = showNotification("Inventory not captured", 0, "danger");
            }
        }
    } catch {
        if (!anchorWarningHandle) {
            anchorWarningHandle = showNotification("Inventory not captured", 0, "danger");
        }
    }
}

// ============================================================
// Main UI render
// ============================================================

export function updateUI(): void {
    const count = getUnlockedCount();
    const ue = document.getElementById("unlocked_count_items");
    if (ue) ue.textContent = String(count);

    // Render unlocks
    const ug = document.getElementById("unlocked_grid");
    if (ug) {
        const data = getUnlockedItemData();
        if (data.length === 0) {
            ug.style.display = "none";
        } else {
            ug.style.display = "flex";
            ug.innerHTML = data.slice().reverse().map(d =>
                `<div class="unlocked-thumb" title="${escHtml(d.name)}">
                    <img src="${d.base64}" alt="${escHtml(d.name)}">
                    <div class="unlocked-label">${escHtml(d.name)}</div>
                </div>`
            ).join("");
        }
    }

    const calBtn = document.getElementById("calibrate_btn");
    if (calBtn) {
        if (state.calibrating) {
            calBtn.textContent = "Scanning...";
            calBtn.style.pointerEvents = "none";
            calBtn.style.opacity = "0.5";
        } else {
            calBtn.textContent = state.autocapture ? "Stop auto-capture" : "Start auto-capture";
            calBtn.style.pointerEvents = "";
            calBtn.style.opacity = "";
        }
    }

    updateAnchorDot();
    updateAnchorWarning();
}

// ============================================================
// Slot hash debug pane
// ============================================================

let slotDebugTimer: ReturnType<typeof setInterval> | null = null;
/** Whether the pane shows the occlusion gate (blocked cells) or the last-valid pixels. */
let showOccludedSlots = true;

export function openSlotDebug(): void {
    const pane = document.getElementById("slot_debug_pane");
    if (!pane) return;
    pane.style.display = "flex";
    const cb = document.getElementById("slot_debug_show_occluded") as HTMLInputElement | null;
    if (cb) showOccludedSlots = cb.checked;
    renderSlotDebug();
    if (!slotDebugTimer) {
        // Keep the pane in sync with the slot-scan hashes as they update.
        slotDebugTimer = setInterval(renderSlotDebug, 500);
    }
}

export function closeSlotDebug(): void {
    if (slotDebugTimer) { clearInterval(slotDebugTimer); slotDebugTimer = null; }
    const pane = document.getElementById("slot_debug_pane");
    if (pane) pane.style.display = "none";
}

/** Re-render immediately after the checkbox toggles (called from HTML onchange). */
export function refreshSlotDebug(): void {
    const cb = document.getElementById("slot_debug_show_occluded") as HTMLInputElement | null;
    if (cb) showOccludedSlots = cb.checked;
    renderSlotDebug();
}

function renderSlotDebug(): void {
    const grid = document.getElementById("slot_debug_grid");
    if (!grid) return;
    const slots = inventory.slots;
    if (slots.length === 0) {
        grid.innerHTML = '<div class="slot-debug-note">Inventory not calibrated.</div>';
        return;
    }
    // Capture once, then draw every slot's interior from the same buffer.
    const img = captureFullRs();
    // Slots covered by tooltips/menus or under/adjacent to the cursor are
    // obscured — don't render their (possibly occluded) pixels in the pane.
    const obscured = img ? getObscuredSlotIndices(img) : new Set<number>();
    // Preserve the grid orientation (columns from calibration).
    grid.style.gridTemplateColumns = `repeat(${inventory.cols}, minmax(64px, auto))`;
    grid.innerHTML = slots.map(slot => {
        const h = slot.previousHash;
        // Noted items are skipped by the scan (previousHash stays null) but are
        // NOT empty — give them their own border colour.
        const noted = !!img && isNotedItem(slot, img);
        const inuse = !!img && isInUseState(slot, img);
        const empty = !noted && !inuse && (h === null || h === "empty");
        const blocked = obscured.has(slot.index) && showOccludedSlots;
        const cls = [
            "slot-debug-cell",
            noted ? " noted" : "",
            inuse ? " inuse" : "",
            empty ? " empty" : "",
            blocked ? " blocked" : "",
        ].join("");
        return `<div class="${cls}" title="${escHtml(h ?? "")}">
            <canvas class="slot-debug-canvas" width="36" height="32"></canvas>
            <div class="idx">#${slot.index}</div>
        </div>`;
    }).join("");

    if (!img) return;
    slots.forEach((slot, i) => {
        const canvas = grid.children[i]?.querySelector("canvas");
        const ctx = canvas?.getContext("2d");
        if (!canvas || !ctx) return;
        if (obscured.has(slot.index)) {
            // Occluded slot: show the occlusion gate (blank + red) or the last
            // cleanly-scanned pixels, depending on the toggle.
            if (!showOccludedSlots && slot.lastValidPixels) {
                const imgData = new ImageData(new Uint8ClampedArray(slot.lastValidPixels), InventorySlot.INTERIOR_W, InventorySlot.INTERIOR_H);
                ctx.putImageData(imgData, 0, 0);
            }
            return;
        }
        // Interior of the slot cell: 36×32, skipping the 1px border.
        const d = img.toData(slot.interiorX, slot.interiorY, InventorySlot.INTERIOR_W, InventorySlot.INTERIOR_H);
        if (d) ctx.putImageData(d, 0, 0);
    });
}

export function resetUnlocks(): void {
    showModal("Delete all unlocked items?", "DANGER", () => {
        dataResetUnlocks();
        updateUI();
    });
}

// ============================================================
// Wiki disambiguation pane — "the wiki returns multiple results"
// ============================================================

let disambigOptions: DisambiguationOption[] = [];
let disambigOnSelect: ((name: string) => void) | null = null;
let disambigOnClose: (() => void) | null = null;

/** Open the pane with the wiki's disambiguation options. */
export function showDisambiguation(options: DisambiguationOption[], onSelect: (name: string) => void, onClose?: () => void): void {
    disambigOptions = options;
    disambigOnSelect = onSelect;
    disambigOnClose = onClose ?? null;
    const pane = document.getElementById("wiki_disambig_pane");
    const body = document.getElementById("wiki_disambig_body");
    if (!pane || !body) return;
    body.innerHTML =
        '<div class="wiki-disambig-msg">The wiki returns multiple results for this item. Select the one that matches.</div>' +
        options.map((o, i) =>
            `<div class="wiki-disambig-row" onclick="Bronzeman.selectDisambiguationOption(${i})">` +
            `<span class="wiki-disambig-name">${escHtml(o.name)}</span>` +
            (o.description ? `<span class="wiki-disambig-desc">${escHtml(o.description)}</span>` : "") +
            `</div>`
        ).join("");
    pane.style.display = "flex";
}

/** Called from the HTML rows — continue the pipeline with the picked name. */
export function selectDisambiguationOption(index: number): void {
    const opt = disambigOptions[index];
    const cb = disambigOnSelect;
    disambigOnClose = null; // a selection is not an abandon
    closeDisambiguation();
    if (opt && cb) cb(opt.name);
}

/** Close the pane without picking (✕ or click outside) — fires the abandon hook. */
export function closeDisambiguation(): void {
    disambigOptions = [];
    disambigOnSelect = null;
    const oc = disambigOnClose;
    disambigOnClose = null;
    const pane = document.getElementById("wiki_disambig_pane");
    if (pane) pane.style.display = "none";
    oc?.();
}

// ============================================================
// Item hash PNGs pane — debug: show each recorded hash as an image
// ============================================================

/** Open the pane showing every hash of the (currently hardcoded) item as a
 *  brightness-grid PNG. */
export async function openItemPngs(): Promise<void> {
    const pane = document.getElementById("item_pngs_pane");
    const body = document.getElementById("item_pngs_body");
    if (!pane || !body) return;
    const rec = await getItemRecord("tradable", "Airut bones");
    if (!rec) {
        body.innerHTML = '<div class="wiki-disambig-note">No record for "Airut bones" in unlocks_tradable.</div>';
    } else {
        body.innerHTML = `<div class="wiki-disambig-msg">"${escHtml(rec.name)}" — ${rec.hashes.length} hash(es). Hover a grid for its hash.</div>` +
            `<div style="display:flex;flex-wrap:wrap;gap:8px;">` +
            rec.hashes.map((h, i) => {
                const url = hashToPngDataUrl(h, 10);
                return `<div style="text-align:center;">
                    <img src="${url}" title="${escHtml(h)}" style="image-rendering:pixelated;border:1px solid #888;width:80px;height:80px;display:block;">
                    <div class="wiki-disambig-note">[${i}]</div>
                </div>`;
            }).join("") + `</div>`;
    }
    pane.style.display = "flex";
}

/** Close the item hash PNGs pane. */
export function closeItemPngs(): void {
    const pane = document.getElementById("item_pngs_pane");
    if (pane) pane.style.display = "none";
}
