// ui.ts — DOM rendering and RS overlay drawing for Bronzeman Mode
import * as a1lib from "alt1";
import * as Inventory from "./inventory";
import { state, escHtml, updateAnchorWarning } from "./core";
import { getUnlockedCount, getUnlockedItems, getUnlockedItemData, getIgnoredCount, getIgnoredItems } from "./data";
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

export function updateScanStatus(s: string): void {
    const el = document.getElementById("scan_status");
    if (el) el.textContent = s;
    const sc = document.getElementById("scan_count_debug");
    if (sc) sc.textContent = String(state.scanCount);
}

// ============================================================
// Main UI
// ============================================================


export function updateAnchorDot(): void {
    const el = document.getElementById("anchor_dot");
    if (!el) return;
    const anc = Inventory.loadAnchor();
    if (anc) {
        el.className = "anchor-dot";
    } else {
        el.className = "anchor-dot hidden";
    }
}

export function updateUI(): void {
    const count = getUnlockedCount();
    const ue = document.getElementById("unlocked_count_items");
    if (ue) ue.textContent = String(count);

    const rl = document.getElementById("recent_list");
    if (rl) rl.style.display = "none";

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

    // Render recent ignores (last 3) — pickup-card style
    const riCount = document.getElementById("recent_ignore_count");
    if (riCount) riCount.textContent = String(getIgnoredCount());
    const riList = document.getElementById("recent_ignores_list");
    if (riList) {
        const items = getIgnoredItems();
        if (items.length === 0) {
            riList.innerHTML = '<div style="color:#555;text-align:center;padding:4px;">No items ignored yet.</div>';
        } else {
            const last3 = items.slice(-3).reverse();
            riList.innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:4px;">` +
                last3.map(i =>
                    `<div class="pickup-card ignore-card" style="cursor:pointer;"
                        onclick="Bronzeman.removeIgnore('${i.hash}')"
                        onmouseenter="Bronzeman.showIgnoreTooltip('${escHtml(i.name ?? "")}')"
                        onmouseleave="Bronzeman.hideIgnoreTooltip()"
                        onmousemove="Bronzeman.moveIgnoreTooltip(event)">
                        <div class="pickup-img-wrap">
                            ${i.base64 ? `<img src="${i.base64}" alt="${escHtml(i.name ?? "")}">` : `<div style="width:36px;height:32px;"></div>`}
                        </div>
                    </div>`
                ).join("") + `</div>`;
        }
    }

    if (state.lastScanResult) {
        const ae = document.getElementById("anchor_info");
        if (ae) ae.textContent = `Anchor: (${state.lastScanResult.anchor.x}, ${state.lastScanResult.anchor.y}) via ${state.lastScanResult.anchor.method}`;
    }

    const calBtn = document.getElementById("calibrate_btn");
    if (calBtn) {
        const anc = Inventory.loadAnchor();
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
    const rows = anc.gridRows ?? Inventory.ROWS;
    const cols = anc.gridCols ?? Inventory.COLS;
    const total = cols * rows;
    const lastRowCols = total > 28 ? cols - (total - 28) : cols;
    for (let row = 0; row < rows; row++) {
        const slotCols = (row === rows - 1) ? lastRowCols : cols;
        for (let col = 0; col < slotCols; col++) {
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


