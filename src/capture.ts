// capture.ts — inventory capture lifecycle for Bronzeman Mode
import * as Inventory from "./inventory";
import { state, captureFullRs, showNotification, NotificationHandle, log, setRetryingCapture } from "./core";
import { updateUI } from "./ui";
import { drawDetectDebug, updateGridBoundary } from "./overlay";

// ============================================================
// Toggle auto-capture on/off
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

// ============================================================
// Run fingerprint detection
// ============================================================

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
            log("Scrollbar detected — cannot capture");
            return;
        }
        if (anc) {
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
            stopRetryRecapture();
        } else {
            state.calibrating = false;
            updateUI();
            if (state.autocapture) startRetryRecapture();
        }
    } catch (e) {
        log("Capture error: " + e);
        state.calibrating = false;
        updateUI();
        showNotification("Error", 3000, "danger");
    }
}

// ============================================================
// Clear all calibration data
// ============================================================

export function clearReference(): void {
    state.calibrating = false;
    stopRetryRecapture();
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
