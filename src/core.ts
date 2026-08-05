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
    unlockedHashes: "Bronzeman/unlockedHashes", // legacy — migrated to IndexedDB on first boot
    recentUnlocksCount: "Bronzeman/recentUnlocksCount", // user setting: how many recent unlocks to show
} as const;

// ============================================================
// Shared state
// ============================================================

export const state = {
    inAlt1: false,
    calibrating: false,
    autocapture: false,
};

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
    console.log("[Bronzeman]", msg);
    const el = document.getElementById("log");
    if (el) {
        const line = document.createElement("div");
        line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
        el.prepend(line);
        while (el.children.length > 50) el.lastChild?.remove();
    }
}
