// index.ts — Bronzeman Mode entry point
// Bootstrap + Bronzeman namespace for HTML onclick handlers. All feature code
// lives in domain modules: capture, overlay, ui, modal, data, inventory, core.
import * as a1lib from "alt1";
import * as Inventory from "./inventory";
import { state, captureFullRs, showNotification, log } from "./core";
import { updateAlt1Status, updateUI } from "./ui";
import { drawDetectDebug, updateGridBoundary } from "./overlay";
import { loadState, initIgnoreDB } from "./data";

import "./index.html";
import "./appconfig.json";
import "./icon.png";
import "./style.css";

// ============================================================
// Init
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
// Bronzeman namespace — re-exports for HTML onclick handlers
// ============================================================

// Data
export { unlockItem, isUnlocked, getUnlockedCount, getUnlockedItems, resetData } from "./data";

// Capture
export { captureReference, clearReference } from "./capture";

// Overlay
export { debugFindSlot, updateGridBoundary } from "./overlay";

// Modal
export { modalCancel, modalOk } from "./modal";

// UI action handlers
export {
    resetUnlocks, resetIgnores,
    dumpIgnoredItems, removeIgnore,
    showIgnoreTooltip, hideIgnoreTooltip, moveIgnoreTooltip,
} from "./ui";

// ============================================================
// Bootstrap
// ============================================================

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initOnLoad);
} else {
    initOnLoad();
}
