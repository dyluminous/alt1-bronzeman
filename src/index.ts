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
    appendChangeEntry, drawDetectDebug, drawSlotOverlaysFor,
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
                        updateGridBoundary();
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
                Inventory.clearOuterPerm();
                Inventory.clearEmptySlotData();
                Inventory.resetHashes();
                drawDetectDebug(anc, true);
                return;
            } else {
                // Capture outer perimeter for border verification
                Inventory.captureOuterPerm(img, anc, (msg) => log("  [outer] " + msg));
                // Capture empty slot data from slot 28 (assumed empty)
                Inventory.captureEmptySlotData(img, anc, (msg) => log("  [empty] " + msg));
                showOverlay("Grid anchoring successful", a1lib.mixColor(255, 255, 0), 3000);
                drawDetectDebug(anc, false);
                updateGridBoundary();
                updateUI();
                startPolling();
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
    Inventory.clearOuterPerm();
    Inventory.clearEmptySlotData();
    Inventory.resetHashes();
    state.scanCount = 0;
    if (state.inAlt1) alt1.overLayClearGroup("bronzeman_boundary");
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
            // Still draw boundary if checkbox is on
            drawBoundaryOverlay();
            return;
        }

        const img = captureFullRs();
        if (!img) { log("ERROR: captureFullRs returned null — is RS linked?"); return; }

        const result = Inventory.scan(img, (msg) => log("  [inv] " + msg));
        state.scanCount++;
        state.lastScanResult = result;

        // Draw boundary overlay each scan (if checkbox checked)
        drawBoundaryOverlay();

        updateDebugGrid(result);

        if (state.scanCount === 1) {
            log(`Scan #1 (baseline): anchor (${result.anchor.x},${result.anchor.y})`);
            return;
        }

        if (result.changes > 0) {
            const outerPerm = Inventory.loadOuterPerm();
            const emptyRef = Inventory.loadEmptySlotData();
            const nowOccupied: number[] = [];
            const obstructed: number[] = [];

            for (let i = 0; i < result.slots.length; i++) {
                if (!result.slots[i].changed) continue;

                // Step 1: Outer perimeter check
                if (!outerPerm || !Inventory.outerPermClear(img, result.anchor, i, outerPerm)) {
                    // Slot is obstructed (tooltip/interface covering it)
                    obstructed.push(i);
                    continue;
                }

                // Step 2: Empty check
                if (emptyRef) {
                    const mm = Inventory.slotEmptyMismatch(img, result.anchor, i, emptyRef);
                    if (mm > 0.03) nowOccupied.push(i); // has item
                    // else: slot is empty, skip
                } else {
                    nowOccupied.push(i); // no empty ref → treat as occupied
                }
            }

            // Draw red for obstructed slots (they had hash changes but are covered)
            if (obstructed.length > 0) {
                drawSlotOverlaysFor(result.slots.filter(s => obstructed.includes(s.index)), { r: 255, g: 80, b: 80 });
                log(`  ⏭ Obstructed: ${obstructed.map(i => `#${i+1}`).join(" ")}`);
            }

            // Drag detection: if RS cursor is inside inventory grid and hasn't moved
            // for 2+ consecutive scans, the user is likely holding left click (dragging).
            let isDragging = false;
            try {
                const pos = a1lib.getMousePosition();
                if (pos) {
                    const anc = result.anchor;
                    // Store grid bounds at capture? For now compute from anchor
                    const gridLeft = anc.x - 1;
                    const gridTop = anc.y - 1;
                    const gridRight = anc.x + 3 * anc.colStride + 37;
                    const gridBottom = anc.y + 6 * anc.rowStride + 33;
                    const inGrid = pos.x >= gridLeft && pos.x <= gridRight && pos.y >= gridTop && pos.y <= gridBottom;
                    if (inGrid) {
                        const same = state.prevRsMouse.x === pos.x && state.prevRsMouse.y === pos.y;
                        if (same) state.prevRsMouseSame++;
                        else state.prevRsMouseSame = 0;
                        if (state.prevRsMouseSame >= 2) isDragging = true;
                        state.prevRsMouse = { x: pos.x, y: pos.y };
                    } else {
                        state.prevRsMouseSame = 0;
                    }
                }
            } catch { /* ignore */ }

            if (isDragging) {
                drawSlotOverlaysFor(result.slots.filter(s => s.changed), { r: 255, g: 150, b: 200 }); // pink
                updateDebugGrid(result, true);
                log(`  ⏭ Drag detected — ignoring ${result.changes} change(s)`);
                return;
            }

            // Track state
            const prevOccupied = state.prevOccupied;
            const newPickups = nowOccupied.filter(i => !prevOccupied.has(i));
            const removals = Array.from(prevOccupied).filter(i => !nowOccupied.includes(i));
            state.prevOccupied = new Set(nowOccupied);

            // Magenta for removals
            if (removals.length > 0) {
                drawSlotOverlaysFor(result.slots.filter(s => removals.includes(s.index)), { r: 255, g: 0, b: 255 });
                log(`  💨 Removed: ${removals.map(i => `#${i+1}`).join(" ")}`);
            }

            if (newPickups.length === 0) {
                if (removals.length === 0 && obstructed.length === 0) updateDebugGrid(result);
                return;
            }

            // Green for pickups
            const confirmedSlots = result.slots.filter(s => newPickups.includes(s.index));
            drawSlotOverlaysFor(confirmedSlots, { r: 80, g: 200, b: 80 });
            log(`  ✅ Pickup: ${newPickups.map(i => `#${i+1}`).join(" ")}`);
            updateScanStatus(`${newPickups.length} pickup(s)`);
            for (const slot of confirmedSlots) appendChangeEntry(slot, result.time);
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
// ============================================================
// Grid boundary overlay
// ============================================================

let showGridBoundary = false;

export function updateGridBoundary(): void {
    const cb = document.getElementById("show_grid_boundary") as HTMLInputElement;
    showGridBoundary = cb?.checked ?? false;
    log(`updateGridBoundary: show=${showGridBoundary} inAlt1=${state.inAlt1}`);
    if (!state.inAlt1) return;
    if (!showGridBoundary) {
        alt1.overLayClearGroup("bronzeman_boundary");
    }
}

/** Called every scan to draw (or skip) the grid boundary overlay. */
function drawBoundaryOverlay(): void {
    if (!state.inAlt1 || !showGridBoundary) return;
    const anc = Inventory.loadAnchor();
    if (!anc) return;
    const left = anc.x - 1;
    const top = anc.y - 1;
    const w = 3 * anc.colStride + 38;
    const h = 6 * anc.rowStride + 34;
    const c = a1lib.mixColor(80, 200, 255);
    const ttl = POLL_INTERVAL_MS + 200;
    alt1.overLaySetGroup("bronzeman_boundary");
    alt1.overLayRect(c, left, top, w, h, ttl, 1);
}

// ============================================================
// Bootstrap
// ============================================================

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initOnLoad);
} else {
    initOnLoad();
}
