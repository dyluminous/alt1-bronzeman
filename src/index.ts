// Bronzeman Mode — Alt1 plugin
// Tracks which items you've earned yourself before allowing GE purchases.
import * as a1lib from "alt1";
import * as Inventory from "./inventory";
import {
    state,
    captureFullRs, showNotification, NotificationHandle, log, setRetryingCapture,
} from "./core";
import {
    updateAlt1Status, updateUI, updateAnchorDot,
    drawDetectDebug,
} from "./ui";
import { loadState, unlockItem, resetUnlocks as dataResetUnlocks, getIgnoredItems, getIgnoredCount, clearIgnoredItems, removeIgnoredItem, initIgnoreDB } from "./data";

import "./index.html";
import "./appconfig.json";
import "./icon.png";


// ============================================================
// Initialization
// ============================================================

export function initOnLoad() {
    log("Bronzeman initializing...");

    state.inAlt1 = typeof window.alt1 !== "undefined";
    log(`inAlt1=${state.inAlt1}`);

    updateAlt1Status();
    loadState();
    initIgnoreDB().then(() => updateUI());

    if (state.inAlt1) {
        alt1.identifyAppUrl("./appconfig.json");

        const saved = Inventory.loadAnchor();
        if (saved) {
            log(`[init] Anchor loaded at (${saved.x},${saved.y}) — validating...`);
            try {
                const img = captureFullRs();
                if (!img) {
                    log("[init] captureFullRs returned null — clearing anchor.");
                    Inventory.clearAnchor();
                } else {
                    const ok = Inventory.validateAnchor(img, saved, (msg) => log("  [validate] " + msg));
                    log(`[init] validateAnchor returned: ${ok}`);
                    if (ok) {
                        log("Anchor valid — grid online.");
                        showNotification("Inventory calibrated", 2000, "success");
                        drawDetectDebug(saved, false);
                        updateGridBoundary();
                    } else {
                        log("Anchor INVALID — cleared. Recapture.");
                        showNotification("Calibration failed", 2000, "danger");
                        drawDetectDebug(saved, true);
                        Inventory.clearAnchor();
                    }
                }
            } catch (e) {
                log("Anchor validation error: " + e + " — clearing anchor.");
                Inventory.clearAnchor();
            }
        } else {
            log("No anchor saved. Click Capture to set grid position.");

        }
    }

    updateUI();

    // Flash setup tab icon red when auto-capture is off
    let flashOn = false;
    setInterval(() => {
        const img = document.getElementById("setup-tab-icon") as HTMLImageElement | null;
        if (!img) return;
        if (!state.autocapture) {
            flashOn = !flashOn;
            img.style.filter = flashOn ? "hue-rotate(-55deg) saturate(2)" : "";
        } else {
            img.style.filter = "";
            flashOn = false;
        }
    }, 1000);

    log(`Init done. inAlt1=${state.inAlt1}`);
}

// ============================================================
// Capture
// ============================================================



export function captureReference(): void {
    if (!state.inAlt1) { log("Not in Alt1."); return; }
    if (!alt1.permissionPixel) { log("No pixel permission."); return; }

    if (state.autocapture) {
        // Turn OFF
        state.autocapture = false;
        stopRetryRecapture();
        Inventory.clearAnchor();
        Inventory.clearAnchorPixel();
        Inventory.clearOuterPerm();
        Inventory.clearEmptySlotData();
        if (state.inAlt1) alt1.overLayClearGroup("bronzeman_boundary");

        updateUI();
        return;
    }

    // Turn ON — run fingerprint detection immediately
    state.autocapture = true;
    updateUI();
    doCaptureRef();
}

function doCaptureRef(): void {
    try {
        const img = captureFullRs();
        if (!img) {
            log("Capture failed — could not read RS screen.");
            state.calibrating = false;
            updateUI();
            showNotification("RS Unlinked", 3000, "danger");
            return;
        }

        const anc = Inventory.detectInventoryGrid(img);
        if (anc && anc.scrollbar) {
            // Log only — "Can't see the inventory" will show after 3 retries
            log("Scrollbar detected — cannot capture");
            return;
        }
        if (anc) {
            // Verify exactly 28 slots (accounting for last-row trim)
            const cols = anc.gridCols ?? 0;
            const rows = anc.gridRows ?? 0;
            const rawTotal = cols * rows;
            const slotCount = rawTotal > 28 ? 28 : rawTotal;
            if (slotCount !== 28) {
                log(`Grid rejected: ${cols}×${rows}=${rawTotal}, need 28`);
                return;
            }
            log(`Grid found: ${anc.gridCols}×${anc.gridRows} at (${anc.x},${anc.y}) col=${anc.colStride} row=${anc.rowStride}`);
            Inventory.saveAnchor(anc);
            Inventory.saveAnchorPixel(img, anc);
            Inventory.captureOuterPerm(img, anc, (msg) => log("  [outer] " + msg));
            Inventory.captureEmptySlotData(img, anc, (msg) => log("  [empty] " + msg));
            state.calibrating = false;
            showNotification("Inventory calibrated", 3000, "success");
            drawDetectDebug(anc, false);
            updateGridBoundary();
            updateUI();
            stopRetryRecapture(); // stops retry if active, starts polling
        } else {
            state.calibrating = false;
            updateUI();
            // If auto-capture is on, start retry loop
            if (state.autocapture) startRetryRecapture();
        }
    } catch (e) {
        log("Capture error: " + e);
        state.calibrating = false;
        updateUI();
        showNotification("Error", 3000, "danger");
    }
}

export function clearReference(): void {
    state.calibrating = false;
    Inventory.clearAnchor();
    Inventory.clearAnchorPixel();
    Inventory.clearOuterPerm();
    Inventory.clearEmptySlotData();
    if (state.inAlt1) alt1.overLayClearGroup("bronzeman_boundary");
    log("Anchor cleared. Capture again to set.");
    updateUI();
}

// ============================================================
// Retry recapture — fires every 1s until inventory found or 5min timeout
// ============================================================

let retryHandle: ReturnType<typeof setInterval> | null = null;
let retryStartMs = 0;
let retryCount = 0;
let retryNotifyHandle: NotificationHandle | null = null;
const RETRY_TIMEOUT_MS = 5 * 60 * 1000;

function startRetryRecapture(): void {
    if (retryHandle) return;
    retryStartMs = Date.now();
    retryCount = 0;
    setRetryingCapture(true);
    log("Starting recapture retries (5min timeout)...");
    retryHandle = setInterval(() => {
        if (Inventory.hasAnchor()) {
            stopRetryRecapture();
            return;
        }
        if (Date.now() - retryStartMs > RETRY_TIMEOUT_MS) {
            log("Recapture timed out after 5min.");
            stopRetryRecapture();
            return;
        }
        retryCount++;
        if (retryCount >= 3 && !retryNotifyHandle) {
            retryNotifyHandle = showNotification("Can't see the inventory", 0, "danger");
        }
        doCaptureRef();
    }, 1000);
}

function stopRetryRecapture(): void {
    if (retryHandle) { clearInterval(retryHandle); retryHandle = null; }
    if (retryNotifyHandle) { retryNotifyHandle.remove(); retryNotifyHandle = null; }
    setRetryingCapture(false);
    if (Inventory.hasAnchor()) {
        log("Recapture succeeded.");
    }
}

// Re-export data.ts functions for HTML onclick handlers
export { unlockItem, isUnlocked, getUnlockedCount, getUnlockedItems, resetData } from "./data";
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

// Ignore list tooltip handlers
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
    // Render so we can measure, then adjust
    el.style.left = left + "px";
    el.style.top = top_ + "px";
    const r = el.getBoundingClientRect();
    // Flip left if overflowing right edge
    if (r.left + r.width > window.innerWidth) {
        left = e.clientX - gap - r.width;
    }
    // Flip up if overflowing bottom edge
    if (r.top + r.height > window.innerHeight) {
        top_ = e.clientY - gap + yOffset - r.height;
    }
    // Clamp to viewport margins
    left = Math.max(4, Math.min(left, window.innerWidth - r.width - 4));
    top_ = Math.max(4, Math.min(top_, window.innerHeight - r.height - 4));
    el.style.left = left + "px";
    el.style.top = top_ + "px";
}

// Confirm dialog
let modalCallback: (() => void) | null = null;
export function showModal(message: string, level: "SAFE" | "WARNING" | "DANGER" | "INFO", onConfirm: () => void): void {
    const modal = document.getElementById("modal");
    const content = document.getElementById("modal_content");
    const msgEl = document.getElementById("modal_msg");
    if (!modal || !content || !msgEl) return;
    msgEl.textContent = message;
    content.className = "modal-content" + (level === "WARNING" ? " level-warning" : level === "DANGER" ? " level-danger" : level === "INFO" ? " level-info" : "");
    modalCallback = onConfirm;
    modal.style.display = "flex";
}
export function modalCancel(): void {
    const modal = document.getElementById("modal");
    if (modal) modal.style.display = "none";
    modalCallback = null;
}
export function modalOk(): void {
    const modal = document.getElementById("modal");
    if (modal) modal.style.display = "none";
    if (modalCallback) {
        const cb = modalCallback;
        modalCallback = null;
        cb();
    }
}

export function debugFindSlot(): void {
    if (!state.inAlt1) { log("Not in Alt1"); return; }
    const img = captureFullRs();
    if (!img) { log("Failed to capture"); return; }

    const t0 = Date.now();
    const anc = Inventory.detectInventoryGrid(img);
    const ms = Date.now() - t0;

    if (anc && anc.scrollbar) {
        log(`Scrollbar detected at (${anc.x},${anc.y}) — cannot capture`);
        showNotification("Cannot capture inventory, detected scrollbar", 5000, "danger");
        return;
    }

    if (anc) {
        log(`Grid found: ${anc.gridCols}×${anc.gridRows} at (${anc.x},${anc.y}) col=${anc.colStride} row=${anc.rowStride} in ${ms}ms`);

        const total = (anc.gridCols ?? 4) * (anc.gridRows ?? 7);
        const lastRowCols = total > 28 ? (anc.gridCols ?? 4) - (total - 28) : (anc.gridCols ?? 4);

        // Draw full grid with numbers
        const yc = a1lib.mixColor(255, 255, 0);
        const white = a1lib.mixColor(255, 255, 255);
        const dur = 5000, sh = 34, sw = 38;
        const hitX = anc.x - 1, hitY = anc.y + 32; // BL corner from anchor
        const cols = anc.gridCols ?? 4, rows = anc.gridRows ?? 7;
        alt1.overLaySetGroup("bronzeman_fingerprint");
        alt1.overLayClearGroup("bronzeman_fingerprint");
        let slotNum = 0;
        for (let r = 0; r < rows; r++) {
            const slotCols = (r === rows - 1) ? lastRowCols : cols;
            for (let c = 0; c < slotCols; c++) {
                slotNum++;
                const sx = hitX + c * anc.colStride;
                const sy = hitY - 33 + r * anc.rowStride;
                alt1.overLayRect(yc, sx, sy, sw, 1, dur, 1);
                alt1.overLayRect(yc, sx, sy + sh - 1, sw, 1, dur, 1);
                alt1.overLayRect(yc, sx, sy, 1, sh, dur, 1);
                alt1.overLayRect(yc, sx + sw - 1, sy, 1, sh, dur, 1);
                alt1.overLayText(String(slotNum), white, 10, sx + sw / 2 - 6, sy + sh / 2 - 5, dur);
            }
        }
        const totalMs = Date.now() - t0;
        log(`Total: ${totalMs}ms`);
    } else {
        log(`No inventory found in ${ms}ms`);
    }
}

// Grid boundary overlay
// ============================================================

let showGridBoundary = false;

export function updateGridBoundary(): void {
    const cb = document.getElementById("show_grid_boundary") as HTMLInputElement;
    showGridBoundary = cb?.checked ?? false;
    log(`updateGridBoundary: show=${showGridBoundary} inAlt1=${state.inAlt1}`);
    if (!state.inAlt1) return;
    if (!showGridBoundary) {
        alt1.overLayClearGroup("bronzeman_boundary");
    }
}

// ============================================================
// Bootstrap
// ============================================================

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initOnLoad);
} else {
    initOnLoad();
}
