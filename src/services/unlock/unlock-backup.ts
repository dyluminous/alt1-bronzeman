// unlock-backup.ts — backup/restore the unlock DB to/from a gzipped JSON file,
// plus the full-screen loading overlay shown while a restore runs.
import { log, showNotification } from "../../core";
import { exportUnlockData, importUnlockData } from "./unlock-store";
import { stopAutoCapture, startAutoCapture } from "../inventory/inventory-capture";
import { updateUI } from "../../ui/ui";
import { initRecentUnlocks } from "../../ui/unlock-recent";

// ============================================================
// Gzip helpers — the backup file is gzipped JSON (.json.gz)
// ============================================================

/** gzip magic bytes 0x1f 0x8b — used to detect gzipped backups on restore. */
const GZIP_MAGIC: readonly [number, number] = [0x1f, 0x8b];

/** Gzip a string using the native CompressionStream (Chromium 80+). */
async function gzipJson(json: string): Promise<Blob> {
    const stream = new Blob([json], { type: "application/json" }).stream()
        .pipeThrough(new CompressionStream("gzip"));
    return new Response(stream).blob();
}

/** Detect whether a file's bytes are gzipped. */
function isGzip(buf: ArrayBuffer): boolean {
    const head = new Uint8Array(buf, 0, 2);
    return head.length === 2 && head[0] === GZIP_MAGIC[0] && head[1] === GZIP_MAGIC[1];
}

/** Decompress a gzipped byte buffer to text. */
async function gunzipText(buf: ArrayBuffer): Promise<string> {
    const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream("gzip"));
    return new Response(stream).text();
}

// ============================================================
// Backup — gzip the unlock DB export and download it as a file
// ============================================================

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
    showLoadingOverlay();
    try {
        const buf = await file.arrayBuffer();
        const json = isGzip(buf) ? await gunzipText(buf) : new TextDecoder().decode(buf);
        await importUnlockData(json);
        log(`Backup restored: ${file.name}`);
        showNotification("Backup restored", 3000, "success");
        updateUI();
        void initRecentUnlocks().catch(() => {});
    } catch (e) {
        log(`Restore failed: ${e}`);
        showNotification("Restore failed", 4000, "danger");
    } finally {
        // Keep the spinner up a beat longer than the work actually takes,
        // so the restore doesn't look like it finished instantly.
        hideLoadingOverlay(500);
        btn?.classList.remove("disabled");
        restoring = false;
        startAutoCapture({ silent: true });
    }
}

// ============================================================
// Loading overlay — full-screen spinner
// ============================================================

function showLoadingOverlay(): void {
    document.getElementById("loading_overlay")?.classList.add("visible");
}

function hideLoadingOverlay(delayMs = 0): void {
    const hide = () => document.getElementById("loading_overlay")?.classList.remove("visible");
    if (delayMs > 0) setTimeout(hide, delayMs);
    else hide();
}

// ============================================================
// Re-exports
// ============================================================

export { backupUnlocks, restoreUnlocks };
