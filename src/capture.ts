// capture.ts — inventory capture lifecycle for Bronzeman Mode
import * as Detect from "./inventory-detect";
import { inventory } from "./inventory";
import { state, captureFullRs, showNotification, NotificationHandle, log } from "./core";
import { updateUI } from "./ui";
import { drawDetectDebug, updateGridBoundary, drawAnchorWatchDot, clearAnchorWatchDot } from "./overlay";
import { startSlotHover, stopSlotHover } from "./slot-hover";
import { startAnchorWatch, stopAnchorWatch } from "./anchor-watch";
import { startSlotScan, stopSlotScan, captureCornerRefs } from "./slot-scan";

// ============================================================
// Toggle auto-capture on/off
// ============================================================

export function captureReference(): void {
    if (!state.inAlt1) { log("Not in Alt1."); return; }
    if (!alt1.permissionPixel) { log("No pixel permission."); return; }

    if (state.autocapture) {
        // Turn OFF
        state.autocapture = false;
        stopGridSearch();
        stopSlotHover();
        stopAnchorWatch();
        stopSlotScan();
        inventory.clear();
        if (state.inAlt1) alt1.overLayClearGroup("bronzeman_boundary");
        updateUI();
        return;
    }

    // Turn ON — run fingerprint detection immediately
    state.autocapture = true;
    updateUI();
    calibrateGrid();
}

// ============================================================
// Run fingerprint detection
// ============================================================

export function calibrateGrid(opts?: { silent?: boolean }): void {
    try {
        const img = captureFullRs();
        if (!img) {
            log("Capture failed — could not read RS screen.");
            state.calibrating = false;
            updateUI();
            showNotification("RS Unlinked", 3000, "danger");
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
            if (!opts?.silent) showNotification("Inventory calibrated", 3000, "success");
            drawDetectDebug(false);
            updateGridBoundary();
            drawAnchorWatchDot();
            updateUI();
            stopGridSearch();
            startSlotHover();
            startSlotScan();
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
    inventory.clear();
    if (state.inAlt1) alt1.overLayClearGroup("bronzeman_boundary");
    log("Anchor cleared. Capture again to set.");
    updateUI();
}

// ============================================================
// Initial grid search — fires every 1s until inventory found or 5min timeout
// ============================================================

let gridSearchHandle: ReturnType<typeof setInterval> | null = null;
let gridSearchStarted = 0;
let gridSearchNotify: NotificationHandle | null = null;
const GRID_SEARCH_TIMEOUT_MS = 5 * 60 * 1000;

/** Format ms as mm:ss (e.g. 05:00), used for the scanning countdown. */
function formatCountdown(ms: number): string {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function startGridSearch(): void {
    if (gridSearchHandle) return;
    stopAnchorWatch(); // a fresh scan replaces the resize watch
    stopSlotScan();
    // A stale anchor means we were calibrated but can't see the inventory now.
    // Drop it so the interval below actually scans instead of instantly
    // stopping on the isCalibrated check.
    if (inventory.isCalibrated) {
        inventory.clear();
        updateUI();
    }
    gridSearchStarted = Date.now();
    log("Starting initial grid search (5min timeout)...");
    gridSearchNotify = showNotification(`Scanning... (${formatCountdown(GRID_SEARCH_TIMEOUT_MS)})`, 0, "info");
    gridSearchHandle = setInterval(() => {
        if (inventory.isCalibrated) {
            stopGridSearch();
            return;
        }
        const remaining = GRID_SEARCH_TIMEOUT_MS - (Date.now() - gridSearchStarted);
        if (remaining <= 0) {
            log("Grid search timed out after 5min.");
            stopGridSearch();
            return;
        }
        gridSearchNotify?.update(`Scanning... (${formatCountdown(remaining)})`);
        calibrateGrid();
    }, 1000);
}

function stopGridSearch(): void {
    const wasActive = gridSearchHandle !== null;
    if (gridSearchHandle) { clearInterval(gridSearchHandle); gridSearchHandle = null; }
    if (gridSearchNotify) { gridSearchNotify.remove(); gridSearchNotify = null; }
    // Only claim success when a search was actually running — the success path
    // of every normal calibrate calls stopGridSearch() too.
    if (wasActive && inventory.isCalibrated) {
        log("Grid search succeeded.");
    }
}
