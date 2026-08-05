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
                        Inventory.captureCornerBaseline(img, saved, (msg) => log("  [corner] " + msg));
                        if (!Inventory.loadEmptyHash()) {
                            const sr = Inventory.scan(img);
                            if (sr.slots.length >= 28) Inventory.captureEmptyHash(sr.slots[27].hash);
                        }
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
                Inventory.clearCornerBaseline();
                drawDetectDebug(anc, true);
                return;
            } else {
                // Capture corner baseline for overlay detection
                Inventory.captureCornerBaseline(img, anc, (msg) => log("  [corner] " + msg));
                // Capture perimeter baseline for border verification
                Inventory.captureCornerBrackets(img, anc, (msg) => log("  [bracket] " + msg));
                // Capture empty hash from slot 28 (assumed empty)
                const scanResult = Inventory.scan(img, (msg) => log("  [inv] " + msg));
                if (scanResult.slots.length >= 28) {
                    Inventory.captureEmptyHash(scanResult.slots[27].hash);
                    log(`  Empty hash saved: ${scanResult.slots[27].hash}`);
                }
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
    Inventory.clearCornerBaseline();
    Inventory.clearEmptyHash();
    Inventory.clearCornerBrackets();
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

        if (state.scanCount === 1) {
            log(`Scan #1 (baseline): anchor (${result.anchor.x},${result.anchor.y})`);
            return;
        }

        if (result.changes > 0) {
            // Aftermath: if previous scan was interface, suppress all pickups/removals
            if (state.afterInterface) {
                state.afterInterface = false;
                drawSlotOverlays(result, { r: 255, g: 80, b: 80 });
                updateDebugGrid(result, true);
                log(`  ⏭ Interface aftermath — suppressing ${result.changes} transitions`);
                return;
            }
            // Classify each slot as empty or occupied via hash comparison against saved empty hash
            const emptyHash = Inventory.loadEmptyHash();
            const nowOccupied = emptyHash
                ? Array.from(Inventory.classifyOccupied(result.slots.map(s => s.hash), emptyHash))
                : Array.from({length: result.slots.length}, (_, i) => i);
            const baseline = Inventory.loadCornerBaseline();

            // Detect massive overlay: if >25% of changed slots fail corner+perimeter,
            // it's an interface event. Don't update prevOccupied — freeze real state.
            const cornerBrackets = Inventory.loadCornerBrackets();
            if (result.changes >= 4 && baseline && cornerBrackets) {
                let maskedCount = 0;
                for (let i = 0; i < result.slots.length; i++) {
                    if (!result.slots[i].changed) continue;
                    if (!Inventory.cornersMatchBaseline(img, result.anchor, i, baseline) ||
                        !Inventory.cornerBracketsMatch(img, result.anchor, i, cornerBrackets)) {
                        maskedCount++;
                    }
                }
                if (maskedCount / result.changes > 0.5 || maskedCount === result.changes) {
                    log(`  ⏭ Interface detected (${maskedCount}/${result.changes} masked) — holding state`);
                    state.afterInterface = true;
                    drawSlotOverlays(result, { r: 255, g: 80, b: 80 });
                    updateDebugGrid(result, true);
                    return; // don't update prevOccupied
                }
            }


            // Filter nowOccupied: both 4-corner AND bracket must match saved baseline.
            if (baseline && cornerBrackets) {
                const realOccupied = nowOccupied.filter(i =>
                    Inventory.cornersMatchBaseline(img, result.anchor, i, baseline) &&
                    Inventory.cornerBracketsMatch(img, result.anchor, i, cornerBrackets)
                );
                const overlayMasked = nowOccupied.filter(i => !realOccupied.includes(i));
                if (overlayMasked.length > 0) {
                    // Show red boxes for masked slots so user sees the overlay was caught
                    const maskedSlots = result.slots.filter(s => overlayMasked.includes(s.index));
                    drawSlotOverlaysFor(maskedSlots, { r: 255, g: 80, b: 80 });
                    const reasons = overlayMasked.map(i => {
                        const c = Inventory.cornersMatchBaseline(img, result.anchor, i, baseline);
                        const p = Inventory.cornerBracketsMatch(img, result.anchor, i, cornerBrackets);
                        return `#${i+1}(corners=${c?"✓":"✗"},bracket=${p?"✓":"✗"})`;
                    }).join(" ");
                    log(`  ⏭ Overlay masked: ${reasons}`);
                }
                nowOccupied.length = 0;
                nowOccupied.push(...realOccupied);
            } else if (baseline) {
                const realOccupied = nowOccupied.filter(i =>
                    Inventory.cornersMatchBaseline(img, result.anchor, i, baseline)
                );
                const overlayMasked = nowOccupied.filter(i => !realOccupied.includes(i));
                if (overlayMasked.length > 0) {
                    const maskedSlots = result.slots.filter(s => overlayMasked.includes(s.index));
                    drawSlotOverlaysFor(maskedSlots, { r: 255, g: 80, b: 80 });
                    log(`  ⏭ Overlay masked (corners): slots ${overlayMasked.map(i => `#${i+1}`).join(" ")}`);
                }
                nowOccupied.length = 0;
                nowOccupied.push(...realOccupied);
            }

            // New pickups: slots occupied now that were NOT occupied last scan
            const newPickups = nowOccupied.filter(i => !state.prevOccupied.has(i));
            // Removals: slots empty now that WERE occupied last scan
            const removals = Array.from(state.prevOccupied).filter(i => !nowOccupied.includes(i));

            // Show magenta for removals immediately (no corner/filter check needed — removing items is always safe)
            if (removals.length > 0) {
                const removalSlots = result.slots.filter(s => removals.includes(s.index));
                drawSlotOverlaysFor(removalSlots, { r: 255, g: 0, b: 255 }); // magenta
                const rnames = removalSlots.map(s => `#${s.index + 1}`).join(" ");
                log(`  💨 Removed: ${rnames}`);
            }

            state.prevOccupied = new Set(nowOccupied);


            if (newPickups.length === 0 && removals.length === 0) {
                updateDebugGrid(result);
                return;
            }
            if (newPickups.length === 0) {
                updateDebugGrid(result);
                return;
            }

            // Anti-drag check
            if (isCursorInInventory(result)) {
                drawSlotOverlaysFor(result.slots.filter(s => newPickups.includes(s.index)), { r: 255, g: 80, b: 80 });
                log(`  ⏭ Skipped: cursor inside inventory (likely drag)`);
                state.prevOccupied = new Set(nowOccupied);
                updateDebugGrid(result, true);
                return;
            }

            state.prevOccupied = new Set(nowOccupied);

            if (newPickups.length === 0) {
                drawSlotOverlays(result, { r: 255, g: 80, b: 80 });
                updateDebugGrid(result, true);
                log(`  ⏭ Skipped: all pickups failed corner/drag checks`);
                return;
            }

            const confirmedSlots = result.slots.filter(s => newPickups.includes(s.index));
            drawSlotOverlaysFor(confirmedSlots, { r: 80, g: 200, b: 80 });
            const names = confirmedSlots.map(s => `#${s.index + 1}[r${s.row},c${s.col}]`).join(" ");
            log(`  ✅ Confirmed: ${names} (${newPickups.length} pickup(s))`);
            updateScanStatus(`${newPickups.length} pickup(s)`);
            for (const slot of confirmedSlots) appendChangeEntry(slot, result.time);

            // Lock confirmed slots into occupied state — prevents animation jitter
            // from causing false removal+repickup cycles on the next scan.
            for (const idx of newPickups) state.prevOccupied.add(idx);
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
