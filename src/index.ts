// index.ts — Bronzeman Mode entry point
// Bootstrap + Bronzeman namespace for HTML onclick handlers. All feature code
// lives in domain modules: capture, overlay, ui, modal, data, inventory, core.
import { state, log, showNotification } from "./core";
import { updateAlt1Status, updateUI, applyDebugTabVisibility } from "./ui";
import { initUnlockDB, exportUnlockData, importUnlockData } from "./data";
import { initRecentUnlocks, setRecentUnlocksLimit, getRecentUnlocksLimit } from "./recent-unlocks";
import { calibrateGrid, stopAutoCapture, startAutoCapture } from "./capture";

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
    applyDebugTabVisibility();
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
// ============================================================
// Backup — gzip the unlock DB export and download it as a file
// ============================================================

/** Gzip a string using the native CompressionStream (Chromium 80+). */
async function gzipJson(json: string): Promise<Blob> {
    const stream = new Blob([json], { type: "application/json" }).stream()
        .pipeThrough(new CompressionStream("gzip"));
    return new Response(stream).blob();
}

/** Download the whole unlock DB as a gzipped .json.gz file via a Blob + <a
 *  download> link. Alt1's CEF doesn't support showSaveFilePicker and the raw
 *  JSON would be huge at 100k items, so gzip shrinks it ~5× before the
 *  browser handles the download (CEF routes it to the default Downloads
 *  folder). No dialog — Alt1 can't show one. */
function backupUnlocks(): void {
    void (async () => {
        try {
            const json = await exportUnlockData();
            const blob = await gzipJson(json);
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `bronzeman-backup-${new Date().toISOString().slice(0, 10)}.json.gz`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            // Revoke after the click is processed so the download isn't aborted.
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            log(`Backup downloaded (${(blob.size / 1024).toFixed(1)} KiB gzipped)`);
        } catch (e) {
            log(`Backup failed: ${e}`);
            showNotification("Backup failed", 4000, "danger");
        }
    })();
}

// ============================================================
// Restore — pick a backup file and replace the unlock DB with it
// ============================================================

let restoreInput: HTMLInputElement | null = null;
/** True while a restore is in flight — blocks re-entry and keeps the button disabled. */
let restoring = false;

/** Open the native file picker to choose a backup file (.json or .json.gz). */
function restoreUnlocks(): void {
    if (restoring) return;
    if (!restoreInput) {
        restoreInput = document.createElement("input");
        restoreInput.type = "file";
        restoreInput.accept = ".json,.gz";
        restoreInput.style.display = "none";
        document.body.appendChild(restoreInput);
        restoreInput.addEventListener("change", () => {
            const file = restoreInput?.files?.[0];
            restoreInput!.value = ""; // allow re-selecting the same file
            if (file) void handleRestoreFile(file);
        });
    }
    restoreInput.click();
}

/** Read a backup file (decompressing gzip if needed) and restore the DB.
 *  Auto-capture is paused for the whole restore so the DB rewrite isn't
 *  fighting the scan tick, then resumed silently (no "Inventory found").
 *  The Restore button is disabled while this runs. */
async function handleRestoreFile(file: File): Promise<void> {
    const btn = document.getElementById("restore_btn");
    restoring = true;
    btn?.classList.add("disabled");
    stopAutoCapture();
    try {
        const buf = await file.arrayBuffer();
        // gzip magic bytes 0x1f 0x8b — decompress, otherwise treat as plain JSON.
        const head = new Uint8Array(buf, 0, 2);
        let json: string;
        if (head.length === 2 && head[0] === 0x1f && head[1] === 0x8b) {
            const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"));
            json = await new Response(stream).text();
        } else {
            json = new TextDecoder().decode(buf);
        }
        await importUnlockData(json);
        log(`Backup restored: ${file.name}`);
        showNotification("Backup restored", 3000, "success");
        updateUI();
        void initRecentUnlocks().catch(() => {});
    } catch (e) {
        log(`Restore failed: ${e}`);
        showNotification("Restore failed", 4000, "danger");
    } finally {
        btn?.classList.remove("disabled");
        restoring = false;
        startAutoCapture({ silent: true });
    }
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
export { backupUnlocks, restoreUnlocks };

// Modal
export { modalCancel, modalOk } from "./modal";

// UI action handlers
export {
    resetUnlocks,
    openSlotDebug, closeSlotDebug, refreshSlotDebug,
    showDisambiguation, selectDisambiguationOption, closeDisambiguation,
    openItemPngs, closeItemPngs,
    toggleDebugTab,
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
