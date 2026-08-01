// capture.ts — inventory capture lifecycle for Bronzeman Mode
import * as Inventory from "./inventory";
import { state, captureFullRs, showNotification, NotificationHandle, log, setSearchingGrid } from "./core";
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
        stopGridSearch();
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
    calibrateGrid();
}

// ============================================================
// Run fingerprint detection
// ============================================================

function calibrateGrid(): void {
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
            stopGridSearch();
        } else {
            state.calibrating = false;
            updateUI();
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
    Inventory.clearAnchor();
    Inventory.clearAnchorPixel();
    Inventory.clearOuterPerm();
    Inventory.clearEmptySlotData();
    if (state.inAlt1) alt1.overLayClearGroup("bronzeman_boundary");
    log("Anchor cleared. Capture again to set.");
    updateUI();
}

// ============================================================
// Initial grid search — fires every 1s until inventory found or 5min timeout
// ============================================================

let gridSearchHandle: ReturnType<typeof setInterval> | null = null;
let gridSearchStarted = 0;
let gridSearchTries = 0;
let gridSearchNotify: NotificationHandle | null = null;
const GRID_SEARCH_TIMEOUT_MS = 5 * 60 * 1000;

function startGridSearch(): void {
    if (gridSearchHandle) return;
    gridSearchStarted = Date.now();
    gridSearchTries = 0;
    setSearchingGrid(true);
    log("Starting initial grid search (5min timeout)...");
    gridSearchHandle = setInterval(() => {
        if (Inventory.hasAnchor()) {
            stopGridSearch();
            return;
        }
        if (Date.now() - gridSearchStarted > GRID_SEARCH_TIMEOUT_MS) {
            log("Grid search timed out after 5min.");
            stopGridSearch();
            return;
        }
        gridSearchTries++;
        if (gridSearchTries >= 3 && !gridSearchNotify) {
            gridSearchNotify = showNotification("Can't see the inventory", 0, "danger");
        }
        calibrateGrid();
    }, 1000);
}

function stopGridSearch(): void {
    if (gridSearchHandle) { clearInterval(gridSearchHandle); gridSearchHandle = null; }
    if (gridSearchNotify) { gridSearchNotify.remove(); gridSearchNotify = null; }
    setSearchingGrid(false);
    if (Inventory.hasAnchor()) {
        log("Grid search succeeded.");
    }
}
