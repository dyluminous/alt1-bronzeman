// ge-detection.ts — GE interface detection (always-on production for unlock icon;
// magenta/yellow debug boxes gated behind "GE debugging" checkbox)
import * as a1lib from "alt1";
import { findSubimage, imageDataFromUrl, ImgRefBind } from "alt1/base";
import type { ImgRef } from "alt1/base";
import * as OCR from "alt1/ocr";
const tooltipFont = require("alt1/fonts/chatbox/14pt");
const geSearchFont = require("alt1/fonts/chatbox/12pt");
import { log, captureFullRs, geSuppressGroup } from "../../core";
import { isNameUnlocked } from "../unlock/unlock-store";
import geItemUnlockedUrl from "../../assets/images/ge_item_unlocked_button.png";
import geItemNotUnlockedUrl from "../../assets/images/ge_item_not_unlocked_button.png";
import needleUrl from "../../assets/images/ge_identifier.png";

// ----------------------------------------------------------------
// Toggle — always-on detection; debug overlays gated separately
// ----------------------------------------------------------------

let _handle: ReturnType<typeof setInterval> | null = null;
let _needle: ImageData | null = null;

/** Whether magenta GE box + yellow search box are drawn. */
let geDebugOverlays = false;

export function initGeDetection(): void {
    if (_handle) return;
    void preloadGeIcons().then(() => {
        _handle = setInterval(geDebugTick, 100);
    });
}

export function stopGeDetection(): void {
    if (_handle) { clearInterval(_handle); _handle = null; }
    if (_geLocated) {
        _geLocated = false;
        _geStateHook?.();
    }
    _lastBuying = _lastStar = _lastDropdownSmall = false;
    _lastItemName = "";
    _lastCursorX = -1;
    _lastOcrW = -1;
    try {
        alt1.overLayClearGroup("bronzeman_ge");
        alt1.overLayClearGroup("bronzeman_subimg");
        alt1.overLayClearGroup("bronzeman_searchbox");
    } catch (_) {}
}

/** Whether the GE interface is currently detected as open. */
export function geIsOpen(): boolean {
    return _geLocated;
}

/** Called whenever the GE open/closed state transitions — lets the UI
 *  (status dot) react without creating an import cycle. */
let _geStateHook: (() => void) | null = null;
export function setGeStateHook(hook: (() => void) | null): void {
    _geStateHook = hook;
}

export function toggleGeDebugOverlays(): void {
    geDebugOverlays = !geDebugOverlays;
    if (!geDebugOverlays) {
        try {
            alt1.overLayClearGroup("bronzeman_subimg");
            alt1.overLayClearGroup("bronzeman_searchbox");
        } catch (_) {}
    }
}

// ----------------------------------------------------------------
// Lazy-loaded images
// ----------------------------------------------------------------

let _encUnlocked: { data: string; width: number } | null = null;
let _encNotUnlocked: { data: string; width: number } | null = null;

async function getNeedle(): Promise<ImageData> {
    if (!_needle) _needle = await imageDataFromUrl(needleUrl);
    return _needle;
}

async function loadGeButtonEncoded(url: string): Promise<{ data: string; width: number }> {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement("canvas");
            canvas.width = img.width; canvas.height = img.height;
            const ctx = canvas.getContext("2d")!;
            ctx.drawImage(img, 0, 0);
            resolve({
                data: a1lib.encodeImageString(ctx.getImageData(0, 0, img.width, img.height)),
                width: img.width,
            });
        };
        img.src = url;
    });
}

// ----------------------------------------------------------------
// Capture helpers
// ----------------------------------------------------------------

function captureGeRegion(bx: number, by: number): ImgRef | null {
    try {
        const handle = alt1.bindRegion(bx, by, 768, 572);
        if (handle <= 0) return null;
        return new ImgRefBind(handle, bx, by, 768, 572);
    } catch { return null; }
}

// ----------------------------------------------------------------
// ----------------------------------------------------------------
// Tick — independent interval. Two modes:
//   Hunt: full capture → findSubimage → cache GE position
//   Locked: region capture → pixel checks + icon
// GE-lost is detected via pixel (35,31) which is always this color
// while the GE interface is open, regardless of buy state.
//
// State-diffing: pixel values are compared against the last known
// state each tick. Downstream work (OCR, icon draw) only fires
// when the relevant state changes — not on every tick.
// ----------------------------------------------------------------

// ----------------------------------------------------------------
// Named constants — GE pixel references relative to (_bx, _by)
// ----------------------------------------------------------------

const GE_SCALES_GEM_IDENTIFIER = [0x85, 0x57, 0xc4] as const; // (35,31) — always present while GE open
const BUY_OFFER_COLOR  = [0xb3, 0xc6, 0x03] as const;          // (36,128) — #b3c603 buy-offer tab active
const STAR_GREY        = [0x7b, 0x7b, 0x7b] as const;          // (531,130) — unfavorited star
const STAR_GOLD        = [0xd4, 0xae, 0x6d] as const;          // (531,130) — favorited star
const LOADING_DOT      = [0xb3, 0xa9, 0xa3] as const;          // (229,147) — first dot of "Loading…"
const ITEM_NAME_OCR: OCR.ColortTriplet[] = [[0xf0, 0xbe, 0x79]]; // #f0be79 — item name text
const DROPDOWN_SMALL   = [0xe3, 0xbc, 0x7d] as const;          // (42,327) — small dropdown indicator
const SEARCH_BG        = [0x1b, 0x1d, 0x1d] as const;          // (52/53,225) — search box background
const SEARCH_TEXT_OCR: OCR.ColortTriplet[] = [[0xff, 0xff, 0xff]]; // #ffffff — search box text
const CURSOR_WHITE     = [0xff, 0xff, 0xff] as const;          // typing cursor
const CURSOR_RED       = [0xff, 0x00, 0x00] as const;          // typing cursor (character limit)
const DEBUG_MAGENTA    = [255, 0, 255] as const;               // debug overlay box
const DEBUG_YELLOW     = [255, 255, 0] as const;               // debug search box

let _bx = 0, _by = 0;
let _geLocated = false;
let _lastBuying = false;
let _lastStar = false;
let _lastDropdownSmall = false;
let _lastItemName = "";

let _lastCursorX = -1;   // for OCR gating — only OCR when cursor moves
let _lastOcrW = -1;      // skip OCR when box width hasn't changed
let _geSearchText = "";   // last OCR'd search text, cleared when text disappears
let _tabBeforeSearch = ""; // tab to restore when GE closes

let _lastHuntAt = 0;
/** Hunt phase does a full-screen capture; that's expensive, so it only runs
 *  once per second. Once the GE is located the tick runs at full 100ms rate
 *  on the cheap region capture. */
const HUNT_INTERVAL_MS = 1000;

async function geDebugTick(): Promise<void> {
    try {
        let img: ImgRef | null;

        if (!_geLocated) {
            // Hunt: full capture — throttled to once per second
            const now = Date.now();
            if (now - _lastHuntAt < HUNT_INTERVAL_MS) return;
            _lastHuntAt = now;
            img = captureFullRs();
            if (!img) return;
            const needle = await getNeedle();
            const matches = img.findSubimage(needle);
            if (matches.length === 0) {
                alt1.overLayClearGroup("bronzeman_ge");
                alt1.overLayClearGroup("bronzeman_subimg");
                return;
            }
            _bx = matches[0].x - 26;
            _by = matches[0].y - 26;
            _geLocated = true;
            _geStateHook?.();
            _lastBuying = _lastStar = _lastDropdownSmall = false;
            _lastItemName = "";
        } else {
            // Locked: region-only capture
            img = captureGeRegion(_bx, _by);
            if (!img) return;
        }

        const dur = 200;
        const ox = img.width === 768 ? 0 : _bx;
        const oy = img.height === 572 ? 0 : _by;

        // GE still open?
        const cp = img.read(ox + 35, oy + 31, 1, 1);
        if (!cp || cp.data[0] !== GE_SCALES_GEM_IDENTIFIER[0] || cp.data[1] !== GE_SCALES_GEM_IDENTIFIER[1] || cp.data[2] !== GE_SCALES_GEM_IDENTIFIER[2]) {
            _geLocated = false;
            _geStateHook?.();
            geSuppressGroup.value = false;
            _lastBuying = _lastStar = _lastDropdownSmall = false;
            _lastItemName = "";
            _lastCursorX = -1;
            _lastOcrW = -1;
            alt1.overLayClearGroup("bronzeman_ge");
            alt1.overLayClearGroup("bronzeman_subimg");
            alt1.overLayClearGroup("bronzeman_searchbox");
            // Restore the tab we were on before auto-switching to Search
            if (_tabBeforeSearch) {
                const tab = document.querySelector(`.tab-btn[onclick="${_tabBeforeSearch}"]`) as HTMLElement | null;
                if (tab) tab.click();
                _tabBeforeSearch = "";
            }
            return;
        }

        // —————— magenta box (debug overlay) ——————
        if (geDebugOverlays) {
            alt1.overLaySetGroup("bronzeman_subimg");
            alt1.overLayClearGroup("bronzeman_subimg");
            alt1.overLayRect(a1lib.mixColor(DEBUG_MAGENTA[0], DEBUG_MAGENTA[1], DEBUG_MAGENTA[2]), _bx, _by, 768, 572, dur, 1);
        }

        // —————— buy-offer pixel ——————
        const px = img.read(ox + 36, oy + 128, 1, 1);
        const buying = !!(px && px.data[0] === BUY_OFFER_COLOR[0] && px.data[1] === BUY_OFFER_COLOR[1] && px.data[2] === BUY_OFFER_COLOR[2]);
        if (buying !== _lastBuying) {
            _lastBuying = buying;
            if (!buying) {
                _lastStar = false;
                _lastItemName = "";
                _lastDropdownSmall = false;
                _lastCursorX = -1;
                alt1.overLayClearGroup("bronzeman_ge");
                return;
            }
        }
        if (!buying) return;

        // —————— star pixel ——————
        const fav = img.read(ox + 531, oy + 130, 1, 1);
        let star = false;
        if (fav) {
            const fr = fav.data[0], fg = fav.data[1], fb = fav.data[2];
            star = (fr === STAR_GREY[0] && fg === STAR_GREY[1] && fb === STAR_GREY[2]) || (fr === STAR_GOLD[0] && fg === STAR_GOLD[1] && fb === STAR_GOLD[2]);
        }
        if (star !== _lastStar) {
            _lastStar = star;
            if (!star) {
                _lastItemName = "";
                alt1.overLayClearGroup("bronzeman_ge");
            }
        }

        // —————— OCR item name ——————
        // Pixel at (229,147) is #B3A9A3 — the first dot of the "Loading…"
        // ellipsis. OCR while this pixel is present. If the star appears
        // without the loading pixel, OCR once immediately.
        if (star) {
            if (geDebugOverlays) {
                alt1.overLaySetGroup("bronzeman_subimg");
                alt1.overLayRect(a1lib.mixColor(DEBUG_MAGENTA[0], DEBUG_MAGENTA[1], DEBUG_MAGENTA[2]), _bx + 182, _by + 120, 340, 17, dur, 1);
            }
            const lp = img.read(ox + 229, oy + 147, 1, 1);
            const loading = !!(lp && lp.data[0] === LOADING_DOT[0] && lp.data[1] === LOADING_DOT[1] && lp.data[2] === LOADING_DOT[2]);
            if (loading || !_lastItemName) {
                try {
                    const fullBuf = img.toData();
                    const result = OCR.findReadLine(fullBuf, tooltipFont, ITEM_NAME_OCR, ox + 182, oy + 120, 340, 17);
                    if (result && result.text.length > 1) {
                        const name = result.text;
                        if (name !== _lastItemName) {
                            _lastItemName = name;
                            drawGeIcon(name);
                        }
                    }
                } catch (_) {}
            }
        }

        // —————— dropdown size ——————
        const sp = img.read(ox + 42, oy + 327, 1, 1);
        const dropdownSmall = !!(sp && sp.data[0] === DROPDOWN_SMALL[0] && sp.data[1] === DROPDOWN_SMALL[1] && sp.data[2] === DROPDOWN_SMALL[2]);
        if (dropdownSmall !== _lastDropdownSmall) {
            _lastDropdownSmall = dropdownSmall;
            if (dropdownSmall && _lastItemName) {
                drawGeIcon(_lastItemName);
            } else if (!dropdownSmall) {
                alt1.overLayClearGroup("bronzeman_ge");
            }
        }

        // —————— steady-state redraw (keep overlay alive, no IndexedDB) ——————
        if (buying && star && dropdownSmall && _lastItemName) {
            drawGeIcon(_lastItemName);
        }

        if (!dropdownSmall) processSearchBox(img, ox, oy, dur);
    } catch (_) {}
}

// ----------------------------------------------------------------
// Search box text detection — OCR + sync to plugin search input
//
// Only runs when the GE search dropdown is LARGE. Two probe pixels
// at (52,225) & (53,225) detect text entry by deviating from the
// search box background (#1b1d1d). When text is found, the typing
// cursor is located on scan-line y=217 between x=49,217. The first
// white or red pixel marks the cursor end → OCR box (49,217, w, 16).
// ----------------------------------------------------------------

function processSearchBox(img: ImgRef, ox: number, oy: number, dur: number): void {
    const sb1 = img.read(ox + 52, oy + 225, 1, 1);
    const sb2 = img.read(ox + 53, oy + 225, 1, 1);
    const isBg = (d: Uint8ClampedArray): boolean => d[0] === SEARCH_BG[0] && d[1] === SEARCH_BG[1] && d[2] === SEARCH_BG[2];
    const hasText = (sb1 && !isBg(sb1.data)) || (sb2 && !isBg(sb2.data));
    if (hasText) {
        let cursorX = -1;
        for (let sx = 49; sx <= 217; sx++) {
            const cp = img.read(ox + sx, oy + 217, 1, 1);
            if (cp && ((cp.data[0] === CURSOR_WHITE[0] && cp.data[1] === CURSOR_WHITE[1] && cp.data[2] === CURSOR_WHITE[2]) ||
                       (cp.data[0] === CURSOR_RED[0] && cp.data[1] === CURSOR_RED[1] && cp.data[2] === CURSOR_RED[2]))) {
                cursorX = sx;
                break;
            }
        }
        if (cursorX >= 0 && cursorX > 49) {
            const ocrW = cursorX - 49;
            if (geDebugOverlays) {
                alt1.overLaySetGroup("bronzeman_searchbox");
                alt1.overLayRect(a1lib.mixColor(DEBUG_YELLOW[0], DEBUG_YELLOW[1], DEBUG_YELLOW[2]), _bx + 49, _by + 217, ocrW, 16, dur, 1);
            }
            if (cursorX !== _lastCursorX || ocrW !== _lastOcrW) {
                _lastCursorX = cursorX;
                _lastOcrW = ocrW;
                try {
                    const fullBuf = img.toData();
                    const result = OCR.findReadLine(fullBuf, geSearchFont, SEARCH_TEXT_OCR, ox + 49, oy + 217, ocrW, 16);
                    if (result && result.text.length > 0) {
                        const wasEmpty = !_geSearchText;
                        _geSearchText = result.text;
                        log(`GE search text: "${_geSearchText}"`);
                        const input = document.getElementById("search_input") as HTMLInputElement | null;
                        if (input && input.value !== _geSearchText) {
                            input.value = _geSearchText;
                            input.dispatchEvent(new Event("input", { bubbles: true }));
                            const clear = document.getElementById("search_clear_btn");
                            if (clear) clear.style.display = _geSearchText.length > 0 ? "block" : "none";
                        }
                        if (wasEmpty) {
                            const activeTab = document.querySelector(".tab-btn.active") as HTMLElement | null;
                            if (activeTab && !activeTab.getAttribute("onclick")?.includes("search")) {
                                _tabBeforeSearch = activeTab.getAttribute("onclick") ?? "";
                            }
                            const searchTab = document.querySelector(".tab-btn[onclick*='search']") as HTMLElement | null;
                            if (searchTab) searchTab.click();
                            // GE search results should never be grouped — suppress
                            // until the GE closes (restored in the GE-lost path).
                            geSuppressGroup.value = true;
                            const si = document.getElementById("search_input") as HTMLInputElement | null;
                            if (si) si.dispatchEvent(new Event("input", { bubbles: true }));
                        }
                    }
                } catch (_) {}
            }
        }
    } else {
        _lastCursorX = -1;
        _lastOcrW = -1;
        if (_geSearchText) {
            _geSearchText = "";
            geSuppressGroup.value = false;
            const input = document.getElementById("search_input") as HTMLInputElement | null;
            if (input) {
                input.value = "";
                input.dispatchEvent(new Event("input", { bubbles: true }));
            }
            const clear = document.getElementById("search_clear_btn");
            if (clear) clear.style.display = "none";
        }
    }
}

// ----------------------------------------------------------------
// Synchronous icon draw — cached PNGs + in-memory name lookup
// ----------------------------------------------------------------

let _encUnlockedLoaded = false;
let _encNotUnlockedLoaded = false;

/** Called from toggleGeDebug(true); ensures both PNGs are loaded before
 *  the first tick fires. The drawGeIcon function is synchronous once
 *  these are populated. */
async function preloadGeIcons(): Promise<void> {
    if (!_encUnlockedLoaded) {
        _encUnlocked = await loadGeButtonEncoded(geItemUnlockedUrl);
        _encUnlockedLoaded = true;
    }
    if (!_encNotUnlockedLoaded) {
        _encNotUnlocked = await loadGeButtonEncoded(geItemNotUnlockedUrl);
        _encNotUnlockedLoaded = true;
    }
}

function drawGeIcon(name: string): void {
    if (!_encUnlocked || !_encNotUnlocked) return;
    const enc = isNameUnlocked(name) ? _encUnlocked : _encNotUnlocked;
    alt1.overLaySetGroup("bronzeman_ge");
    alt1.overLayImage(_bx + 184, _by + 330, enc.data, enc.width, 250);
}
