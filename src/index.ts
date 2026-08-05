// index.ts — Bronzeman Mode entry point
// Bootstrap + Bronzeman namespace for HTML onclick handlers. All feature code
// lives in domain modules: capture, overlay, ui, modal, data, inventory, core.
import "./index.html";
import "./appconfig.json";
import "./icon.png";
import "./style.css";

import { initOnLoad } from "./bootstrap";

// ============================================================
// Bronzeman namespace — re-exports for HTML onclick handlers
// ============================================================

export { toggleAutoCapture, clearReference, stopAutoCapture, startAutoCapture } from "./capture";
export { debugFindSlot, updateGridDebug, toggleSlotAnimation, toggleTooltipDebug, toggleGeDebug } from "./overlay";
export { diagnoseSlotScan, dumpSlotHash, debugCorners, ocrStackableDebug, readStackableQuantity } from "./slot-scan";
export { addUnlockedItem, isHashUnlocked, dumpTradableUnlocks, dumpUntradableUnlocks, dumpItemHashes, getRecentRecords } from "./data";
export { backupUnlocks, restoreUnlocks } from "./backup";
export { modalCancel, modalOk } from "./modal";
export {
    resetUnlocks,
    openSlotDebug, closeSlotDebug, refreshSlotDebug,
    showDisambiguation, selectDisambiguationOption, closeDisambiguation,
    openItemPngs, closeItemPngs,
    toggleDeveloperMode,
    toggleSearchHideUntradable, toggleSearchGroupSimilar,
    setRecentUnlocksCount, stepRecentUnlocksCount, stepManualUnlockSlot,
} from "./ui";
export { manualUnlock, openManualUnlock, closeManualUnlock } from "./manual-unlock";

// ============================================================
// Bootstrap
// ============================================================

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initOnLoad);
} else {
    initOnLoad();
}
