// index.ts — Bronzeman Mode entry point
// Bootstrap + Bronzeman namespace for HTML onclick handlers. All feature code
// lives in domain modules: capture, overlay, ui, modal, data, inventory, core.
import "./index.html";
import "./appconfig.json";
import "./icon.png";
import searchIconUrl from "./assets/images/ui_browser/search_icon.png";

// Set the search icons (webpack inlines the URL)
const searchIcon = document.getElementById("search_icon_img") as HTMLImageElement | null;
if (searchIcon) searchIcon.src = searchIconUrl;
const dbSearchIcon = document.getElementById("db_search_icon_img") as HTMLImageElement | null;
if (dbSearchIcon) dbSearchIcon.src = searchIconUrl;
import "./styles/main.css";

import { initOnLoad } from "./bootstrap";

// ============================================================
// Bronzeman namespace — re-exports for HTML onclick handlers
// ============================================================

export { toggleAutoCapture, clearReference, stopAutoCapture, startAutoCapture, toggleHideScanningNotification } from "./services/inventory/inventory-capture";
export { debugFindSlot, updateGridDebug, toggleSlotAnimation, toggleTooltipDebug, toggleGeDebugOverlays } from "./services/overlay/overlay-draw";
export { diagnoseSlotScan, dumpSlotHash, debugCorners, ocrStackableDebug, readStackableQuantity } from "./services/inventory/inventory-scan";
export { addUnlockedItem, isHashUnlocked, dumpTradableUnlocks, dumpUntradableUnlocks, dumpItemHashes, getRecentRecords } from "./services/unlock/unlock-store";
export { backupUnlocks, restoreUnlocks } from "./services/unlock/unlock-backup";
export { modalCancel, modalOk } from "./ui/modal";
export {
    resetUnlocks,
    openSlotDebug, closeSlotDebug, refreshSlotDebug,
    showDisambiguation, selectDisambiguationOption, closeDisambiguation,
    openItemPngs, closeItemPngs,
    openDbItemPngs, closeDbItemPngs, searchDbItemHash,
    toggleDeveloperMode,
    toggleSearchHideUntradable, toggleSearchGroupSimilar,
    setRecentUnlocksCount, stepRecentUnlocksCount, stepManualUnlockSlot,
} from "./ui/ui";
export { manualUnlock, openManualUnlock, closeManualUnlock } from "./ui/unlock-manual";

// ============================================================
// Bootstrap
// ============================================================

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initOnLoad);
} else {
    initOnLoad();
}
