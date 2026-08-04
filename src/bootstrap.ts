// bootstrap.ts — app initialisation after DOM is ready
import { state, log } from "./core";
import { updateAlt1Status, updateAnchorDot, updateUI, applyDeveloperMode, applySearchSettings, setupSearchHandler } from "./ui";
import { initUnlockDB } from "./data";
import { initRecentUnlocks, getRecentUnlocksLimit } from "./recent-unlocks";
import { calibrateGrid } from "./capture";
import { setGeStateHook } from "./ge-debug";

export function initOnLoad(): void {
    log("Bronzeman initializing...");

    state.inAlt1 = typeof window.alt1 !== "undefined";
    log(`inAlt1=${state.inAlt1}`);

    updateAlt1Status();
    // Keep the status dots in sync when the GE opens/closes.
    setGeStateHook(() => { updateAlt1Status(); updateAnchorDot(); });
    applyDeveloperMode();
    applySearchSettings();
    setupSearchHandler();
    initUnlockDB().then(() => { updateUI(); initRecentUnlocks().catch(() => {}); });
    syncRecentUnlocksSpinner();

    if (state.inAlt1) {
        alt1.identifyAppUrl("./appconfig.json");
        calibrateGrid();
    }

    updateUI();
    log(`Init done. inAlt1=${state.inAlt1}`);
}

function syncRecentUnlocksSpinner(): void {
    const input = document.getElementById("recent_unlocks_count") as HTMLInputElement | null;
    if (input) input.value = String(getRecentUnlocksLimit());
}
