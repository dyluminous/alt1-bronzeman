// ui.ts — DOM rendering and RS overlay drawing for Bronzeman Mode
import * as a1lib from "alt1";
import * as Inventory from "./inventory";
import { state, POLL_INTERVAL_MS, escHtml } from "./core";
import { getUnlockedCount, getUnlockedItems, getUnlockedItemData } from "./data";

// ============================================================
// Status bar
// ============================================================

export function updateAlt1Status(): void {
    const dot = document.getElementById("alt1_status_dot");
    const text = document.getElementById("alt1_status_text");
    if (!dot || !text) return;
    if (state.inAlt1) { dot.className = "status-dot green"; text.textContent = "Alt1 connected"; }
    else { dot.className = "status-dot red"; text.textContent = "Alt1 not detected"; }
}

export function updateScanStatus(s: string): void {
    const el = document.getElementById("scan_status");
    if (el) el.textContent = s;
    const sc = document.getElementById("scan_count_debug");
    if (sc) sc.textContent = String(state.scanCount);
}

// ============================================================
// Main UI
// ============================================================

export function updateUI(): void {
    const count = getUnlockedCount();
    const ue = document.getElementById("unlocked_count_items");
    if (ue) ue.textContent = String(count);

    const rl = document.getElementById("recent_list");
    if (rl) {
        if (count === 0) {
            rl.innerHTML = '<div style="color:#555;text-align:center;padding:8px;">No items unlocked yet.</div>';
        } else {
            rl.innerHTML = getUnlockedItems().slice(-10).reverse()
                .map(item => `<div class="item-row unlocked"><span class="item-name">${escHtml(item)}</span><span class="item-badge unlocked">UNLOCKED</span></div>`)
                .join("");
        }
    }

    // Render unlocked grid with images
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

    if (state.lastScanResult) {
        const ae = document.getElementById("anchor_info");
        if (ae) ae.textContent = `Anchor: (${state.lastScanResult.anchor.x}, ${state.lastScanResult.anchor.y}) via ${state.lastScanResult.anchor.method}`;
    }

    const calBtn = document.getElementById("calibrate_btn");
    if (calBtn) {
        const anc = Inventory.loadAnchor();
        calBtn.textContent = anc ? `📷 Re-capture (${anc.colStride},${anc.rowStride})` : "📷 Capture";
    }
}

// ============================================================
// Debug tab: mini-grid
// ============================================================

export function updateDebugGrid(result: Inventory.ScanResult | null, discarded = false, pending: Set<number> = new Set()): void {
    const gridEl = document.getElementById("slot_grid");
    if (!gridEl) return;
    if (!result) { gridEl.innerHTML = '<div style="color:#555;text-align:center;padding:20px;">Waiting...</div>'; return; }

    let html = '<div class="mini-grid">';
    for (let row = 0; row < 7; row++) {
        html += '<div class="mini-grid-row">';
        for (let col = 0; col < 4; col++) {
            const slot = result.slots[row * 4 + col];
            let cls = "mini-slot";
            if (slot.changed) {
                if (pending.has(slot.index)) cls += " pending";
                else if (discarded) cls += " skipped";
                else cls += " changed";
            }
            const sh = slot.hash.slice(-4) || "----";
            html += `<div class="${cls}" title="Slot ${slot.index + 1} [r${row},c${col}]&#10;Hash: ${slot.hash}&#10;Diff: ${slot.diffScore} (thresh=24)">
                <span class="mini-slot-num">${slot.index + 1}</span>
                <span class="mini-slot-hash">${sh}</span></div>`;
        }
        html += "</div>";
    }
    html += "</div>";
    gridEl.innerHTML = html;

    updateUI();
}

// ============================================================
// Scan tab — show latest pickup
// ============================================================

/** Current pickup image URL and slot index for the Unlock button. */
let currentPickupUrl: string = "";
let currentPickupSlot: number = -1;

export function showScanPickup(imageUrl: string, slotIndex: number): void {
    currentPickupUrl = imageUrl;
    currentPickupSlot = slotIndex;

    const ph = document.getElementById("scan_placeholder");
    const area = document.getElementById("scan_pickup_area");
    const img = document.getElementById("scan_pickup_img") as HTMLImageElement;

    if (ph) ph.style.display = "none";
    if (area) area.style.display = "block";
    if (img) img.src = imageUrl;
}

export function getCurrentPickup(): { imageUrl: string; slotIndex: number } {
    return { imageUrl: currentPickupUrl, slotIndex: currentPickupSlot };
}

export function appendChangeEntry(slot: Inventory.SlotState, time: number): void {
    const list = document.getElementById("change_list");
    if (!list) return;
    const entry = document.createElement("div");
    entry.className = "change-entry";
    entry.innerHTML = `<span class="change-slot">#${slot.index + 1} [r${slot.row},c${slot.col}]</span>
        <span class="change-hash">${slot.hash.slice(0, 8)}</span>
        <span class="change-time">${new Date(time).toLocaleTimeString()}</span>`;
    list.prepend(entry);
    while (list.children.length > 20) list.lastChild?.remove();
}

// ============================================================
// RS Overlays
// ============================================================

/** Draw corner brackets on all 28 detected slots. */
export function drawDetectDebug(anc: Inventory.BackpackAnchor, isError: boolean = false): void {
    if (!state.inAlt1) return;
    alt1.overLayClearGroup("bronzeman_detect");
    alt1.overLaySetGroup("bronzeman_detect");
    const LEN = 11;
    const dur = 2000;
    const yc = isError ? a1lib.mixColor(255, 60, 60) : a1lib.mixColor(255, 255, 0);
    for (let row = 0; row < Inventory.ROWS; row++) {
        for (let col = 0; col < Inventory.COLS; col++) {
            const sx = anc.x + col * anc.colStride;
            const sy = anc.y + row * anc.rowStride;
            const r = sx + 35, b = sy + 31;
            alt1.overLayRect(yc, sx, sy, LEN, 1, dur, 1);
            alt1.overLayRect(yc, sx, sy, 1, LEN, dur, 1);
            alt1.overLayRect(yc, r - LEN + 1, sy, LEN, 1, dur, 1);
            alt1.overLayRect(yc, r, sy, 1, LEN, dur, 1);
            alt1.overLayRect(yc, sx, b, LEN, 1, dur, 1);
            alt1.overLayRect(yc, sx, b - LEN + 1, 1, LEN, dur, 1);
            alt1.overLayRect(yc, r - LEN + 1, b, LEN, 1, dur, 1);
            alt1.overLayRect(yc, r, b - LEN + 1, 1, LEN, dur, 1);
        }
    }
}

export function drawSlotOverlaysFor(slots: Inventory.SlotState[], color: { r: number; g: number; b: number }, clearFirst = true): void {
    if (!state.inAlt1) return;
    if (clearFirst) {
        alt1.overLayClearGroup("bronzeman_slots");
        alt1.overLaySetGroup("bronzeman_slots");
    }
    const clr = a1lib.mixColor(color.r, color.g, color.b);
    for (const slot of slots) {
        alt1.overLayRect(clr, slot.x, slot.y, slot.w, slot.h, POLL_INTERVAL_MS + 200, 2);
        alt1.overLayText(String(slot.index + 1), a1lib.mixColor(255, 255, 255), 11, slot.x + 3, slot.y + 2, POLL_INTERVAL_MS + 200);
    }
}

export function drawSlotOverlays(result: Inventory.ScanResult, color?: { r: number; g: number; b: number }): void {
    const changed = result.slots.filter(s => s.changed);
    if (changed.length === 0) return;
    drawSlotOverlaysFor(changed, color || { r: 80, g: 200, b: 80 });

    alt1.overLaySetGroup("bronzeman_slots");
    alt1.overLayRect(a1lib.mixColor(212, 168, 75), result.anchor.x - 2, result.anchor.y - 2, 5, 5, POLL_INTERVAL_MS + 200, 1);
}

/** Check if RS cursor is inside the inventory grid — likely dragging/UI interaction */
export function isCursorInInventory(result: Inventory.ScanResult): boolean {
    try {
        const pos = a1lib.getMousePosition();
        if (!pos) return false;
        const anc = result.anchor;
        const pad = anc.colStride;
        const left = anc.x - pad, top = anc.y - pad;
        const right = anc.x + 4 * anc.colStride + pad;
        const bottom = anc.y + 7 * anc.rowStride + pad;
        return pos.x >= left && pos.x <= right && pos.y >= top && pos.y <= bottom;
    } catch { return false; }
}
