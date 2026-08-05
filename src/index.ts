// Bronzeman Mode — Alt1 plugin
// Tracks which items you've earned yourself before allowing GE purchases.
import * as a1lib from "alt1";
import { ImgRef, ImgRefBind } from "alt1/base";
import * as Inventory from "./inventory";
import { BUILD, BUILD_NUM } from "./version";

import "./index.html";
import "./appconfig.json";
import "./icon.png";

// ============================================================
// Work around webpack module-load race with Alt1 library's
// static `hasAlt1` flag. We bypass the library's gated functions
// entirely and call alt1.* APIs directly after verifying the
// global exists at call time.
// ============================================================

function ensureAlt1(): boolean {
    return typeof alt1 !== "undefined";
}

/**
 * Capture the full RS screen directly via alt1.bindRegion,
 * bypassing the library's hasAlt1/requireAlt1 gating.
 * Returns an ImgRefBind that supports findSubimage + toData.
 */
function captureFullRs(): ImgRef | null {
    if (!ensureAlt1()) return null;
    try {
        const w = alt1.rsWidth;
        const h = alt1.rsHeight;
        const handle = alt1.bindRegion(0, 0, w, h);
        if (handle <= 0) return null;
        return new ImgRefBind(handle, 0, 0, w, h);
    } catch {
        return null;
    }
}

// ============================================================
// Constants
// ============================================================

const LS_PREFIX = "Bronzeman/";
const LS_KEYS = {
    unlockedItems: LS_PREFIX + "unlockedItems",
    scanHistory: LS_PREFIX + "scanHistory",
} as const;

const POLL_INTERVAL_MS = 1000;

// ============================================================
// State
// ============================================================

let unlockedItems: Set<string> = new Set();
let inAlt1 = false;
let polling = false;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let lastScanResult: Inventory.ScanResult | null = null;
let scanCount = 0;
let moveMode = false;
let moveModeTimer: ReturnType<typeof setInterval> | null = null;

// 2-scan confirmation: slotIndex → hash that was seen last scan
const pendingChanges = new Map<number, string>();

// ============================================================
// Initialization
// ============================================================

export function initOnLoad() {
    log("Bronzeman initializing...");
    // Show build number in title
    const bn = document.getElementById("build_num");
    if (bn) bn.textContent = `(#${BUILD_NUM})`;

    inAlt1 = typeof window.alt1 !== "undefined";
    log(`inAlt1=${inAlt1}`);

    updateAlt1Status();
    loadState();

    if (inAlt1) {
        alt1.identifyAppUrl("./appconfig.json");

        // Show calibration status
        const hasRef = Inventory.hasAnchor();
        if (hasRef) {
            log("Reference image loaded — using ref-based detection.");
        } else {
            log("No reference image. Click 📷 Capture Ref while hovering over an inventory slot.");
        }

        showOverlay("Bronzeman ready!", a1lib.mixColor(212, 168, 75), 2000);
        startPolling();
    }

    updateUI();
    log(`Init done. inAlt1=${inAlt1}`);
}

// ============================================================
// Polling
// ============================================================

export function startPolling(): void {
    if (!inAlt1) { log("Not in Alt1."); return; }
    if (!alt1.permissionPixel) { log("No pixel permission."); updateScanStatus("No pixel perm"); return; }
    if (polling) return;

    polling = true;
    updateScanStatus("Polling...");
    log(`Polling every ${POLL_INTERVAL_MS}ms`);

    Inventory.resetHashes();
    doScan();
    pollTimer = setInterval(doScan, POLL_INTERVAL_MS);
}

export function stopPolling(): void {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    polling = false;
    updateScanStatus("Idle");
    log("Polling stopped.");
}

export function isPolling(): boolean { return polling; }

// ============================================================
// Reference image capture — countdown, then capture a small
// needle at the RS cursor position. findSubimage uses this to
// locate the first slot's top-left corner.
// ============================================================

let refCountdown: ReturnType<typeof setInterval> | null = null;
let refCountdownValue = 0;

export function captureReference(): void {
    if (!inAlt1) { log("Not in Alt1."); return; }
    if (!alt1.permissionPixel) { log("No pixel permission."); return; }

    refCountdownValue = 3;
    showOverlay("Move RS mouse to TOP-LEFT corner of inventory slot 1 — capturing in 3...", a1lib.mixColor(100, 200, 255), 5000);

    refCountdown = setInterval(() => {
        refCountdownValue--;
        if (refCountdownValue <= 0) {
            if (refCountdown) { clearInterval(refCountdown); refCountdown = null; }
            doCaptureRef();
        } else {
            showOverlay(`Move mouse to top-left of slot 1 — ${refCountdownValue}...`, a1lib.mixColor(100, 200, 255), 2000);
        }
    }, 1000);
}

function doCaptureRef(): void {
    const ok = Inventory.captureAnchorAtCursor(a1lib);
    if (ok) {
        Inventory.resetHashes();
        updateScanStatus("Reference captured!");
        log("Reference image saved. findSubimage will locate slot 1, rest derived by stride detection.");
        showOverlay("Reference saved! Scanning...", a1lib.mixColor(100, 255, 100), 2000);
        doScan();
    } else {
        log("Capture failed. Make sure RS is active and mouse is over slot 1 corner.");
        showOverlay("Failed — RS active? Mouse over slot?", a1lib.mixColor(255, 80, 80), 3000);
    }
}

export function clearReference(): void {
    Inventory.clearAnchor();
    Inventory.resetHashes();
    scanCount = 0;
    log("Anchor cleared. Using fallback position. Capture again to set.");
    updateScanStatus("No anchor");
    updateUI();
}

export function clearCalibration(): void {
    clearReference();
}

// Stride adjustment — tweak until blue grid matches inventory exactly
export function adjColStride(d: number): void {
    const anc = Inventory.adjustStride(d, 0);
    if (anc) { updateUI(); if (moveMode) drawMoveGrid(); else doScan(); }
}
export function adjRowStride(d: number): void {
    const anc = Inventory.adjustStride(0, d);
    if (anc) { updateUI(); if (moveMode) drawMoveGrid(); else doScan(); }
}
export function nudgeAnchorX(d: number): void {
    const anc = Inventory.shiftAnchor(d, 0);
    if (anc) { updateUI(); if (moveMode) drawMoveGrid(); else doScan(); }
}
export function nudgeAnchorY(d: number): void {
    const anc = Inventory.shiftAnchor(0, d);
    if (anc) { updateUI(); if (moveMode) drawMoveGrid(); else doScan(); }
}

// Move mode: show blue grid persistently on RS screen for alignment
export function toggleMoveMode(): void {
    moveMode = !moveMode;
    const btn = document.getElementById("move_mode_btn");
    if (moveMode) {
        // Stop normal polling, start overlay drawing
        stopPolling();
        drawMoveGrid();
        moveModeTimer = setInterval(drawMoveGrid, 800);
        if (btn) { btn.textContent = "🔲 Stop Move"; btn.className = "btn btn-danger"; }
        log("Move mode ON — adjust strides/arrows, grid shown on RS screen");
    } else {
        // Clear overlay, restart polling
        if (moveModeTimer) { clearInterval(moveModeTimer); moveModeTimer = null; }
        clearMoveGrid();
        Inventory.resetHashes();  // discard move-mode hashes
        if (btn) { btn.textContent = "🔳 Move Mode"; btn.className = "btn btn-secondary"; }
        log("Move mode OFF — resuming inventory scanning");
        startPolling();
    }
}

function drawMoveGrid(): void {
    if (!inAlt1 || !alt1.permissionPixel || !alt1.permissionOverlay) return;
    const anc = Inventory.loadAnchor();
    if (!anc) return;

    const blue = a1lib.mixColor(60, 140, 255);
    const time = 2000;

    try {
        const img = captureFullRs();
        if (!img) return;
        const slots = Inventory.readSlots(img, anc, [], () => {});

        // Clear previous frame first to avoid ghosting, then redraw
        alt1.overLayClearGroup("bronzeman_move");
        alt1.overLaySetGroup("bronzeman_move");
        for (const s of slots) {
            alt1.overLayRect(blue, s.x, s.y, s.w, s.h, time, 1);
        }
    } catch { /* overlay can fail if RS loses focus */ }
}

function clearMoveGrid(): void {
    if (!inAlt1) return;
    alt1.overLayClearGroup("bronzeman_move");
}

// ============================================================
// Core scan logic
// ============================================================

function doScan(): void {
    if (!inAlt1 || !alt1.permissionPixel) { stopPolling(); return; }

    // Re-evaluate in case alt1 state changed (safety net for module-load race)
    a1lib.resetEnvironment();

    try {
        const img = captureFullRs();
        if (!img) { log("ERROR: captureFullRs returned null — is RS linked?"); return; }

        // Pass debug callback so inventory.ts diagnostics appear in the UI log
        const result = Inventory.scan(img, (msg) => log("  [inv] " + msg));
        scanCount++;
        lastScanResult = result;

        updateDebugGrid(result);
        drawSlotOverlays(result);

        if (scanCount === 1) {
            updateScanStatus(`Baseline (${result.anchor.method})`);
            log(`Scan #1: anchor (${result.anchor.x},${result.anchor.y}) via ${result.anchor.method}, img=${img.width}x${img.height}`);
            // Draw ALL slots on first scan so user can verify position
            drawAllSlotOverlays(result, POLL_INTERVAL_MS + 3000);
            return;
        }

        if (result.changes > 0) {
            // Filter 1: batch change — >4 slots = UI event (bank, dialog), ignore
            if (result.changes > 4) {
                drawSlotOverlays(result, { r: 255, g: 80, b: 80 }); // red
                updateDebugGrid(result, true); // red in debug tab too
                log(`  ⏭ Skipped: ${result.changes} slots changed at once (UI event, not inventory action)`);
                return;
            }

            // Filter 2: anti-drag — if RS cursor is inside inventory, user is likely dragging
            if (isCursorInInventory(result)) {
                drawSlotOverlays(result, { r: 255, g: 80, b: 80 }); // red
                updateDebugGrid(result, true);
                log(`  ⏭ Skipped: cursor inside inventory (likely drag/UI interaction)`);
                return;
            }

            const changedSlots = result.slots.filter(s => s.changed);
            const confirmed: Inventory.SlotState[] = [];
            const newlyPending: Inventory.SlotState[] = [];
            const reverted: Inventory.SlotState[] = [];

            for (const slot of changedSlots) {
                const prev = pendingChanges.get(slot.index);
                if (prev !== undefined) {
                    if (prev === slot.hash) {
                        confirmed.push(slot);
                    } else {
                        reverted.push(slot);
                    }
                    pendingChanges.delete(slot.index);
                } else {
                    pendingChanges.set(slot.index, slot.hash);
                    newlyPending.push(slot);
                }
            }

            // Clean stale pending entries for slots that reverted to baseline
            const changedIndices = new Set(changedSlots.map(s => s.index));
            const stale: number[] = [];
            pendingChanges.forEach((_, idx) => { if (!changedIndices.has(idx)) stale.push(idx); });
            stale.forEach(idx => pendingChanges.delete(idx));

            // Overlays: orange for reverted, yellow for pending, red for confirmed
            if (reverted.length > 0) {
                drawSlotOverlaysFor(reverted, { r: 255, g: 80, b: 80 }); // red
                log(`  ⏭ Reverted: ${reverted.map(s => `#${s.index + 1}`).join(" ")}`);
            }
            if (newlyPending.length > 0) {
                drawSlotOverlaysFor(newlyPending, { r: 255, g: 215, b: 0 }, reverted.length === 0);
                updateDebugGrid(result, true, new Set(newlyPending.map(s => s.index)));
            }
            if (confirmed.length > 0) {
                drawSlotOverlaysFor(confirmed, { r: 80, g: 200, b: 80 }, newlyPending.length === 0 && reverted.length === 0); // green
                const names = confirmed.map(s => `#${s.index + 1}[r${s.row},c${s.col}]`).join(" ");
                log(`  ✅ Confirmed: ${names}`);
                updateScanStatus(`${confirmed.length} confirmed`);
                for (const slot of confirmed) appendChangeEntry(slot, result.time);
            }

            if (confirmed.length === 0 && newlyPending.length === 0 && reverted.length === 0) {
                updateDebugGrid(result);
            }
        } else {
            updateScanStatus(`Polling #${scanCount}`);
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

export async function scanInventory(): Promise<void> {
    if (!inAlt1) { log("Not in Alt1."); return; }
    if (!alt1.permissionPixel) { log("No pixel permission."); return; }
    doScan();
}

// ============================================================
// Overlays
// ============================================================

function drawSlotOverlaysFor(slots: Inventory.SlotState[], color: { r: number; g: number; b: number }, clearFirst = true): void {
    if (!inAlt1) return;
    if (clearFirst) {
        alt1.overLayClearGroup("bronzeman_slots");
        alt1.overLaySetGroup("bronzeman_slots");
    }
    const clr = a1lib.mixColor(color.r, color.g, color.b);
    for (const slot of slots) {
        alt1.overLayRect(clr, slot.x, slot.y, slot.w, slot.h, POLL_INTERVAL_MS + 200, 2);
        alt1.overLayText(String(slot.index + 1), a1lib.mixColor(255, 255, 255), 11, slot.x + 3, slot.y + 2, POLL_INTERVAL_MS + 200);
    }
}

function drawSlotOverlays(result: Inventory.ScanResult, color?: { r: number; g: number; b: number }): void {
    const changed = result.slots.filter(s => s.changed);
    if (changed.length === 0) return;
    drawSlotOverlaysFor(changed, color || { r: 80, g: 200, b: 80 }); // green default

    // Gold dot at anchor
    alt1.overLaySetGroup("bronzeman_slots");
    alt1.overLayRect(a1lib.mixColor(212, 168, 75), result.anchor.x - 2, result.anchor.y - 2, 5, 5, POLL_INTERVAL_MS + 200, 1);
}

/** Draw ALL 28 slots briefly so the user can verify alignment. */
function drawAllSlotOverlays(result: Inventory.ScanResult, duration: number): void {
    if (!inAlt1) return;
    alt1.overLayClearGroup("bronzeman_all");
    alt1.overLaySetGroup("bronzeman_all");
    for (const slot of result.slots) {
        alt1.overLayRect(a1lib.mixColor(100, 180, 255), slot.x, slot.y, slot.w, slot.h, duration, 1);
        alt1.overLayText(String(slot.index + 1), a1lib.mixColor(255, 255, 255), 10, slot.x + 2, slot.y + 1, duration);
    }
}

// ============================================================
// Persistence
// ============================================================

function loadState(): void {
    try {
        const raw = localStorage.getItem(LS_KEYS.unlockedItems);
        if (raw) {
            unlockedItems = new Set(JSON.parse(raw));
            log(`Loaded ${unlockedItems.size} unlocked items.`);
        } else {
            localStorage.setItem(LS_KEYS.unlockedItems, JSON.stringify([]));
        }
        if (!localStorage.getItem(LS_KEYS.scanHistory)) {
            localStorage.setItem(LS_KEYS.scanHistory, JSON.stringify([]));
        }
    } catch (e) { log("ERROR loading: " + e); }
}

function saveState(): void {
    try { localStorage.setItem(LS_KEYS.unlockedItems, JSON.stringify(Array.from(unlockedItems))); }
    catch (e) { log("ERROR saving: " + e); }
}

// ============================================================
// Bronzeman logic
// ============================================================

export function unlockItem(itemName: string): boolean {
    const n = itemName.trim();
    if (!n || unlockedItems.has(n)) return false;
    unlockedItems.add(n);
    saveState();
    addScanHistory(n, "unlocked");
    updateUI();
    log(`UNLOCKED: "${n}"`);
    if (inAlt1) showOverlay(`Unlocked: ${n}`, a1lib.mixColor(100, 255, 100), 3000);
    return true;
}

export function isUnlocked(name: string): boolean { return unlockedItems.has(name.trim()); }
export function getUnlockedCount(): number { return unlockedItems.size; }
export function getUnlockedItems(): string[] { return Array.from(unlockedItems).sort(); }

function addScanHistory(item: string, action: string): void {
    try {
        const raw = localStorage.getItem(LS_KEYS.scanHistory);
        const h: { item: string; action: string; time: string }[] = raw ? JSON.parse(raw) : [];
        h.push({ item, action, time: new Date().toISOString() });
        while (h.length > 500) h.shift();
        localStorage.setItem(LS_KEYS.scanHistory, JSON.stringify(h));
    } catch (e) { /* ignore */ }
}

// ============================================================
// Export / Reset
// ============================================================

export function exportData(): void {
    const data = { unlockedItems: getUnlockedItems(), count: unlockedItems.size, exportedAt: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `bronzeman-${Date.now()}.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    log("Exported.");
}

export function resetData(): void {
    if (!confirm("Delete all unlocked items and calibration?")) return;
    unlockedItems.clear();
    localStorage.removeItem(LS_KEYS.unlockedItems);
    localStorage.removeItem(LS_KEYS.scanHistory);
    localStorage.setItem(LS_KEYS.unlockedItems, JSON.stringify([]));
    localStorage.setItem(LS_KEYS.scanHistory, JSON.stringify([]));
    Inventory.clearAnchor();
    Inventory.resetHashes();
    scanCount = 0;
    updateUI();
    updateDebugGrid(null);
    log("All reset.");
}

// ============================================================
// UI updates
// ============================================================

function updateAlt1Status(): void {
    const dot = document.getElementById("alt1_status_dot");
    const text = document.getElementById("alt1_status_text");
    if (!dot || !text) return;
    if (inAlt1) { dot.className = "status-dot green"; text.textContent = "Alt1 connected"; }
    else { dot.className = "status-dot red"; text.textContent = "Alt1 not detected"; }
}

function updateScanStatus(s: string): void {
    const el = document.getElementById("scan_status");
    if (el) el.textContent = s;
    const sc = document.getElementById("scan_count");
    if (sc) sc.textContent = String(scanCount);
    const ch = document.getElementById("change_count");
    if (ch && lastScanResult) ch.textContent = String(lastScanResult.changes);
}

function updateUI(): void {
    const count = unlockedItems.size;
    const ue = document.getElementById("unlocked_count");
    if (ue) ue.textContent = String(count);

    const rl = document.getElementById("recent_list");
    if (rl) {
        if (count === 0) {
            rl.innerHTML = '<div style="color:#555;text-align:center;padding:12px;">No items unlocked yet.</div>';
        } else {
            rl.innerHTML = getUnlockedItems().slice(-10).reverse()
                .map(item => `<div class="item-row unlocked"><span class="item-name">${escHtml(item)}</span><span class="item-badge unlocked">UNLOCKED</span></div>`)
                .join("");
        }
    }

    if (lastScanResult) {
        const ae = document.getElementById("anchor_info");
        if (ae) ae.textContent = `Anchor: (${lastScanResult.anchor.x}, ${lastScanResult.anchor.y}) via ${lastScanResult.anchor.method}`;
    }

    // Update anchor info
    const calBtn = document.getElementById("calibrate_btn");
    if (calBtn) {
        const anc = Inventory.loadAnchor();
        calBtn.textContent = anc ? `📷 Re-capture (${anc.colStride},${anc.rowStride})` : "📷 Capture";
    }
}

// Check if RS cursor is inside the inventory grid — likely dragging/UI interaction
function isCursorInInventory(result: Inventory.ScanResult): boolean {
    try {
        const pos = a1lib.getMousePosition();
        if (!pos) return false;
        const anc = result.anchor;
        const pad = anc.colStride; // generous padding around grid
        const left = anc.x - pad, top = anc.y - pad;
        const right = anc.x + 4 * anc.colStride + pad;
        const bottom = anc.y + 7 * anc.rowStride + pad;
        return pos.x >= left && pos.x <= right && pos.y >= top && pos.y <= bottom;
    } catch { return false; }
}

function updateDebugGrid(result: Inventory.ScanResult | null, discarded = false, pending: Set<number> = new Set()): void {
    const gridEl = document.getElementById("slot_grid");
    if (!gridEl) return;
    if (!result) { gridEl.innerHTML = '<div style="color:#555;text-align:center;padding:20px;">Waiting...</div>'; return; }

    let html = '<div class="mini-grid">';
    for (let row = 0; row < 7; row++) {
        html += '<div class="mini-grid-row">';
        for (let col = 0; col < 4; col++) {
            const slot = result.slots[row * 4 + col];
            let cls = "mini-slot";
            if (slot.changed) {
                if (pending.has(slot.index)) cls += " pending";
                else if (discarded) cls += " skipped";
                else cls += " changed";
            }
            const sh = slot.hash.slice(-4) || "----";
            html += `<div class="${cls}" title="Slot ${slot.index + 1} [r${row},c${col}]&#10;Hash: ${slot.hash}&#10;Diff: ${slot.diffScore} (thresh=24)">
                <span class="mini-slot-num">${slot.index + 1}</span>
                <span class="mini-slot-hash">${sh}</span></div>`;
        }
        html += "</div>";
    }
    html += "</div>";
    gridEl.innerHTML = html;

    updateUI();
}

function appendChangeEntry(slot: Inventory.SlotState, time: number): void {
    const list = document.getElementById("change_list");
    if (!list) return;
    const entry = document.createElement("div");
    entry.className = "change-entry";
    entry.innerHTML = `<span class="change-slot">#${slot.index + 1} [r${slot.row},c${slot.col}]</span>
        <span class="change-hash">${slot.hash.slice(0, 8)}</span>
        <span class="change-time">${new Date(time).toLocaleTimeString()}</span>`;
    list.prepend(entry);
    while (list.children.length > 20) list.lastChild?.remove();
}

// ============================================================
// Helpers
// ============================================================

function showOverlay(msg: string, color: number, dur: number): void {
    if (!inAlt1) return;
    alt1.overLayClearGroup("bronzeman");
    alt1.overLaySetGroup("bronzeman");
    alt1.overLayTextEx(msg, color, 16, Math.round(alt1.rsWidth / 2), 250, dur, "", true, true);
}

function escHtml(s: string): string { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

function log(msg: string): void {
    console.log("[Bronzeman]", msg);
    const el = document.getElementById("log");
    if (el) {
        const line = document.createElement("div");
        line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
        el.prepend(line);
        while (el.children.length > 50) el.lastChild?.remove();
    }
}

// ============================================================
// Bootstrap
// ============================================================

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initOnLoad);
} else {
    initOnLoad();
}
