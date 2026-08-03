// index.ts — Bronzeman Mode entry point
// Bootstrap + Bronzeman namespace for HTML onclick handlers. All feature code
// lives in domain modules: capture, overlay, ui, modal, data, inventory, core.
import { state, log } from "./core";
import { updateAlt1Status, updateUI, applyDeveloperMode, applySearchSettings } from "./ui";
import { initUnlockDB } from "./data";
import { initRecentUnlocks, setRecentUnlocksLimit, getRecentUnlocksLimit } from "./recent-unlocks";
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
    applyDeveloperMode();
    applySearchSettings();
    initUnlockDB().then(() => { updateUI(); initRecentUnlocks().catch(() => {}); });
    syncRecentUnlocksSpinner();

    if (state.inAlt1) {
        alt1.identifyAppUrl("./appconfig.json");
        calibrateGrid();
    }

    updateUI();

    log(`Init done. inAlt1=${state.inAlt1}`);
}

/** Keep the Settings spinner in sync with the persisted value on boot. */
function syncRecentUnlocksSpinner(): void {
    const input = document.getElementById("recent_unlocks_count") as HTMLInputElement | null;
    if (input) input.value = String(getRecentUnlocksLimit());
}

// ============================================================
// Bronzeman namespace — re-exports for HTML onclick handlers
// ============================================================

// Capture
export { toggleAutoCapture, clearReference, stopAutoCapture, startAutoCapture } from "./capture";

// Overlay
export { debugFindSlot, updateGridDebug, toggleSlotAnimation, toggleTooltipDebug } from "./overlay";

// Slot scan diagnostics
export { diagnoseSlotScan, dumpSlotHash, debugCorners, ocrStackableDebug, readStackableQuantity } from "./slot-scan";

// Data
export { addUnlockedItem, isHashUnlocked, dumpTradableUnlocks, dumpUntradableUnlocks, dumpItemHashes, getRecentRecords } from "./data";

// Backup / restore
export { backupUnlocks, restoreUnlocks } from "./backup";

// Modal
export { modalCancel, modalOk } from "./modal";

// UI action handlers
export {
    resetUnlocks,
    openSlotDebug, closeSlotDebug, refreshSlotDebug,
    showDisambiguation, selectDisambiguationOption, closeDisambiguation,
    openItemPngs, closeItemPngs,
    toggleDeveloperMode,
    toggleSearchHideUntradable, toggleSearchGroupSimilar,
} from "./ui";

// Recent unlocks setting
// @ts-ignore — called from HTML onchange
function setRecentUnlocksCount(value: string | number): void {
    setRecentUnlocksLimit(Number(value));
}

/** Step the recent-unlocks spinner by ±1 from its current value. */
// @ts-ignore — called from HTML onclick
function stepRecentUnlocksCount(delta: number): void {
    const input = document.getElementById("recent_unlocks_count") as HTMLInputElement | null;
    const current = Number(input?.value ?? getRecentUnlocksLimit());
    const next = current + delta;
    setRecentUnlocksCount(next);
    if (input) input.value = String(Math.min(28, Math.max(0, Math.round(next))));
}

export { setRecentUnlocksCount, stepRecentUnlocksCount };

// ============================================================
// Bootstrap
// ============================================================

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initOnLoad);
} else {
    initOnLoad();
}
