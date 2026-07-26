// core.ts — utilities, constants, shared state for Bronzeman Mode
import * as a1lib from "alt1";
import { ImgRef, ImgRefBind } from "alt1/base";
import * as Inventory from "./inventory";

// ============================================================
// Alt1 workarounds
// ============================================================

export function ensureAlt1(): boolean {
    return typeof alt1 !== "undefined";
}

export function captureFullRs(): ImgRef | null {
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

export const LS_PREFIX = "Bronzeman/";
export const LS_KEYS = {
    unlockedItems: LS_PREFIX + "unlockedItems",
    scanHistory: LS_PREFIX + "scanHistory",
} as const;

export const POLL_INTERVAL_MS = 1000;

// ============================================================
// Shared state (mutable object, reassignable by importers)
// ============================================================

export const state = {
    inAlt1: false,
    polling: false,
    pollTimer: null as ReturnType<typeof setInterval> | null,
    scanCount: 0,
    lastScanResult: null as Inventory.ScanResult | null,
    // Which slots had items on the previous scan (by slot index)
    prevOccupied: new Set<number>(),
    // After interface detected, suppress pickups on the next scan transition
    afterInterface: false,
};

// ============================================================
// Helpers
// ============================================================

export function showOverlay(msg: string, color: number, dur: number): void {
    if (!state.inAlt1) return;
    alt1.overLayClearGroup("bronzeman");
    alt1.overLaySetGroup("bronzeman");
    alt1.overLayTextEx(msg, color, 16, Math.round(alt1.rsWidth / 2), 250, dur, "", true, true);
}

export function escHtml(s: string): string {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
}

export function log(msg: string): void {
    console.log("[Bronzeman]", msg);
    const el = document.getElementById("log");
    if (el) {
        const line = document.createElement("div");
        line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
        el.prepend(line);
        while (el.children.length > 50) el.lastChild?.remove();
    }
}
