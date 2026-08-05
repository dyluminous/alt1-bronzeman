// Bronzeman Mode — Alt1 plugin
// Tracks which items you've earned yourself before allowing GE purchases.
import * as a1lib from "alt1";
import * as Inventory from "./inventory";
import { BUILD, BUILD_NUM } from "./version";
import {
    state,
    captureFullRs, showOverlay, log, POLL_INTERVAL_MS,
} from "./core";
import {
    updateAlt1Status, updateScanStatus, updateUI, updateDebugGrid,
    appendChangeEntry, drawDetectDebug, drawSlotOverlays, drawSlotOverlaysFor,
    isCursorInInventory,
} from "./ui";
import { loadState, unlockItem } from "./data";

import "./index.html";
import "./appconfig.json";
import "./icon.png";

// ============================================================
// Initialization
// ============================================================

export function initOnLoad() {
    log("Bronzeman initializing...");
    const bn = document.getElementById("build_num");
    if (bn) bn.textContent = `(#${BUILD_NUM})`;

    state.inAlt1 = typeof window.alt1 !== "undefined";
    log(`inAlt1=${state.inAlt1}`);

    updateAlt1Status();
    loadState();

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
                        showOverlay("Grid anchoring successful", a1lib.mixColor(255, 255, 0), 2000);
                        drawDetectDebug(saved, false);
                        startPolling();
                    } else {
                        log("Anchor INVALID — cleared. Recapture.");
                        showOverlay("Anchor not saved - Bad grid rejected", a1lib.mixColor(255, 60, 60), 2000);
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
            updateScanStatus("No anchor set");
        }
    }

    updateUI();
    log(`Init done. inAlt1=${state.inAlt1}`);
}

// ============================================================
// Polling
// ============================================================

export function startPolling(): void {
    if (!state.inAlt1) { log("Not in Alt1."); return; }
    if (!alt1.permissionPixel) { log("No pixel permission."); updateScanStatus("No pixel perm"); return; }
    if (state.polling) return;

    state.polling = true;
    updateScanStatus("Polling...");
    log(`Polling every ${POLL_INTERVAL_MS}ms`);

    Inventory.resetHashes();
    doScan();
    state.pollTimer = setInterval(doScan, POLL_INTERVAL_MS);
}

export function stopPolling(): void {
    if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
    state.polling = false;
    updateScanStatus("Idle");
    log("Polling stopped.");
}

export function isPolling(): boolean { return state.polling; }

// ============================================================
// Capture
// ============================================================

let refCountdown: ReturnType<typeof setInterval> | null = null;
let refCountdownValue = 0;

export function captureReference(): void {
    if (!state.inAlt1) { log("Not in Alt1."); return; }
    if (!alt1.permissionPixel) { log("No pixel permission."); return; }

    refCountdownValue = 3;
    showOverlay("Move mouse inside slot 1 — detecting in 3...", a1lib.mixColor(100, 200, 255), 5000);

    refCountdown = setInterval(() => {
        refCountdownValue--;
        if (refCountdownValue <= 0) {
            if (refCountdown) { clearInterval(refCountdown); refCountdown = null; }
            doCaptureRef();
        } else {
            showOverlay(`Detecting in ${refCountdownValue}...`, a1lib.mixColor(100, 200, 255), 2000);
        }
    }, 1000);
}

function doCaptureRef(): void {
    try {
        const pos = a1lib.getMousePosition();
        if (!pos || pos.x <= 0) {
            log("No RS cursor — is RS the active window?");
            showOverlay("Make RS the active window!", a1lib.mixColor(255, 80, 80), 3000);
            return;
        }

        const img = captureFullRs();
        if (!img) {
            log("Capture failed — could not read RS screen.");
            showOverlay("Failed — RS linked?", a1lib.mixColor(255, 80, 80), 3000);
            return;
        }

        const anc = Inventory.detectSlotBounds(img, pos.x, pos.y, (msg) => log("  [detect] " + msg));
        if (anc) {
            Inventory.resetHashes();
            updateScanStatus(`Detected at (${anc.x},${anc.y})`);
            log(`Grid found at (${anc.x},${anc.y}) col=${anc.colStride} row=${anc.rowStride}`);
            if (anc.centerMismatch) {
                showOverlay("Anchor not saved - Bad grid rejected", a1lib.mixColor(255, 60, 60), 6000);
                log("Grid rejected — center pixel mismatch. Recapture.");
                Inventory.clearAnchor();
                drawDetectDebug(anc, true);
                return;
            } else {
                showOverlay("Grid anchoring successful", a1lib.mixColor(255, 255, 0), 3000);
                drawDetectDebug(anc, false);
                updateUI();
                doScan();
            }
        } else {
            log("Detection failed. Is your mouse inside slot 1?");
            showOverlay("Detection failed — mouse in slot?", a1lib.mixColor(255, 80, 80), 3000);
        }
    } catch (e) {
        log("Capture error: " + e);
        showOverlay("Error — check log", a1lib.mixColor(255, 80, 80), 3000);
    }
}

export function clearReference(): void {
    Inventory.clearAnchor();
    Inventory.resetHashes();
    state.scanCount = 0;
    log("Anchor cleared. Capture again to set.");
    updateScanStatus("No anchor");
    updateUI();
}

export function clearCalibration(): void { clearReference(); }

// ============================================================
// Core scan logic
// ============================================================

function doScan(): void {
    if (!state.inAlt1 || !alt1.permissionPixel) { stopPolling(); return; }
    a1lib.resetEnvironment();

    try {
        if (!Inventory.hasAnchor()) {
            updateScanStatus("No anchor set");
            return;
        }

        const img = captureFullRs();
        if (!img) { log("ERROR: captureFullRs returned null — is RS linked?"); return; }

        const result = Inventory.scan(img, (msg) => log("  [inv] " + msg));
        state.scanCount++;
        state.lastScanResult = result;

        updateDebugGrid(result);
        drawSlotOverlays(result);

        if (state.scanCount === 1) {
            log(`Scan #1 (baseline): anchor (${result.anchor.x},${result.anchor.y})`);
            return;
        }

        if (result.changes > 0) {
            if (result.changes > 4) {
                drawSlotOverlays(result, { r: 255, g: 80, b: 80 });
                updateDebugGrid(result, true);
                log(`  ⏭ Skipped: ${result.changes} slots changed at once (UI event)`);
                return;
            }

            if (isCursorInInventory(result)) {
                drawSlotOverlays(result, { r: 255, g: 80, b: 80 });
                updateDebugGrid(result, true);
                log(`  ⏭ Skipped: cursor inside inventory (likely drag/UI interaction)`);
                return;
            }

            const changedSlots = result.slots.filter(s => s.changed);
            const confirmed: Inventory.SlotState[] = [];
            const newlyPending: Inventory.SlotState[] = [];
            const reverted: Inventory.SlotState[] = [];

            for (const slot of changedSlots) {
                const prev = state.pendingChanges.get(slot.index);
                if (prev !== undefined) {
                    if (prev === slot.hash) { confirmed.push(slot); }
                    else { reverted.push(slot); }
                    state.pendingChanges.delete(slot.index);
                } else {
                    state.pendingChanges.set(slot.index, slot.hash);
                    newlyPending.push(slot);
                }
            }

            const changedIndices = new Set(changedSlots.map(s => s.index));
            const stale: number[] = [];
            state.pendingChanges.forEach((_, idx) => { if (!changedIndices.has(idx)) stale.push(idx); });
            stale.forEach(idx => state.pendingChanges.delete(idx));

            if (reverted.length > 0) {
                drawSlotOverlaysFor(reverted, { r: 255, g: 80, b: 80 });
                log(`  ⏭ Reverted: ${reverted.map(s => `#${s.index + 1}`).join(" ")}`);
            }
            if (newlyPending.length > 0) {
                drawSlotOverlaysFor(newlyPending, { r: 255, g: 215, b: 0 }, reverted.length === 0);
                updateDebugGrid(result, true, new Set(newlyPending.map(s => s.index)));
            }
            if (confirmed.length > 0) {
                drawSlotOverlaysFor(confirmed, { r: 80, g: 200, b: 80 }, newlyPending.length === 0 && reverted.length === 0);
                const names = confirmed.map(s => `#${s.index + 1}[r${s.row},c${s.col}]`).join(" ");
                log(`  ✅ Confirmed: ${names}`);
                updateScanStatus(`${confirmed.length} confirmed`);
                for (const slot of confirmed) appendChangeEntry(slot, result.time);
            }

            if (confirmed.length === 0 && newlyPending.length === 0 && reverted.length === 0) {
                updateDebugGrid(result);
            }
        } else {
            updateScanStatus(`Polling #${state.scanCount}`);
        }
    } catch (e: any) {
        if (e instanceof a1lib.NoAlt1Error) {
            log("FATAL: Alt1 API not available. Try reloading the plugin in Alt1.");
            stopPolling();
            updateScanStatus("No Alt1 API");
        } else {
            log("ERROR: " + (e?.message || e));
            updateScanStatus("Error");
        }
    }
}


// Re-export data.ts functions for HTML onclick handlers
export { unlockItem, isUnlocked, getUnlockedCount, getUnlockedItems, resetData } from "./data";

// ============================================================
// Bootstrap
// ============================================================

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initOnLoad);
} else {
    initOnLoad();
}
