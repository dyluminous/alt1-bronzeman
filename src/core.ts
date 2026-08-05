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
    unlockedItemData: LS_PREFIX + "unlockedItemData",
    scanHistory: LS_PREFIX + "scanHistory",
    ignores: LS_PREFIX + "ignores",
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
    calibrating: false,
    debugLogIgnores: false,
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


export interface NotificationHandle {
    update(msg: string): void;
    remove(): void;
}

const MAX_NOTIFICATIONS = 3;

function makeNotifEl(msg: string, style: "info" | "success" | "warning" | "danger" = "info"): HTMLDivElement {
    const el = document.createElement("div");
    el.textContent = msg;
    el.className = "notif-item notif-item-enter notif-" + style;
    return el;
}

function fadeRemove(el: HTMLElement): void {
    el.classList.add("notif-item-exit");
    setTimeout(() => {
        if (el.parentNode) el.parentNode.removeChild(el);
    }, 300);
}

export function showNotification(msg: string, duration: number = 2000, style: "info" | "success" | "warning" | "danger" = "info"): NotificationHandle | null {
    const c = document.getElementById("notification_container");
    if (!c) return null;

    while (c.children.length >= MAX_NOTIFICATIONS) {
        const old = c.firstElementChild as HTMLElement | null;
        if (old && old.parentNode) old.parentNode.removeChild(old);
    }

    const el = makeNotifEl(msg, style);
    c.appendChild(el);
    requestAnimationFrame(() => {
        el.classList.remove("notif-item-enter");
    });

    let timer: ReturnType<typeof setTimeout> | null = null;
    if (duration > 0) {
        timer = setTimeout(() => {
            if (el.parentNode) fadeRemove(el);
        }, duration);
    }

    return {
        update(newMsg: string): void {
            if (el.parentNode) el.textContent = newMsg;
        },
        remove(): void {
            if (timer !== null) clearTimeout(timer);
            if (el.parentNode) fadeRemove(el);
        }
    };
}

let anchorWarningHandle: NotificationHandle | null = null;

/** Show/hide a persistent danger notification when no anchor is set. */
export function updateAnchorWarning(): void {
    try {
        if (Inventory.loadAnchor()) {
            if (anchorWarningHandle) { anchorWarningHandle.remove(); anchorWarningHandle = null; }
        } else {
            if (!anchorWarningHandle) {
                anchorWarningHandle = showNotification("Inventory not captured", 0, "danger");
            }
        }
    } catch (e) {
        if (!anchorWarningHandle) {
            anchorWarningHandle = showNotification("Inventory not captured", 0, "danger");
        }
    }
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

// ============================================================
// Slot status overlays toggle (off by default)
// ============================================================

export let showSlotOverlays = false;

export function setShowSlotOverlays(v: boolean): void {
    showSlotOverlays = v;
    if (!v && typeof alt1 !== "undefined") {
        alt1.overLayClearGroup("bronzeman_slots");
    }
}
