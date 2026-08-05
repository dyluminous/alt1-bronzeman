// index.ts — Bronzeman Mode entry point
// Bootstrap + Bronzeman namespace for HTML onclick handlers. All feature code
// lives in domain modules: capture, overlay, ui, modal, data, inventory, core.
import { state, log } from "./core";
import { updateAlt1Status, updateUI } from "./ui";
import { loadState, initUnlockDB } from "./data";
import { calibrateGrid } from "./capture";

import "./index.html";
import "./appconfig.json";
import "./icon.png";
import "./style.css";

// ============================================================
// Init
// ============================================================

function initOnLoad() {
    log("Bronzeman initializing...");

    state.inAlt1 = typeof window.alt1 !== "undefined";
    log(`inAlt1=${state.inAlt1}`);

    updateAlt1Status();
    loadState();
    initUnlockDB().then(() => updateUI());

    if (state.inAlt1) {
        alt1.identifyAppUrl("./appconfig.json");
        calibrateGrid();
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
// Bronzeman namespace — re-exports for HTML onclick handlers
// ============================================================

// Capture
export { captureReference, clearReference } from "./capture";

// Overlay
export { debugFindSlot, updateGridDebug, toggleSlotAnimation, toggleTooltipDebug } from "./overlay";

// Slot scan diagnostics
export { diagnoseSlotScan, dumpSlotHash, debugCorners } from "./slot-scan";

// Data
export { addUnlockedItem, isHashUnlocked, dumpTradableUnlocks, dumpUntradableUnlocks } from "./data";

// Modal
export { modalCancel, modalOk } from "./modal";

// UI action handlers
export {
    resetUnlocks,
    openSlotDebug, closeSlotDebug, refreshSlotDebug,
    showDisambiguation, selectDisambiguationOption, closeDisambiguation,
} from "./ui";

// ============================================================
// Bootstrap
// ============================================================

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initOnLoad);
} else {
    initOnLoad();
}
