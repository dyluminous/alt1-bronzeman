// core.ts — utilities, constants, shared state for Bronzeman Mode
import { ImgRef, ImgRefBind } from "alt1/base";

// ============================================================
// Alt1 capture
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
    ignores: LS_PREFIX + "ignores",
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
// Capture retry flag — suppresses anchor warning during retry loop
// ============================================================

let _isSearchingGrid = false;
export function setSearchingGrid(v: boolean): void { _isSearchingGrid = v; }

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
