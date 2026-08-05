// inventory-capture.ts — inventory capture lifecycle for Bronzeman Mode
import * as Detect from "./inventory-detect";
import { inventory } from "../../classes/inventory";
import { state, captureFullRs, showNotification, NotificationHandle, log, LS_KEYS } from "../../core";
import { updateUI } from "../../ui/ui";
import { drawDetectDebug, updateGridDebug, drawAnchorWatchDot, clearAnchorWatchDot, stopGeDetection, initGeDetection, geIsOpen } from "../overlay/overlay-draw";
import { startNonUnlockedDotRefresh, stopNonUnlockedDotRefresh } from "../unlock/unlock-hover";
import { startSlotHover, stopSlotHover } from "./inventory-hover";
import { startAnchorWatch, stopAnchorWatch } from "./inventory-resize-watch";
import { startSlotScan, stopSlotScan, captureCornerRefs } from "./inventory-scan";
import { formatElapsed } from "../../utils/helpers";

// ============================================================
// Auto-capture on/off — wired to the Developer mode checkbox.
// Auto-capture defaults ON at boot. stopAutoCapture/startAutoCapture
// are also used by the restore flow (pause capture while the DB
// is being rewritten, resume silently afterwards).
// ============================================================

export function stopAutoCapture(): void {
    if (!state.autocapture) return;
    state.autocapture = false;
    stopGridSearch();
    stopSlotHover();
    stopAnchorWatch();
    stopSlotScan();
    stopNonUnlockedDotRefresh();
    stopGeDetection();
    inventory.clear();
    updateUI();
}

export function startAutoCapture(opts?: { silent?: boolean }): void {
    if (state.autocapture) return;
    state.autocapture = true;
    updateUI();
    calibrateGrid(opts);
}

export function toggleAutoCapture(): void {
    if (!state.inAlt1) { log("Not in Alt1."); return; }
    if (!alt1.permissionPixel) { log("No pixel permission."); return; }
    if (state.autocapture) stopAutoCapture();
    else startAutoCapture();
}

// ============================================================
// Run fingerprint detection
// ============================================================

export function calibrateGrid(opts?: { silent?: boolean }): void {
    try {
        const img = captureFullRs();
        if (!img) {
            state.calibrating = false;
            updateUI();
            if (!opts?.silent) showNotification("RS Unlinked", 3000, "danger");
            return;
        }

        const anc = Detect.detectInventoryGrid(img);
        if (anc && anc.scrollbar) {
            log("Scrollbar detected — cannot capture");
            return;
        }
        if (anc) {
            const cols = anc.gridCols ?? 0;
            const rows = anc.gridRows ?? 0;
            if (inventory.getSlotCount(anc) !== 28) {
                log(`Grid rejected: ${cols}×${rows}=${cols * rows}, need 28`);
                return;
            }
            log(`Grid found: ${anc.gridCols}×${anc.gridRows} at (${anc.x},${anc.y}) col=${anc.colStride} row=${anc.rowStride}`);
            inventory.calibrate(anc);
            // Baseline the per-slot corner refs from the same capture detection
            // used (taken before any overlay drawing, so the refs are clean).
            captureCornerRefs(img);
            state.calibrating = false;
            state.autocapture = true;
            if (!opts?.silent) showNotification("Inventory found", 1000, "success");
            drawDetectDebug(false);
            updateGridDebug();
            drawAnchorWatchDot();
            updateUI();
            stopGridSearch();
            stopGeDetection(); // inventory found → GE is not open
            startSlotHover();
            startSlotScan();
            startNonUnlockedDotRefresh();
            startAnchorWatch(() => {
                // Hide the old dot while recalibrating — a failed re-capture
                // otherwise leaves a stale marker floating mid-slot.
                clearAnchorWatchDot();
                calibrateGrid({ silent: true });
            }, drawAnchorWatchDot);
        } else {
            state.calibrating = false;
            updateUI();
            // Auto-capture is on and the inventory can't be seen — start the
            // 5-min scan. startGridSearch drops any stale anchor so the scan
            // actually runs; the interval's isCalibrated check is for the case
            // where a parallel path already re-calibrated.
            if (state.autocapture) startGridSearch();
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
    stopGridSearch();
    stopSlotHover();
    stopAnchorWatch();
    stopSlotScan();
    stopNonUnlockedDotRefresh();
    stopGeDetection();
    inventory.clear();
    log("Anchor cleared. Capture again to set.");
    updateUI();
}

// ============================================================
// Hide "Scanning for inventory" notification
// ============================================================

let hideScanningNotification = localStorage.getItem(LS_KEYS.hideScanningNotification) === "1";

export function toggleHideScanningNotification(): void {
    hideScanningNotification = !hideScanningNotification;
    localStorage.setItem(LS_KEYS.hideScanningNotification, hideScanningNotification ? "1" : "0");
    // If the notification is currently showing and the user hides it, dismiss it.
    if (hideScanningNotification && gridSearchNotify) {
        gridSearchNotify.remove();
        gridSearchNotify = null;
    }
}

// ============================================================
// Initial grid search — fires every 1s until inventory found.
// No timeout: auto-capture is always-on, so the scan keeps trying
// until the backpack comes into view (or the user disables it).
// ============================================================

let gridSearchHandle: ReturnType<typeof setInterval> | null = null;
let gridSearchStarted = 0;
let gridSearchNotify: NotificationHandle | null = null;
let gridSearchNotifyTimer: ReturnType<typeof setTimeout> | null = null;

function startGridSearch(): void {
    if (gridSearchHandle) return;
    stopAnchorWatch(); // a fresh scan replaces the resize watch
    stopSlotScan();
    stopNonUnlockedDotRefresh();
    initGeDetection(); // inventory lost → GE might be open
    // A stale anchor means we were calibrated but can't see the inventory now.
    // Drop it so the interval below actually scans instead of instantly
    // stopping on the isCalibrated check.
    if (inventory.isCalibrated) {
        inventory.clear();
        updateUI();
    }
    gridSearchStarted = Date.now();
    log("Scanning for inventory...");
    // Delay the notification ~1s. If the GE is open (the usual reason the
    // inventory is hidden), GE detection finds it within that window and we
    // never show "Scanning" — avoids a flash-on-then-off.
    gridSearchNotifyTimer = setTimeout(() => {
        gridSearchNotifyTimer = null;
        if (!inventory.isCalibrated && !geIsOpen() && !hideScanningNotification) {
            gridSearchNotify = showNotification(`Scanning for inventory...\n(${formatElapsed(Date.now() - gridSearchStarted)})`, 0, "info");
        }
    }, 1000);
    gridSearchHandle = setInterval(() => {
        if (inventory.isCalibrated) {
            stopGridSearch();
            return;
        }
        gridSearchNotify?.update(`Scanning for inventory...\n(${formatElapsed(Date.now() - gridSearchStarted)})`);
        calibrateGrid({ silent: true });
    }, 1000);
}

function stopGridSearch(): void {
    const wasActive = gridSearchHandle !== null;
    if (gridSearchHandle) { clearInterval(gridSearchHandle); gridSearchHandle = null; }
    if (gridSearchNotifyTimer) { clearTimeout(gridSearchNotifyTimer); gridSearchNotifyTimer = null; }
    if (gridSearchNotify) { gridSearchNotify.remove(); gridSearchNotify = null; }
    // Only claim success when a search was actually running — the success path
    // of every normal calibrate calls stopGridSearch() too.
    if (wasActive && inventory.isCalibrated) {
        log("Grid search succeeded.");
    }
}
