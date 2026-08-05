// core.ts — utilities, constants, shared state for Bronzeman Mode
import { ImgRef, ImgRefBind } from "alt1/base";
import * as a1lib from "alt1";

// ============================================================
// Alt1 capture
// ============================================================

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

/** Read a single RGB pixel from the RS viewport, or null when unavailable. */
export function capturePixel(x: number, y: number): [number, number, number] | null {
    if (!ensureAlt1() || !alt1.permissionPixel) return null;
    const img = a1lib.capture(x, y, 1, 1);
    if (!img || !img.data || img.data.length < 3) return null;
    return [img.data[0], img.data[1], img.data[2]];
}

/** Compute HSL lightness from RGB. Returns 0-100. */
export function lightness(r: number, g: number, b: number): number {
    const max = Math.max(r, g, b) / 255, min = Math.min(r, g, b) / 255;
    return Math.round(((max + min) / 2) * 100);
}

function ensureAlt1(): boolean {
    return typeof alt1 !== "undefined";
}

// ============================================================
// Constants
// ============================================================

export const LS_KEYS = {
    recentUnlocksCount: "Bronzeman/recentUnlocksCount", // user setting: how many recent unlocks to show
    developerMode: "Bronzeman/developerMode", // user setting: show the Developer tab + console logs (default off)
    searchHideUntradable: "Bronzeman/searchHideUntradable", // search: hide untradable items (default off)
    searchGroupSimilar: "Bronzeman/searchGroupSimilar", // search: group similar items (default off)
} as const;

// ============================================================
// Shared state
// ============================================================

export const state = {
    inAlt1: false,
    calibrating: false,
    // Always-on: auto-capture starts enabled at boot (in-memory only, not
    // persisted). The Developer mode checkbox is the only off switch.
    autocapture: true,
};

/** GE search temporarily overrides "Group similar items" — typed results
 *  should never be grouped. Set when the GE auto-switches to Search tab,
 *  cleared when the GE closes. Read by isSearchGroupSimilar() in ui.ts. */
export const geSuppressGroup = { value: false };

// ============================================================
// Notifications
// ============================================================

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

// ============================================================
// Helpers
// ============================================================

export function escHtml(s: string): string {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
}

export function log(msg: string): void {
    // Console logging is a developer feature — only emit when Developer mode
    // is enabled (persisted alongside the tab visibility).
    if (localStorage.getItem(LS_KEYS.developerMode) !== "1") return;
    console.log("[Bronzeman]", msg);
}
