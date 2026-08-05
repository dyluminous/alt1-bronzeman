// ui.ts — DOM rendering and UI action handlers for Bronzeman Mode
import * as Inventory from "./inventory";
import { state, escHtml, showNotification, log } from "./core";
import { getUnlockedCount, getUnlockedItems, getUnlockedItemData, getIgnoredItems, getIgnoredCount, clearIgnoredItems, removeIgnoredItem, resetUnlocks as dataResetUnlocks } from "./data";
import { showModal } from "./modal";
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

export function updateAnchorDot(): void {
    const el = document.getElementById("anchor_dot");
    if (!el) return;
    const anc = Inventory.loadAnchor();
    el.className = anc ? "anchor-dot" : "anchor-dot hidden";
}

let anchorWarningHandle: import("./core").NotificationHandle | null = null;

export function updateAnchorWarning(): void {
    try {
        if (Inventory.loadAnchor()) {
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

    // Render recent ignores (last 3)
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
// Ignore list action handlers (called from HTML onclick)
// ============================================================

export function resetUnlocks(): void {
    showModal("Delete all unlocked items?", "DANGER", () => {
        dataResetUnlocks();
        updateUI();
    });
}

export function resetIgnores(): void {
    showModal("Delete all ignored items?", "DANGER", () => {
        clearIgnoredItems();
        showNotification("All ignored items cleared", 2000, "success");
        updateUI();
    });
}

export function dumpIgnoredItems(): void {
    const items = getIgnoredItems();
    if (items.length === 0) { log("Ignore list is empty."); return; }
    console.table(items.map(i => ({
        name: i.name ?? "(unnamed)",
        hash: i.hash.slice(0, 16) + "…",
        ignoredAt: new Date(i.ignoredAt).toLocaleString()
    })));
    log(`Ignore list: ${items.length} item(s) logged to console.`);
}

export function removeIgnore(hash: string): void {
    hideIgnoreTooltip();
    removeIgnoredItem(hash);
    updateUI();
}

// ============================================================
// Ignore list tooltip
// ============================================================

export function showIgnoreTooltip(name: string): void {
    const el = document.getElementById("ignore_tooltip");
    if (el) { el.textContent = name; el.style.display = "block"; }
}

export function hideIgnoreTooltip(): void {
    const el = document.getElementById("ignore_tooltip");
    if (el) el.style.display = "none";
}

export function moveIgnoreTooltip(e: MouseEvent): void {
    const el = document.getElementById("ignore_tooltip");
    if (!el) return;
    const gap = 12;
    const yOffset = 10;
    let left = e.clientX + gap;
    let top_ = e.clientY + gap + yOffset;
    el.style.left = left + "px";
    el.style.top = top_ + "px";
    const r = el.getBoundingClientRect();
    if (r.left + r.width > window.innerWidth) {
        left = e.clientX - gap - r.width;
    }
    if (r.top + r.height > window.innerHeight) {
        top_ = e.clientY - gap + yOffset - r.height;
    }
    left = Math.max(4, Math.min(left, window.innerWidth - r.width - 4));
    top_ = Math.max(4, Math.min(top_, window.innerHeight - r.height - 4));
    el.style.left = left + "px";
    el.style.top = top_ + "px";
}
