// Bronzeman Mode — Alt1 plugin
// Tracks which items you've earned yourself before allowing GE purchases.
import * as a1lib from "alt1";
import * as Inventory from "./inventory";
import { BUILD, BUILD_NUM } from "./version";
import {
    state,
    captureFullRs, showNotification, NotificationHandle, log, POLL_INTERVAL_MS, setShowSlotOverlays, showSlotOverlays,
} from "./core";
import {
    updateAlt1Status, updateScanStatus, updateUI, updateDebugGrid, updateAnchorDot,
    drawDetectDebug, drawSlotOverlaysFor, isCursorInInventory,
    showScanPickup,
} from "./ui";
import { loadState, unlockItem, resetUnlocks as dataResetUnlocks, isIgnored, ignoreItem, getIgnoredItems, getIgnoredCount, clearIgnoredItems, removeIgnoredItem, fillTestIgnores as dataFillTestIgnores } from "./data";
import TooltipReader from "alt1/tooltip";
import * as OCR from "alt1/ocr";

// Max recent pickups to remember
const MAX_PICKUPS = 20;

// Tooltip detection colors
const TOOLTIP_BG_COLOR = [15, 14, 12] as const;
const TOOLTIP_INNER_BORDER_COLOR = [46, 37, 26] as const;
const TOOLTIP_ITEM_COLOR_MEMBERS = [248, 213, 107] as const;
const TOOLTIP_ITEM_COLOR_F2P = [184, 209, 209] as const;

interface PickupEntry {
    slotIndex: number;
    imageUrl: string;
    time: number;
    noted: boolean;
    hash: string;
}

const recentPickups: PickupEntry[] = [];
let renderedCardHashes: string[] = [];
let renderedCardNodes: HTMLElement[] = [];
let pickupVersion = 0;
let lastRenderedVersion = -1;

function isNotedItem(img: any, anc: Inventory.BackpackAnchor, slotIndex: number): boolean {
    const row = Math.floor(slotIndex / Inventory.COLS);
    const col = slotIndex % Inventory.COLS;
    const sx = anc.x + col * anc.colStride;
    const sy = anc.y + row * anc.rowStride;
    // Check pixels at (11,0) and (12,0) relative to slot (0-indexed)
    const px11 = img.toData(sx + 11, sy + 0, 1, 1);
    const px12 = img.toData(sx + 12, sy + 0, 1, 1);
    if (!px11 || !px12) return false;
    const tol = 15;
    const match11 = Math.abs(px11.data[0] - 149) <= tol && Math.abs(px11.data[1] - 134) <= tol && Math.abs(px11.data[2] - 94) <= tol;
    const match12 = Math.abs(px12.data[0] - 0) <= 3 && Math.abs(px12.data[1] - 0) <= 3 && Math.abs(px12.data[2] - 2) <= 3;
    return match11 && match12;
}

import "./index.html";
import "./appconfig.json";
import "./icon.png";


export function testNotification(): void {
    showNotification("Test notification from Bronzeman", 2000);
}
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
                        showNotification("Inventory calibrated", 2000, "success");
                        drawDetectDebug(saved, false);
                        updateGridBoundary();
                        startPolling();
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
let calibrateHandle: NotificationHandle | null = null;
let scanNotificationHandle: NotificationHandle | null = null;


export function captureReference(): void {
    if (calibrateHandle) { calibrateHandle.remove(); calibrateHandle = null; }
    if (!state.inAlt1) { log("Not in Alt1."); return; }
    if (!alt1.permissionPixel) { log("No pixel permission."); return; }

    // Toggle: if anchor exists, clear it
    const anc = Inventory.loadAnchor();
    if (anc) {
        Inventory.saveAnchor(null);
        showNotification("Calibration cleared", 2000, "warning");
        updateUI();
        return;
    }

    refCountdownValue = 3;
    state.calibrating = true;
    updateUI();
    calibrateHandle = showNotification("Move mouse into slot 1 (3s)", 5000);
    if (calibrateHandle) calibrateHandle.update("Move mouse into slot 1 (3s)");

    refCountdown = setInterval(() => {
        refCountdownValue--;
        if (refCountdownValue <= 0) {
            if (refCountdown) { clearInterval(refCountdown); refCountdown = null; }
            doCaptureRef();
        } else {
            if (calibrateHandle) calibrateHandle.update(`Detecting in ${refCountdownValue}...`);
        }
    }, 1000);
}

function doCaptureRef(): void {
    try {
        const pos = a1lib.getMousePosition();
        if (!pos || pos.x <= 0) {
                    if (calibrateHandle) { calibrateHandle.remove(); calibrateHandle = null; }
            log("No RS cursor — is RS the active window?");
            state.calibrating = false;
            updateUI();
            showNotification("RS Unfocused", 3000, "danger");
            return;
        }

        const img = captureFullRs();
        if (!img) {
                    if (calibrateHandle) { calibrateHandle.remove(); calibrateHandle = null; }
            log("Capture failed — could not read RS screen.");
            state.calibrating = false;
            updateUI();
            showNotification("RS Unlinked", 3000, "danger");
            return;
        }

        const anc = Inventory.detectSlotBounds(img, pos.x, pos.y, (msg) => log("  [detect] " + msg));
        if (anc) {
            Inventory.resetHashes();
            updateScanStatus(`Detected at (${anc.x},${anc.y})`);
            log(`Grid found at (${anc.x},${anc.y}) col=${anc.colStride} row=${anc.rowStride}`);
            if (anc.centerMismatch) {
                state.calibrating = false;
                updateUI();
                showNotification("Calibration failed", 6000, "danger");
                                if (calibrateHandle) { calibrateHandle.remove(); calibrateHandle = null; }
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
                                if (calibrateHandle) { calibrateHandle.remove(); calibrateHandle = null; }
                Inventory.captureEmptySlotData(img, anc, (msg) => log("  [empty] " + msg));
                state.calibrating = false;
                showNotification("Inventory calibrated", 3000, "success");
                drawDetectDebug(anc, false);
                updateGridBoundary();
                updateUI();
                startPolling();
            }
        } else {
                    if (calibrateHandle) { calibrateHandle.remove(); calibrateHandle = null; }
            log("Detection failed. Is your mouse inside slot 1?");
            state.calibrating = false;
            updateUI();
            showNotification("Calibration failed - Mouse in slot?", 3000, "danger");
        }
    } catch (e) {
                if (calibrateHandle) { calibrateHandle.remove(); calibrateHandle = null; }
        log("Capture error: " + e);
        state.calibrating = false;
        updateUI();
        showNotification("Error", 3000, "danger");
    }
}

export function clearReference(): void {
    state.calibrating = false;
    if (calibrateHandle) { calibrateHandle.remove(); calibrateHandle = null; }
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

            // Drag detection: if RS cursor is inside inventory grid, the user is
            // interacting (dragging/dropping). Skip all processing for this scan.
            let cursorInGrid = false;
            try {
                const pos = a1lib.getMousePosition();
                if (pos) {
                    const anc = result.anchor;
                    const gridLeft = anc.x - 1;
                    const gridTop = anc.y - 1;
                    const gridRight = anc.x + 3 * anc.colStride + 37;
                    const gridBottom = anc.y + 6 * anc.rowStride + 33;
                    cursorInGrid = pos.x >= gridLeft && pos.x <= gridRight && pos.y >= gridTop && pos.y <= gridBottom;
                }
            } catch { /* ignore */ }

            if (cursorInGrid && result.changes > 0) {
                drawSlotOverlaysFor(result.slots.filter(s => s.changed), { r: 255, g: 80, b: 80 }); // red
                updateDebugGrid(result, true);
                log(`  ⏭ Cursor in grid — skipping ${result.changes} change(s)`);
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

            // Green/magenta for pickups — noted items get magenta
            const confirmedSlots = result.slots.filter(s => newPickups.includes(s.index));
            const notedSlots = confirmedSlots.filter(s => isNotedItem(img, result.anchor, s.index));
            const unotedSlots = confirmedSlots.filter(s => !notedSlots.includes(s));
            if (unotedSlots.length > 0) drawSlotOverlaysFor(unotedSlots, { r: 80, g: 200, b: 80 });
            if (notedSlots.length > 0) drawSlotOverlaysFor(notedSlots, { r: 255, g: 80, b: 80 });
            log(`  ✅ Pickup: ${newPickups.map(i => `#${i+1}`).join(" ")}${notedSlots.length > 0 ? " (noted)" : ""}`);
            updateScanStatus(`${newPickups.length} pickup(s)`);
            for (const slot of confirmedSlots) {
                const noted = notedSlots.includes(slot);
                // Capture slot pixels as data URL
                const row = Math.floor(slot.index / Inventory.COLS);
                const col = slot.index % Inventory.COLS;
                const sx = result.anchor.x + col * result.anchor.colStride;
                const sy = result.anchor.y + row * result.anchor.rowStride;
                const pixelData = img.toData(sx, sy, 36, 32);
                try {
                    const canvas = document.createElement('canvas');
                    canvas.width = 36; canvas.height = 32;
                    const ctx = canvas.getContext('2d')!;
                    const id = ctx.createImageData(36, 32);
                    id.data.set(pixelData.data);
                    ctx.putImageData(id, 0, 0);
                    const url = canvas.toDataURL();
                    // Skip if same item hash already in list (fuzzy diff)
                    const dup = recentPickups.find(p => {
                        let diff = 0;
                        for (let i = 0; i < 64; i++) diff += Math.abs(parseInt(p.hash[i], 16) - parseInt(slot.hash[i], 16));
                        return diff < 10;
                    });
                    if (dup) {
                        let diff = 0;
                        for (let i = 0; i < 64; i++) diff += Math.abs(parseInt(dup.hash[i], 16) - parseInt(slot.hash[i], 16));
                        log(`  Skipped dup (diff=${diff}): ${slot.hash.slice(0,16)}...`);
                        continue;
                    }
                    // Check ignore list before adding to potential unlocks
                    if (isIgnored(slot.hash)) {
                        if (state.debugLogIgnores) {
                            log(`  🚫 Slot #${slot.index + 1} hash ${slot.hash.slice(0, 8)}… is ignored — skipping`);
                        }
                        continue;
                    }
                    recentPickups.push({ slotIndex: slot.index, imageUrl: url, time: Date.now(), noted, hash: slot.hash });
                    pickupVersion++;
                    if (recentPickups.length > MAX_PICKUPS) { recentPickups.pop(); pickupVersion++; }
                } catch { /* canvas not available */ }
            }
            diffPickupGrid();
            updatePickupGrid();
            for (const idx of newPickups) state.prevOccupied.add(idx);
        } else {
            updateAnchorDot();
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
export function resetUnlocks(): void {
    showModal("Delete all unlocked items?", "DANGER", () => {
        dataResetUnlocks();
        updateUI();
    });
}

// Ignore list — public functions
export function ignorePickup(index: number): void {
    const pickup = recentPickups[index];
    if (!pickup) { log("No pickup at index " + index); return; }

    // If already scanning, cancel first
    if (scanning) {
        // If already scanning this pickup for ignore, cancel
        if (scanning.slotIndex === pickup.slotIndex && scanning.imageUrl === pickup.imageUrl && scanning.mode === "ignore") {
            cancelScanning();
            return;
        }
        cancelScanning();
    }

    if (!state.inAlt1) {
        log("Not in Alt1 — cannot scan tooltip.");
        return;
    }

    const anc = Inventory.loadAnchor();
    if (!anc) {
        log("No anchor — cannot determine slot position.");
        return;
    }

    // Enter scanning mode for ignore
    scanning = { imageUrl: pickup.imageUrl, slotIndex: pickup.slotIndex, hash: pickup.hash, mode: "ignore", timer: null, lastTooltipAttempt: 0, hasEnteredSlot: false };

    if (scanNotificationHandle) scanNotificationHandle.remove();
    scanNotificationHandle = showNotification("Hover over the item to ignore", 0, "info");

    log(`Ignore mode — hover over slot #${pickup.slotIndex + 1} to read item name.`);

    scanning.timer = setInterval(pollScanningMouse, 150);
}

export function resetIgnores(): void {
    showModal("Delete all ignored items? This will allow them to appear in potential unlocks again.", "DANGER", () => {
        clearIgnoredItems();
        showNotification("All ignored items cleared", 2000, "success");
        updateUI();
    });
}

export function dumpIgnoredItems(): void {
    const items = getIgnoredItems();
    if (items.length === 0) { log("Ignore list is empty."); return; }
    console.table(items.map(i => ({
        name: i.name ?? "(unnamed)",
        hash: i.hash.slice(0, 16) + "…",
        ignoredAt: new Date(i.ignoredAt).toLocaleString()
    })));
    log(`Ignore list: ${items.length} item(s) logged to console.`);
}

export function removeIgnore(hash: string): void {
    hideIgnoreTooltip();
    removeIgnoredItem(hash);
    updateUI();
}

export function toggleIgnoreLog(checked: boolean): void {
    state.debugLogIgnores = checked;
    log(`Ignore logging: ${checked ? "ON" : "OFF"}`);
}

export function fillTestIgnores(): void {
    const before = getIgnoredCount();
    dataFillTestIgnores();
    updateUI();
    log(`Test ignores: ${before} → ${getIgnoredCount()} entries.`);
}

// Ignore list tooltip handlers
export function showIgnoreTooltip(name: string): void {
    const el = document.getElementById("ignore_tooltip");
    if (el) { el.textContent = name; el.style.display = "block"; }
}

export function hideIgnoreTooltip(): void {
    const el = document.getElementById("ignore_tooltip");
    if (el) el.style.display = "none";
}

export function moveIgnoreTooltip(e: MouseEvent): void {
    const el = document.getElementById("ignore_tooltip");
    if (!el) return;
    const gap = 12;
    const yOffset = 10;
    let left = e.clientX + gap;
    let top_ = e.clientY + gap + yOffset;
    // Render so we can measure, then adjust
    el.style.left = left + "px";
    el.style.top = top_ + "px";
    const r = el.getBoundingClientRect();
    // Flip left if overflowing right edge
    if (r.left + r.width > window.innerWidth) {
        left = e.clientX - gap - r.width;
    }
    // Flip up if overflowing bottom edge
    if (r.top + r.height > window.innerHeight) {
        top_ = e.clientY - gap + yOffset - r.height;
    }
    // Clamp to viewport margins
    left = Math.max(4, Math.min(left, window.innerWidth - r.width - 4));
    top_ = Math.max(4, Math.min(top_, window.innerHeight - r.height - 4));
    el.style.left = left + "px";
    el.style.top = top_ + "px";
}

// Confirm dialog
let modalCallback: (() => void) | null = null;
export function showModal(message: string, level: "SAFE" | "WARNING" | "DANGER" | "INFO", onConfirm: () => void): void {
    const modal = document.getElementById("modal");
    const content = document.getElementById("modal_content");
    const msgEl = document.getElementById("modal_msg");
    if (!modal || !content || !msgEl) return;
    msgEl.textContent = message;
    content.className = "modal-content" + (level === "WARNING" ? " level-warning" : level === "DANGER" ? " level-danger" : level === "INFO" ? " level-info" : "");
    modalCallback = onConfirm;
    modal.style.display = "flex";
}
export function modalCancel(): void {
    const modal = document.getElementById("modal");
    if (modal) modal.style.display = "none";
    modalCallback = null;
}
export function modalOk(): void {
    const modal = document.getElementById("modal");
    if (modal) modal.style.display = "none";
    if (modalCallback) {
        const cb = modalCallback;
        modalCallback = null;
        cb();
    }
}

// ============================================================
// Unlock current pickup — scanning mode via tooltip
// ============================================================

interface ScanningState {
    imageUrl: string;
    slotIndex: number;
    hash: string;
    mode: "unlock" | "ignore";
    timer: ReturnType<typeof setInterval> | null;
    lastTooltipAttempt: number;
    hasEnteredSlot: boolean;
}

let scanning: ScanningState | null = null;

/** Toggle: starts scanning mode or cancels it. */
export function unlockPickup(index: number): void {
    const pickup = recentPickups[index];
    if (!pickup) { log("No pickup at index " + index); return; }

    if (scanning) {
        // If already scanning this pickup, cancel
        if (scanning.slotIndex === pickup.slotIndex && scanning.imageUrl === pickup.imageUrl) {
            cancelScanning();
            return;
        }
        // Otherwise cancel current scan first, then start new one below
        cancelScanning();
    }

    if (!state.inAlt1) {
        log("Not in Alt1 — cannot scan tooltip.");
        return;
    }

    const anc = Inventory.loadAnchor();
    if (!anc) {
        log("No anchor — cannot determine slot position.");
        return;
    }

    // Enter scanning mode
    scanning = { imageUrl: pickup.imageUrl, slotIndex: pickup.slotIndex, hash: pickup.hash, mode: "unlock", timer: null, lastTooltipAttempt: 0, hasEnteredSlot: false };

    if (scanNotificationHandle) scanNotificationHandle.remove();
    scanNotificationHandle = showNotification("Hover over the item", 0, "info");

    log(`Scanning mode — hover over slot #${pickup.slotIndex + 1} to read item name.`);

    // Start polling mouse position
    scanning.timer = setInterval(pollScanningMouse, 150);
}

// Keep backward compat alias
export function unlockCurrentItem(): void {
    if (recentPickups.length > 0) unlockPickup(0);
}

function cancelScanning(): void {
    if (!scanning) return;
    if (scanning.timer) { clearInterval(scanning.timer); scanning.timer = null; }
    scanning = null;

        if (scanNotificationHandle) { scanNotificationHandle.remove(); scanNotificationHandle = null; }

    log("Scanning cancelled.");
}

const TOOLTIP_RETRY_MS = 600;

function pollScanningMouse(): void {
    if (!scanning || !state.inAlt1) { cancelScanning(); return; }

    const anc = Inventory.loadAnchor();
    if (!anc) { cancelScanning(); return; }

    // Get slot screen bounds
    const row = Math.floor(scanning.slotIndex / Inventory.COLS);
    const col = scanning.slotIndex % Inventory.COLS;
    const sx = anc.x + col * anc.colStride;
    const sy = anc.y + row * anc.rowStride;
    const sw = 36;
    const sh = 32;

    // Check mouse position
    let pos;
    try { pos = a1lib.getMousePosition(); } catch { return; }
    if (!pos) return;

    const insideSlot = pos.x >= sx && pos.x <= sx + sw && pos.y >= sy && pos.y <= sy + sh;

    if (!insideSlot) {
        // Only cancel if the mouse was previously inside the slot
        if (scanning.hasEnteredSlot) {
            log(`Mouse left slot #${scanning.slotIndex + 1}, cancelling scan.`);
            cancelScanning();
        }
        return;
    }

    // Mouse is inside the slot — mark entry and respect cooldown
    scanning.hasEnteredSlot = true;
    const now = Date.now();
    if (now - scanning.lastTooltipAttempt < TOOLTIP_RETRY_MS) return;
    scanning.lastTooltipAttempt = now;

    try {
        // Start from cursor position, look downward for 0f0e0c (rgb(15,14,12))
        const anc = Inventory.loadAnchor();
        if (!anc) { cancelScanning(); return; }

        // Capture: 300px above, 100px below slot center, slot width only
        const captW = anc.colStride;
        const captH = 400;
        const captX = sx;
        const captY = Math.max(0, sy + 16 - 300); // slot center at buffer row 300

        const img = a1lib.captureHold(captX, captY, captW, captH);
        if (!img) { log("  Failed to capture."); return; }

        const data = img.toData();
        if (!data) { log("  Failed to read pixels."); return; }

        // Get the cursor position relative to the capture
        let cursorInCaptX = -1, cursorInCaptY = -1;
        try {
            const mpos = a1lib.getMousePosition();
            if (mpos) {
                cursorInCaptX = mpos.x - captX;
                cursorInCaptY = mpos.y - captY;
            }
        } catch { /* ignore */ }
        if (cursorInCaptX < 0) { log("  No cursor pos."); return; }

        // Search for item text color (gold or cyan), branch down first, then up
        const CENTER_Y = 300; // slot center in buffer coords

        const TEXT_COLORS = [
            { r: 248, g: 213, b: 107, name: "TOOLTIP_ITEM_COLOR_MEMBERS" },
            { r: 184, g: 209, b: 209, name: "TOOLTIP_ITEM_COLOR_F2P" },
        ];

        let foundX = -1, foundY = -1;
        let foundDir = "DOWN";
        let foundColorName = "";

        const checkTextPixel = (px: number, py: number): boolean => {
            const i = (py * captW + px) * 4;
            const r = data.data[i], g = data.data[i + 1], b = data.data[i + 2];
            for (const c of TEXT_COLORS) {
                if (r === c.r && g === c.g && b === c.b) {
                    foundColorName = c.name;
                    return true;
                }
            }
            return false;
        }

        // Try downward: center → captH
        for (let py = CENTER_Y; py < captH && foundX < 0; py++) {
            for (let px = 0; px < captW && foundX < 0; px++) {
                if (checkTextPixel(px, py)) { foundX = px; foundY = py; }
            }
        }

        // If not found downward, try upward: center-1 → 0
        if (foundX < 0) {
            foundDir = "UP";
            for (let py = CENTER_Y - 1; py >= 0 && foundX < 0; py--) {
                for (let px = 0; px < captW && foundX < 0; px++) {
                    if (checkTextPixel(px, py)) { foundX = px; foundY = py; }
                }
            }
        }

        if (foundX < 0) {
            log("  No tooltip text found near slot center.");
            if (showTooltipDebug && state.inAlt1) {
                alt1.overLaySetGroup("bronzeman_tooltipdbg");
                alt1.overLayClearGroup("bronzeman_tooltipdbg");
                alt1.overLayRect(a1lib.mixColor(0, 255, 0), captX, captY, captW, captH, 2000, 1);
                alt1.overLayText("No text found", a1lib.mixColor(255, 0, 0), 11, captX + 5, captY + 5, 2000);
            }
            return;
        }

        // Step ~15px straight down from text pixel to find tooltip background (0f0e0c)
        const [bgR, bgG, bgB] = TOOLTIP_BG_COLOR;
        let stepY = -1;
        for (let s = 1; s <= 15; s++) {
            const py = foundY + s;
            if (py >= captH) break;
            const i = (py * captW + foundX) * 4;
            if (data.data[i] === bgR && data.data[i+1] === bgG && data.data[i+2] === bgB) {
                stepY = py;
                break;
            }
        }

        if (stepY < 0) {
            log("  No background found below text.");
            return;
        }

        // Capture a wide area centered on the background pixel for full flood-fill
        const wideW = 500;
        const wideH = 400;
        const bgScreenX = captX + foundX;
        const bgScreenY = captY + stepY;
        const wideX = Math.max(0, bgScreenX - Math.round(wideW / 2));
        const wideY = Math.max(0, bgScreenY - Math.round(wideH / 2));
        const wideImg = a1lib.captureHold(wideX, wideY, wideW, wideH);
        const wideData = wideImg ? wideImg.toData() : null;

        if (!wideImg || !wideData) {
            log("  No background found below text.");
            return;
        }

        // Map step pixel to wide buffer coords
        const stepWX = bgScreenX - wideX;
        const stepWY = bgScreenY - wideY;

        // Walk the tooltip boundary: find bottom → right → top → left
        const isBg = (px: number, py: number): boolean => {
            if (px < 0 || px >= wideW || py < 0 || py >= wideH) return false;
            const i = (py * wideW + px) * 4;
            return wideData.data[i] === bgR && wideData.data[i+1] === bgG && wideData.data[i+2] === bgB;
        };
        const [borderR, borderG, borderB] = TOOLTIP_INNER_BORDER_COLOR;
        const isBorder = (px: number, py: number): boolean => {
            if (px < 0 || px >= wideW || py < 0 || py >= wideH) return false;
            const i = (py * wideW + px) * 4;
            return wideData.data[i] === borderR && wideData.data[i+1] === borderG && wideData.data[i+2] === borderB;
        };

        // 1. Go DOWN from step pixel until hitting TOOLTIP_INNER_BORDER_COLOR
        let botY = stepWY;
        while (botY + 1 < wideH && !isBorder(stepWX, botY + 1)) botY++;
        // 2. From bottom edge, go RIGHT until hitting non-bg (right border)
        let rightX = stepWX;
        while (rightX + 1 < wideW && isBg(rightX + 1, botY)) rightX++;
        // 3. From right-bottom, go UP counting pixels (this = rect height)
        let topY = botY;
        while (topY - 1 >= 0 && isBg(rightX, topY - 1)) topY--;
        const rectH = botY - topY + 1;
        // 4. From top-right, go LEFT counting pixels (this = rect width)
        let leftX = rightX;
        while (leftX - 1 >= 0 && isBg(leftX - 1, topY)) leftX--;
        const rectW = rightX - leftX + 1;

        // top-left = (leftX, topY), size = rectW × rectH
        const minX = leftX, minY = topY;
        const tooltipW = rectW;
        const tooltipH = rectH;

        // Debug overlay: green=capture area, magenta=tooltip bounds, red=text pixel, cyan=wide scan area
        if (showTooltipDebug && state.inAlt1) {
            alt1.overLaySetGroup("bronzeman_tooltipdbg");
            alt1.overLayClearGroup("bronzeman_tooltipdbg");
            // Green: narrow slot-width capture
            alt1.overLayRect(a1lib.mixColor(0, 255, 0), captX, captY, captW, captH, 2000, 1);
            // Cyan: wide capture area
            alt1.overLayRect(a1lib.mixColor(0, 255, 255), wideX, wideY, wideW, wideH, 2000, 2);
            // Magenta: flood-filled tooltip bounds (wide buffer)
            alt1.overLayRect(a1lib.mixColor(255, 0, 255), wideX + minX, wideY + minY, tooltipW, tooltipH, 2000, 2);
            // Red: found text pixel
            alt1.overLayRect(a1lib.mixColor(255, 0, 0), captX + foundX - 2, captY + foundY - 2, 5, 5, 2000, 2);
        }

        // Debug: draw OCR preview pixels onto HTML canvas
        if (showTooltipDebug && tooltipW > 5 && tooltipH > 5) {
            const canvas = document.getElementById("ocr_preview") as HTMLCanvasElement;
            if (canvas) {
                const MAX_CANVAS_W = 320;
                const previewW = Math.min(tooltipW, MAX_CANVAS_W);
                const previewH = Math.min(tooltipH, 60);
                if (previewW !== tooltipW) log(`  Preview clipped: tooltipW=${tooltipW} > ${MAX_CANVAS_W}`);
                canvas.width = previewW;
                canvas.height = previewH;
                canvas.style.display = "block";
                canvas.style.width = previewW + "px";
                const ctx = canvas.getContext("2d");
                if (ctx) {
                    const imgData = ctx.createImageData(previewW, previewH);
                    for (let py = 0; py < previewH; py++) {
                        for (let px = 0; px < previewW; px++) {
                            const sx = minX + px;
                            const sy = minY + py;
                            if (sx >= wideW || sy >= wideH) continue;
                            const srcIdx = (sy * wideW + sx) * 4;
                            const dstIdx = (py * previewW + px) * 4;
                            imgData.data[dstIdx] = wideData.data[srcIdx];
                            imgData.data[dstIdx + 1] = wideData.data[srcIdx + 1];
                            imgData.data[dstIdx + 2] = wideData.data[srcIdx + 2];
                            imgData.data[dstIdx + 3] = 255;
                        }
                    }
                    ctx.putImageData(imgData, 0, 0);
                }
            }
        }

        // Try OCR on the detected tooltip area — try multiple font sizes
        try {
            if (tooltipW > 20 && tooltipH > 10) {
                const colors: OCR.ColortTriplet[] = [[248, 213, 107], [184, 209, 209]];
                const tooltipFont = require("alt1/fonts/chatbox/14pt");

                const ocrLine = (y: number, searchH?: number): string => {
                    const h = searchH ?? tooltipH;
                    try {
                        const result = OCR.findReadLine(wideData, tooltipFont, colors, leftX, y, tooltipW, h);
                        if (result?.text && result.text.length > 1) return result.text;
                    } catch {}
                    return "";
                };

                const isMultiLine = tooltipH > 30;
                let text: string;
                if (isMultiLine) {
                    const halfH = Math.round(tooltipH / 2);
                    const line1 = ocrLine(topY + Math.round(tooltipH / 4), halfH);
                    const line2 = ocrLine(topY + Math.round(tooltipH * 3 / 4), halfH);
                    log(`  2-line → line1: "${line1}"`);
                    log(`  2-line → line2: "${line2}"`);
                    text = (line1 + " " + line2).trim();
                } else {
                    text = ocrLine(topY + Math.round(tooltipH / 2));
                }

                if (text) {
                    log(`  OCR text: "${text}"`);
                    const itemName = extractItemName(text);
                    if (itemName) {
                        log(`  Name: "${itemName}"`);
                        if (scanning.mode === "ignore") {
                            ignoreItem(scanning.hash, itemName, scanning.imageUrl);
                            const idx = recentPickups.findIndex(e => e.hash === scanning.hash);
                            if (idx >= 0) {
                                recentPickups.splice(idx, 1);
                                pickupVersion++;
                                diffPickupGrid();
                            }
                            showNotification("Ignored: " + itemName, 2000, "warning");
                            log(`IGNORED: "${itemName}"`);
                            updateUI();
                        } else {
                            if (unlockItem(itemName, scanning.imageUrl)) {
                                log(`UNLOCKED: "${itemName}"`);
                                updateUI();
                            } else {
                                log(`"${itemName}" already unlocked.`);
                            }
                        }
                        cancelScanning();
                    }
                } else {
                    log("  OCR: no text found");
                }
            }
        } catch (e) { log(`  OCR error: ${e}`); }
    } catch (e) {
        log(`  Scan error: ${e}`);
    }
}

/** Strip common RS3 action prefixes from tooltip text to get the item name. */
function extractItemName(raw: string): string {
    if (!raw) return "";
    const t = raw.trim();
    // Common RS3 action words
    const actions = [
        "Use", "Wield", "Equip", "Wear", "Eat", "Drink", "Drop", "Examine",
        "Bury", "Clean", "Empty", "Fill", "Light", "String", "Craft", "Fletch",
        "Open", "Close", "Read", "Teleport", "Cast", "Rub", "Activate",
        "Deactivate", "Check", "Mix", "Grind", "Cook", "Smelt", "Smith",
        "Enchant", "Charge", "Alch", "Disassemble", "Augment", "Siphon",
        "Dissolve", "Take", "Remove", "Withdraw", "Deposit", "Store",
        "Release", "Toggle", "Configure", "Convert", "Combine",
    ];
    for (const act of actions) {
        if (t.startsWith(act + " ")) {
            return t.substring(act.length + 1).trim();
        }
    }
    // If no action prefix matched, the OCR probably returned just the item name
    return t;
}

// ============================================================
// ============================================================
// Pickup grid — renders recent item thumbnails and scan tab cards

/** Build a single pickup card DOM node */
function buildCardNode(p: PickupEntry): HTMLElement {
    const hash = p.hash;
    const card = document.createElement("div");
    card.className = "pickup-card";
    card.addEventListener("click", () => {
        const idx = recentPickups.findIndex(e => e.hash === hash);
        if (idx >= 0) unlockPickup(idx);
    });

    const btn = document.createElement("button");
    btn.className = "btn-item-menu-overlay";
    btn.textContent = "✕";
    btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const idx = recentPickups.findIndex(entry => entry.hash === hash);
        if (idx >= 0) ignorePickup(idx);
    });
    card.appendChild(btn);

    const wrap = document.createElement("div");
    wrap.className = "pickup-img-wrap";

    const img = document.createElement("img");
    img.src = p.imageUrl;
    img.alt = "pickup";
    wrap.appendChild(img);

    card.appendChild(wrap);
    return card;
}

/** Diff-based update of the scan tab pickup grid — only touches changed cards */
function diffPickupGrid(): void {
    // No-op guard: if nothing mutated since last render, skip everything
    if (pickupVersion === lastRenderedVersion) return;

    const grid = document.getElementById("scan_pickup_grid");
    const ph = document.getElementById("scan_placeholder");
    if (!grid) return;

    // Empty state
    if (recentPickups.length === 0) {
        grid.innerHTML = "";
        if (ph) ph.style.display = "block";
        renderedCardHashes = [];
        renderedCardNodes = [];
        lastRenderedVersion = pickupVersion;
        return;
    }
    if (ph) ph.style.display = "none";

    const currentHashes = new Set(recentPickups.map(p => p.hash));

    // 1. Remove cards whose hash is gone
    for (let i = renderedCardNodes.length - 1; i >= 0; i--) {
        if (!currentHashes.has(renderedCardHashes[i])) {
            grid.removeChild(renderedCardNodes[i]);
            renderedCardNodes.splice(i, 1);
            renderedCardHashes.splice(i, 1);
        }
    }

    // 2. Add cards for hashes not yet rendered
    const renderedSet = new Set(renderedCardHashes);
    for (const p of recentPickups) {
        if (!renderedSet.has(p.hash)) {
            const card = buildCardNode(p);
            grid.appendChild(card);
            renderedCardNodes.push(card);
            renderedCardHashes.push(p.hash);
        }
    }

    lastRenderedVersion = pickupVersion;
}

/** Renders the item log tab */
// ============================================================

function updatePickupGrid(): void {
    const container = document.getElementById("pickup_grid");
    if (!container) return;
    if (recentPickups.length === 0) {
        container.innerHTML = `<div style="color:#555;text-align:center;padding:8px;">No items picked up yet.</div>`;
        return;
    }
    container.innerHTML = recentPickups.map((p, i) =>
        `<div class="pickup-thumb" style="border-color:${p.noted ? '#f44336' : '#4caf50'}" title="Slot #${p.slotIndex + 1}${p.noted ? ' (noted)' : ''}">
            <img src="${p.imageUrl}" alt="slot ${p.slotIndex + 1}">
            <div class="pickup-label" style="color:${p.noted ? '#f44336' : '#4caf50'}">#${p.slotIndex + 1}</div>
        </div>`
    ).join("");
}

export function savePickupImages(): void {
    if (recentPickups.length === 0) { log("No pickup images to save"); return; }
    log(`Saving ${recentPickups.length} pickup image(s)...`);
    for (const p of recentPickups) {
        const link = document.createElement('a');
        link.download = `pickup_slot${p.slotIndex + 1}_${p.time}.png`;
        link.href = p.imageUrl;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
    log(`Triggered download for ${recentPickups.length} image(s)`);
}

export function debugPickupPixels(): void {
    if (recentPickups.length === 0) { log("No pickups to debug"); return; }
    const p = recentPickups[0];
    const anc = Inventory.loadAnchor();
    if (!anc) { log("No anchor saved"); return; }
    if (!state.inAlt1) { log("Not in Alt1"); return; }
    const img = captureFullRs();
    if (!img) { log("Failed to capture RS"); return; }
    const row = Math.floor(p.slotIndex / Inventory.COLS);
    const col = p.slotIndex % Inventory.COLS;
    const sx = anc.x + col * anc.colStride;
    const sy = anc.y + row * anc.rowStride;

    log(`=== Debug pickup slot #${p.slotIndex + 1} at (${sx},${sy}) ===`);
    // Log several pixel positions
    const positions: { name: string; ox: number; oy: number }[] = [
        { name: "(11,0) noted ref1", ox: 11, oy: 0 },
        { name: "(12,0) noted ref2", ox: 12, oy: 0 },
        { name: "TL corner (1,1)", ox: 1, oy: 1 },
        { name: "Center (18,16)", ox: 18, oy: 16 },
        { name: "BR corner (34,30)", ox: 34, oy: 30 },
    ];
    for (const pos of positions) {
        const d = img.toData(sx + pos.ox, sy + pos.oy, 1, 1);
        if (d) {
            const r = d.data[0], g = d.data[1], b = d.data[2];
            const hex = `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
            log(`  ${pos.name}: rgb(${r},${g},${b}) ${hex}`);
        }
    }
    log(`=== End debug ===`);
}

// Grid boundary overlay
// ============================================================

let showGridBoundary = false;
let showTooltipDebug = false;

export function toggleTooltipDebug(): void {
    const cb = document.getElementById("show_tooltip_debug") as HTMLInputElement;
    showTooltipDebug = cb?.checked ?? false;
    log(`showTooltipDebug=${showTooltipDebug}`);
    if (!showTooltipDebug && state.inAlt1) {
        alt1.overLayClearGroup("bronzeman_tooltipdbg");
    }
}

export function toggleSlotOverlays(): void {
    const cb = document.getElementById("show_slot_overlays") as HTMLInputElement;
    setShowSlotOverlays(cb?.checked ?? false);
    log(`showSlotOverlays=${showSlotOverlays}`);
}

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
