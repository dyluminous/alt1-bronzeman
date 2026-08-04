// ui.ts — DOM rendering and UI action handlers for Bronzeman Mode
import { inventory } from "./inventory";
import { InventorySlot } from "./inventory-slot";
import { state, escHtml, captureFullRs, LS_KEYS, log, showNotification, geSuppressGroup } from "./core";
import { resetUnlocks as dataResetUnlocks, getUnlockCount, getTradableUnlockCount, getSearchIndex } from "./data";
import { hashToPngDataUrl, getItemRecord } from "./data";
import type { UnlockedItemRecord } from "./data";
import { getRecentUnlocks, getRecentUnlocksLimit, clearRecentUnlocks, setRecentUnlocksLimit } from "./recent-unlocks";
import { showModal } from "./modal";
import { getObscuredSlotIndices } from "./slot-scan";
import { geIsOpen } from "./ge-debug";
import type { DisambiguationOption } from "./wiki";
import type { SearchEntry } from "./data";
import { BUILD_NUM } from "./version";

// ============================================================
// Developer tab visibility
// ============================================================

/** Whether the Developer tab + console logging are enabled (persisted; default off). */
export function isDeveloperMode(): boolean {
    return localStorage.getItem(LS_KEYS.developerMode) === "1";
}

/** Toggle Developer mode (tab visibility + console logging), persisting the choice. */
export function toggleDeveloperMode(): void {
    const visible = !isDeveloperMode();
    localStorage.setItem(LS_KEYS.developerMode, visible ? "1" : "0");
    applyDeveloperMode();
}

/** Sync the DOM + checkbox to the persisted Developer-mode state. */
export function applyDeveloperMode(): void {
    const visible = isDeveloperMode();
    const btn = document.getElementById("developer-tab-btn");
    if (btn) btn.style.display = visible ? "" : "none";
    const cb = document.getElementById("show_developer_tab") as HTMLInputElement | null;
    if (cb) cb.checked = visible;
    // If the Developer tab is the active one and it's being hidden, switch away.
    const panel = document.getElementById("panel_developer");
    if (!visible && panel && panel.classList.contains("active")) {
        const itemsBtn = document.querySelector('.tab-btn[onclick*="items"]');
        if (itemsBtn) (itemsBtn as HTMLElement).click();
    }
}

// ============================================================
// Search settings — persisted checkboxes (mirrors Developer mode)
// ============================================================

/** Whether "Hide untradable items" is enabled (persisted; default off). */
export function isSearchHideUntradable(): boolean {
    return localStorage.getItem(LS_KEYS.searchHideUntradable) === "1";
}

/** Toggle "Hide untradable items", persisting the choice. */
export function toggleSearchHideUntradable(): void {
    const on = !isSearchHideUntradable();
    localStorage.setItem(LS_KEYS.searchHideUntradable, on ? "1" : "0");
    applySearchSettings();
    updateSearchUnlockCount(true); // count scope changed — force a refresh
    rerenderSearchIfActive();
}

/** Whether "Group similar items" is enabled (persisted; default off). */
export function isSearchGroupSimilar(): boolean {
    // GE search overrides grouping temporarily — items typed in the GE
    // search box are never grouped regardless of the user's setting.
    return !geSuppressGroup.value && localStorage.getItem(LS_KEYS.searchGroupSimilar) === "1";
}

/** Toggle "Group similar items", persisting the choice. */
export function toggleSearchGroupSimilar(): void {
    const on = !isSearchGroupSimilar();
    localStorage.setItem(LS_KEYS.searchGroupSimilar, on ? "1" : "0");
    applySearchSettings();
    rerenderSearchIfActive();
}

/** Sync the search checkboxes to their persisted values (boot + toggles). */
export function applySearchSettings(): void {
    const hide = document.getElementById("search_hide_untradable") as HTMLInputElement | null;
    if (hide) hide.checked = isSearchHideUntradable();
    const group = document.getElementById("search_group_similar") as HTMLInputElement | null;
    if (group) group.checked = isSearchGroupSimilar();
}

// ============================================================
// Search tab — unlock count label
// ============================================================

let lastSearchUnlockCount = -1;

/** Set the search input placeholder to "Search N unlocks..." (memoized — the
 *  count query is async and updateUI() runs frequently). When "Hide untradable
 *  items" is on, N is the tradable unlock count only. */
function updateSearchUnlockCount(force = false): void {
    const input = document.getElementById("search_input") as HTMLInputElement | null;
    if (!input) return;
    const countQuery = isSearchHideUntradable() ? getTradableUnlockCount() : getUnlockCount();
    void countQuery.then((count) => {
        if (!force && count === lastSearchUnlockCount) return;
        lastSearchUnlockCount = count;
        input.placeholder = count === 1 ? "Search 1 unlock..." : `Search ${count} unlocks...`;
    });
}

// ============================================================
// Search — fuzzy name lookup against the in-memory index
// ============================================================

/** Strip trailing "(number)" tokens so "Brew (6)" and "Brew (5)" group
 *  together. Repeats until no more parenthised digits remain — handles
 *  names like "Tasset (worn) (6)" → "Tasset (worn)". */
function stripGroupName(name: string): string {
    while (true) {
        const m = name.match(/^(.*?) \(\d+\)$/);
        if (!m) return name;
        name = m[1];
    }
}

let searchTimer: ReturnType<typeof setTimeout> | null = null;

function renderSearchResults(query: string): void {
    const el = document.getElementById("search_results_inner");
    if (!el) return;

    if (query.length < 2) {
        el.innerHTML = "";
        return;
    }

    const lower = query.toLowerCase();
    const hideUntradable = isSearchHideUntradable();
    const groupSimilar = isSearchGroupSimilar();
    const index = getSearchIndex();

    const MAX_RESULTS = 100;

    let matches: SearchEntry[] = index.filter(r =>
        (hideUntradable ? r.tradeable : true) && r.name.toLowerCase().includes(lower),
    );

    if (matches.length === 0) {
        el.innerHTML = `<div class="search-results-empty">No results</div>`;
        return;
    }

    const total = matches.length;
    const hasMore = total > MAX_RESULTS;
    if (hasMore) matches = matches.slice(0, MAX_RESULTS);

    if (groupSimilar) {
        // Strip quantity suffixes, then deduplicate by the stripped name
        // while preserving the first canonical name encountered.
        const seen = new Set<string>();
        const grouped: string[] = [];
        for (const m of matches) {
            const stripped = stripGroupName(m.name);
            if (!seen.has(stripped)) {
                seen.add(stripped);
                grouped.push(stripped);
            }
        }
        let html = grouped.map(name =>
            `<div class="search-result-row" data-name="${escHtml(name)}">${escHtml(name)}</div>`,
        ).join("");
        if (hasMore) html += `<div class="search-results-empty">…and ${total - MAX_RESULTS} more - refine your search</div>`;
        el.innerHTML = html;
    } else {
        let html = matches.map(m =>
            `<div class="search-result-row" data-name="${escHtml(m.name)}">${escHtml(m.name)}</div>`,
        ).join("");
        if (hasMore) html += `<div class="search-results-empty">…and ${total - MAX_RESULTS} more - refine your search</div>`;
        el.innerHTML = html;
    }
}

/** Re-render search results if there's an active query, so toggling
 *  "Hide untradable" or "Group similar" updates the list immediately. */
function rerenderSearchIfActive(): void {
    const input = document.getElementById("search_input") as HTMLInputElement | null;
    if (input && input.value.trim().length > 0) {
        renderSearchResults(input.value.trim());
    }
}

/** Attach the debounced input handler to the search text box. Safe to call
 *  multiple times — the old listener is discarded. */
function showSearchClearButton(): void {
    const clear = document.getElementById("search_clear_btn");
    const input = document.getElementById("search_input") as HTMLInputElement | null;
    if (clear && input) {
        clear.style.display = input.value.length > 0 ? "block" : "none";
    }
}

export function setupSearchHandler(): void {
    const input = document.getElementById("search_input") as HTMLInputElement | null;
    if (!input) return;
    const handler = (): void => {
        showSearchClearButton();
        if (searchTimer) clearTimeout(searchTimer);
        searchTimer = setTimeout(() => renderSearchResults(input.value.trim()), 150);
    };
    // Remove previous listener and re-add (idempotent).
    input.removeEventListener("input", handler);
    input.addEventListener("input", handler);
    // Also clear results when the input is fully cleared.
    input.addEventListener("blur", () => {
        if (input.value.trim().length === 0) renderSearchResults("");
    });
}

export function updateAlt1Status(): void {
    const dot = document.getElementById("alt1_status_dot");
    const text = document.getElementById("alt1_status_text");
    if (!dot || !text) return;
    if (state.inAlt1) {
        dot.className = "status-dot green";
        text.textContent = `Build #${BUILD_NUM}`;
    } else {
        dot.className = "status-dot red";
        text.textContent = `Build #${BUILD_NUM} (no alt1)`;
    }
}

// ============================================================
// Anchor dot + warning
// ============================================================

/** Re-render the gold/magenta anchor status dot (called from updateUI and the
 *  GE state hook — GE open flips it to magenta). */
export function updateAnchorDot(): void {
    const el = document.getElementById("anchor_dot");
    if (!el) return;
    // GE open → magenta (inventory is hidden behind the GE interface);
    // anchor set → gold; otherwise hidden.
    if (geIsOpen()) {
        el.className = "anchor-dot magenta";
        return;
    }
    const anc = inventory.anchor;
    el.className = anc ? "anchor-dot" : "anchor-dot hidden";
}

// ============================================================
// Main UI render
// ============================================================

export function updateUI(): void {
    renderRecentUnlocks();
    updateSearchUnlockCount();

    // Reflect the configured count in the tab title. At 0 the whole section
    // is hidden — no point showing "Last 0 items unlocked" with a dead pane.
    const titleEl = document.getElementById("recent_unlocks_title");
    const gridEl = document.getElementById("recent_unlocks_grid");
    const n = getRecentUnlocksLimit();
    if (titleEl) titleEl.style.display = n === 0 ? "none" : "";
    if (gridEl) gridEl.style.display = n === 0 ? "none" : "";
    if (titleEl) titleEl.textContent = n === 1 ? "Last 1 item unlocked" : `Last ${n} items unlocked`;

    // Reflect the auto-capture toggle in the Developer-mode checkbox.
    const autoCaptureCb = document.getElementById("auto_capture") as HTMLInputElement | null;
    if (autoCaptureCb) autoCaptureCb.checked = state.autocapture;

    updateAnchorDot();
}

// ============================================================

function showInlinePanel(contentId: string, inlineId: string): void {
    const content = document.getElementById(contentId);
    const inline = document.getElementById(inlineId);
    if (content) content.style.display = "none";
    if (inline) inline.style.display = "flex";
}

function hideInlinePanel(contentId: string, inlineId: string): void {
    const content = document.getElementById(contentId);
    const inline = document.getElementById(inlineId);
    if (content) content.style.display = "";
    if (inline) inline.style.display = "none";
}

export { showInlinePanel, hideInlinePanel };

// ============================================================
// Slot hash debug pane
// ============================================================

let slotDebugTimer: ReturnType<typeof setInterval> | null = null;
/** Whether the pane shows the occlusion gate (blocked cells) or the last-valid pixels. */
let showOccludedSlots = true;

export function openSlotDebug(): void {
    showInlinePanel("developer_content", "slot_debug_inline");
    const cb = document.getElementById("slot_debug_show_occluded") as HTMLInputElement | null;
    if (cb) showOccludedSlots = cb.checked;
    renderSlotDebug();
    if (!slotDebugTimer) {
        // Keep the pane in sync with the slot-scan hashes as they update.
        slotDebugTimer = setInterval(renderSlotDebug, 500);
    }
}

export function closeSlotDebug(): void {
    if (slotDebugTimer) { clearInterval(slotDebugTimer); slotDebugTimer = null; }
    hideInlinePanel("developer_content", "slot_debug_inline");
}

/** Re-render immediately after the checkbox toggles (called from HTML onchange). */
export function refreshSlotDebug(): void {
    const cb = document.getElementById("slot_debug_show_occluded") as HTMLInputElement | null;
    if (cb) showOccludedSlots = cb.checked;
    renderSlotDebug();
}

function renderSlotDebug(): void {
    const grid = document.getElementById("slot_debug_grid");
    if (!grid) return;
    const slots = inventory.slots;
    if (slots.length === 0) {
        grid.innerHTML = '<div class="slot-debug-note">Inventory not calibrated.</div>';
        return;
    }
    // Capture once, then draw every slot's interior from the same buffer.
    const img = captureFullRs();
    // Slots covered by tooltips/menus or under/adjacent to the cursor are
    // obscured — don't render their (possibly occluded) pixels in the pane.
    const obscured = img ? getObscuredSlotIndices(img) : new Set<number>();
    // Preserve the grid orientation (columns from calibration).
    grid.style.gridTemplateColumns = `repeat(${inventory.cols}, minmax(64px, auto))`;
    grid.innerHTML = slots.map(slot => {
        const h = slot.previousHash;
        // Noted items are skipped by the scan (previousHash stays null) but are
        // NOT empty — give them their own border colour.
        const noted = !!img && slot.isNoted(img);
        const inuse = !!img && slot.isInUseState(img);
        const empty = !noted && !inuse && (h === null || h === "empty");
        const blocked = obscured.has(slot.index) && showOccludedSlots;
        const cls = [
            "slot-debug-cell",
            noted ? " noted" : "",
            inuse ? " inuse" : "",
            empty ? " empty" : "",
            blocked ? " blocked" : "",
            slot.isStackable ? " stackable" : "",
        ].join("");
        return `<div class="${cls}" title="${escHtml(h ?? "")}">
            <canvas class="slot-debug-canvas" width="36" height="32"></canvas>
            <div class="idx">#${slot.index}</div>
        </div>`;
    }).join("");

    if (!img) return;
    slots.forEach((slot, i) => {
        const canvas = grid.children[i]?.querySelector("canvas");
        const ctx = canvas?.getContext("2d");
        if (!canvas || !ctx) return;
        if (obscured.has(slot.index)) {
            // Occluded slot: show the occlusion gate (blank + red) or the last
            // cleanly-scanned pixels, depending on the toggle.
            if (!showOccludedSlots && slot.lastValidPixels) {
                const imgData = new ImageData(new Uint8ClampedArray(slot.lastValidPixels), InventorySlot.INTERIOR_W, InventorySlot.INTERIOR_H);
                ctx.putImageData(imgData, 0, 0);
            }
            return;
        }
        // Interior of the slot cell: 36×32, skipping the 1px border.
        const d = img.toData(slot.interiorX, slot.interiorY, InventorySlot.INTERIOR_W, InventorySlot.INTERIOR_H);
        if (d) ctx.putImageData(d, 0, 0);
    });
}

export function resetUnlocks(): void {
    showModal("You're about to permanently delete ALL your unlocked items. Are you sure?", "DANGER", () => {
        dataResetUnlocks();
        clearRecentUnlocks();
        updateUI();
        rerenderSearchIfActive();
    });
}

// ============================================================
// Wiki disambiguation pane — "the wiki returns multiple results"
// ============================================================

let disambigOptions: DisambiguationOption[] = [];
let disambigOnSelect: ((name: string) => void) | null = null;
let disambigOnClose: (() => void) | null = null;

/** Open the pane with the wiki's disambiguation options. */
export function showDisambiguation(options: DisambiguationOption[], onSelect: (name: string) => void, onClose?: () => void): void {
    disambigOptions = options;
    disambigOnSelect = onSelect;
    disambigOnClose = onClose ?? null;
    const pane = document.getElementById("wiki_disambig_pane");
    const body = document.getElementById("wiki_disambig_body");
    if (!pane || !body) return;
    body.innerHTML =
        '<div class="wiki-disambig-msg">The wiki returns multiple results for this item. Select the one that matches.</div>' +
        options.map((o, i) =>
            `<div class="wiki-disambig-row" onclick="Bronzeman.selectDisambiguationOption(${i})">` +
            `<span class="wiki-disambig-name">${escHtml(o.name)}</span>` +
            (o.description ? `<span class="wiki-disambig-desc">${escHtml(o.description)}</span>` : "") +
            `</div>`
        ).join("");
    pane.style.display = "flex";
}

/** Called from the HTML rows — continue the pipeline with the picked name. */
export function selectDisambiguationOption(index: number): void {
    const opt = disambigOptions[index];
    const cb = disambigOnSelect;
    disambigOnClose = null; // a selection is not an abandon
    closeDisambiguation();
    if (opt && cb) cb(opt.name);
}

/** Close the pane without picking (✕ or click outside) — fires the abandon hook. */
export function closeDisambiguation(): void {
    disambigOptions = [];
    disambigOnSelect = null;
    const oc = disambigOnClose;
    disambigOnClose = null;
    const pane = document.getElementById("wiki_disambig_pane");
    if (pane) pane.style.display = "none";
    oc?.();
}

// ============================================================
// Item hash PNGs pane — debug: show each recorded hash as an image
// ============================================================

/** Open the item-hash PNG pane showing every slot's current interior hash
 *  (empty/unscanned slots render as a blank tile; identical hashes get a green
 *  border). */
export function openItemPngs(): void {
    const body = document.getElementById("item_pngs_body");
    if (!body) return;
    renderInventoryPngs(body);
    showInlinePanel("developer_content", "item_pngs_inline");
}

/** Fill the pane with every slot's current interior hash. */
function renderInventoryPngs(body: HTMLElement): void {
    if (inventory.slots.length === 0) {
        body.innerHTML = '<div class="wiki-disambig-note">Inventory not calibrated.</div>';
        return;
    }
    // Count hash occurrences — a hash seen on 2+ slots gets flagged.
    const counts = new Map<string, number>();
    for (const s of inventory.slots) {
        if (s.previousHash && s.previousHash !== "empty") {
            counts.set(s.previousHash, (counts.get(s.previousHash) ?? 0) + 1);
        }
    }
    const GREEN = "#1CE401";
    body.innerHTML =
        `<div class="wiki-disambig-msg">${inventory.slots.length} slot(s). Green border = identical hash on multiple slots.</div>` +
        `<div style="display:flex;flex-wrap:wrap;gap:8px;">` +
        inventory.slots.map(s => {
            const h = s.previousHash;
            const hasHash = !!h && h !== "empty";
            if (!hasHash) {
                // Empty / not-yet-scanned / noted slot — blank placeholder.
                return `<div style="text-align:center;border:1px solid #444;padding:2px;background:#1a1a1a;">` +
                    `<div style="width:80px;height:80px;display:block;"></div>` +
                    `<div class="wiki-disambig-note">#${s.index} —</div>` +
                    `</div>`;
            }
            const dup = (counts.get(h) ?? 0) > 1;
            const url = hashToPngDataUrl(h, 10);
            const border = dup ? `2px solid ${GREEN}` : "1px solid #888";
            return `<div style="text-align:center;border:${border};padding:2px;">` +
                `<img src="${url}" title="${escHtml(h)}" style="image-rendering:pixelated;width:80px;height:80px;display:block;">` +
                `<div class="wiki-disambig-note">#${s.index}${dup ? " ⚠ dup" : ""}</div>` +
                `</div>`;
        }).join("") + `</div>`;
}

/** Close the item hash PNGs pane. */
export function closeItemPngs(): void {
    hideInlinePanel("developer_content", "item_pngs_inline");
}

// ============================================================
// DB Item Hash pane — debug: search a store entry and render its
// recorded hashes as PNGs (supports multiple hashes per record)
// ============================================================

/** Open the DB item-hash pane. */
export function openDbItemPngs(): void {
    const body = document.getElementById("db_item_pngs_body");
    if (!body) return;
    body.innerHTML = '<div class="wiki-disambig-note">Type an item name and press Search.</div>';
    showInlinePanel("developer_content", "db_item_pngs_inline");
}

/** Close the DB item-hash pane. */
export function closeDbItemPngs(): void {
    hideInlinePanel("developer_content", "db_item_pngs_inline");
}

/** Look up the typed name in both unlock stores and render its hash PNGs. */
export async function searchDbItemHash(): Promise<void> {
    const input = document.getElementById("db_item_hash_input") as HTMLInputElement | null;
    const body = document.getElementById("db_item_pngs_body");
    if (!input || !body) return;
    const name = input.value.trim();
    if (!name) { body.innerHTML = '<div class="wiki-disambig-note">Type an item name first.</div>'; return; }

    body.innerHTML = '<div class="wiki-disambig-note">Searching…</div>';
    const recs: { store: string; label: string; rec: UnlockedItemRecord }[] = [];
    // Short store names — getItemRecord maps them via storeName() internally.
    // Passing the raw store names ("unlocks_untradable") would fall through to
    // the tradable store (storeName defaults to STORE_TRADABLE).
    for (const [store, label] of [["tradable", "tradable"], ["untradable", "untradable"]] as const) {
        const rec = await getItemRecord(store, name);
        if (rec) recs.push({ store, label, rec });
    }

    if (recs.length === 0) {
        body.innerHTML = `<div class="wiki-disambig-note">No record found for "${escHtml(name)}".</div>`;
        return;
    }

    body.innerHTML = recs.map(({ label, rec }) => {
        const tiles = rec.hashes.map((h, i) => {
            const qty = h.stackableQuantity;
            const qtyLabel = qty != null && qty > 1 ? ` [${qty}]` : "";
            const url = hashToPngDataUrl(h.hash, 10);
            return `<div style="text-align:center;border:1px solid #888;padding:2px;">` +
                `<img src="${url}" title="${escHtml(h.hash)}" style="image-rendering:pixelated;width:80px;height:80px;display:block;">` +
                `<div class="wiki-disambig-note">#${i + 1}${qtyLabel}</div>` +
                `</div>`;
        }).join("");
        return `<div style="margin-bottom:10px;">` +
            `<div class="wiki-disambig-msg">${escHtml(rec.name)} — ${label} (${rec.hashes.length} hash${rec.hashes.length === 1 ? "" : "es"})</div>` +
            `<div style="display:flex;flex-wrap:wrap;gap:8px;">${tiles}</div>` +
            `</div>`;
    }).join("");
}

// ============================================================
// Recent unlocks grid — last N items unlocked
// ============================================================

let lastRecentUnlocksSig = "";

function renderRecentUnlocks(): void {
    const grid = document.getElementById("recent_unlocks_grid");
    if (!grid) return;
    const recent = getRecentUnlocks();

    // Memoize: skip the DOM write entirely when nothing changed. updateUI()
    // is called frequently (e.g. 1s grid search while the inventory is
    // missing); rebuilding <img> tags every call forces re-decodes and
    // flicker even though the data is identical.
    const sig = recent.map(e => `${e.displayLabel}|${e.imageUrl}`).join("\n");
    if (sig === lastRecentUnlocksSig) return;
    lastRecentUnlocksSig = sig;

    if (recent.length === 0) {
        grid.innerHTML = "";
        return;
    }
    grid.innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:4px;align-items:flex-start;">` +
        recent.map(entry => {
            const img = entry.imageUrl
                ? `<img src="${escHtml(entry.imageUrl)}" style="max-width:36px;max-height:32px;image-rendering:pixelated;display:block;" alt="">`
                : ``;
            return `<div class="recent-unlock-cell" data-name="${escHtml(entry.displayLabel)}">
                ${img}
            </div>`;
        }).join("") + `</div>`;

    // Hover: gold glow + mouse-following name tooltip.
    const cells = Array.from(grid.querySelectorAll<HTMLElement>(".recent-unlock-cell"));
    for (const cell of cells) {
        cell.addEventListener("mouseenter", () => showRecentUnlockTooltip(cell.dataset.name ?? ""));
        cell.addEventListener("mouseleave", hideRecentUnlockTooltip);
    }
}

let tooltipEl: HTMLElement | null = null;
let tooltipText = "";

function showRecentUnlockTooltip(name: string): void {
    if (!tooltipEl) tooltipEl = document.getElementById("recent_unlock_tooltip");
    if (!tooltipEl) return;
    tooltipText = name;
    tooltipEl.textContent = name;
    tooltipEl.classList.add("recent-unlock-tooltip");
    tooltipEl.style.display = "block";
    document.addEventListener("mousemove", moveRecentUnlockTooltip);
    moveRecentUnlockTooltip({ clientX: 0, clientY: 0 } as MouseEvent); // position at cursor on next move
}

function hideRecentUnlockTooltip(): void {
    if (tooltipEl) tooltipEl.style.display = "none";
    document.removeEventListener("mousemove", moveRecentUnlockTooltip);
}

function moveRecentUnlockTooltip(e: MouseEvent): void {
    if (!tooltipEl || tooltipEl.style.display === "none") return;
    const pad = 10;
    const w = tooltipEl.offsetWidth;
    const h = tooltipEl.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Prefer right/below the cursor; flip left or above when it would overflow.
    let left = e.clientX + pad;
    let top = e.clientY + pad;
    if (left + w > vw - pad) left = e.clientX - w - pad + 9;
    if (top + h > vh - pad) top = e.clientY - h - pad;
    tooltipEl.style.left = `${Math.max(pad, left)}px`;
    tooltipEl.style.top = `${Math.max(pad, top)}px`;
}

// ============================================================
// Spinner helpers — called from HTML onclick
// ============================================================

// @ts-ignore — called from HTML onchange
export function setRecentUnlocksCount(value: string | number): void {
    setRecentUnlocksLimit(Number(value));
}

/** Step the recent-unlocks spinner by ±1 from its current value. */
// @ts-ignore — called from HTML onclick
export function stepRecentUnlocksCount(delta: number): void {
    const input = document.getElementById("recent_unlocks_count") as HTMLInputElement | null;
    const current = Number(input?.value ?? getRecentUnlocksLimit());
    const next = Math.min(28, Math.max(0, current + delta));
    setRecentUnlocksCount(next);
    if (input) input.value = String(next);
}

/** Step the manual-unlock slot spinner by ±1 from its current value. */
// @ts-ignore — called from HTML onclick
export function stepManualUnlockSlot(delta: number): void {
    stepSpinner("manual_unlock_slot_input", delta, 1, 28);
}

function stepSpinner(inputId: string, delta: number, min: number, max: number): void {
    const input = document.getElementById(inputId) as HTMLInputElement | null;
    const current = Number(input?.value ?? min);
    const next = Math.min(max, Math.max(min, current + delta));
    if (input) input.value = String(next);
}
