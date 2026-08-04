// ge-debug.ts — GE interface identification overlay (Developer-mode)
import * as a1lib from "alt1";
import { findSubimage, imageDataFromUrl, ImgRefBind } from "alt1/base";
import type { ImgRef } from "alt1/base";
import * as OCR from "alt1/ocr";
const tooltipFont = require("alt1/fonts/chatbox/14pt");
const geSearchFont = require("alt1/fonts/chatbox/12pt");
import { log } from "./core";
import { isNameUnlocked } from "./data";
import geItemUnlockedUrl from "./assets/images/ge_item_unlocked_button.png";
import geItemNotUnlockedUrl from "./assets/images/ge_item_not_unlocked_button.png";
import needleUrl from "./assets/images/ge_identifier.png";

// ----------------------------------------------------------------
// Toggle
// ----------------------------------------------------------------

export let geDebugActive = false;
let _handle: ReturnType<typeof setInterval> | null = null;
let _needle: ImageData | null = null;

export function toggleGeDebug(): void {
    geDebugActive = !geDebugActive;
    log(`GE debug ${geDebugActive ? "ON" : "OFF"}`);
    if (geDebugActive) {
        void preloadGeIcons().then(() => {
            if (geDebugActive) _handle = setInterval(geDebugTick, 100);
        });
    } else {
        _geLocated = false;
        _lastCursorX = -1;
        if (_handle) { clearInterval(_handle); _handle = null; }
        try {
            alt1.overLayClearGroup("bronzeman_ge");
            alt1.overLayClearGroup("bronzeman_subimg");
            alt1.overLayClearGroup("bronzeman_searchbox");
        } catch (_) {}
    }
    const btn = document.getElementById("ge_debug_btn");
    if (btn) btn.textContent = geDebugActive ? "Disable GE overlay" : "Enable GE overlay";
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

function captureFull(): ImgRef | null {
    try {
        const w = alt1.rsWidth, h = alt1.rsHeight;
        const handle = alt1.bindRegion(0, 0, w, h);
        if (handle <= 0) return null;
        return new ImgRefBind(handle, 0, 0, w, h);
    } catch { return null; }
}

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

const GE_SCALES_GEM_IDENTIFIER = [0x85, 0x57, 0xc4] as const;

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

async function geDebugTick(): Promise<void> {
    if (!geDebugActive) return;
    try {
        let img: ImgRef | null;

        if (!_geLocated) {
            // Hunt: full capture
            img = captureFull();
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

        // —————— magenta box (always redrawn while GE open) ——————
        alt1.overLaySetGroup("bronzeman_subimg");
        alt1.overLayClearGroup("bronzeman_subimg");
        alt1.overLayRect(a1lib.mixColor(255, 0, 255), _bx, _by, 768, 572, dur, 1);

        // —————— buy-offer pixel ——————
        const px = img.read(ox + 36, oy + 128, 1, 1);
        const buying = !!(px && px.data[0] === 0xb3 && px.data[1] === 0xc6 && px.data[2] === 0x03);
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
            star = (fr === 0x7b && fg === 0x7b && fb === 0x7b) || (fr === 0xd4 && fg === 0xae && fb === 0x6d);
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
            alt1.overLayRect(a1lib.mixColor(255, 0, 255), _bx + 182, _by + 120, 340, 17, dur, 1);
            const lp = img.read(ox + 229, oy + 147, 1, 1);
            const loading = !!(lp && lp.data[0] === 0xb3 && lp.data[1] === 0xa9 && lp.data[2] === 0xa3);
            if (loading || !_lastItemName) {
                try {
                    const fullBuf = img.toData();
                    const colors: OCR.ColortTriplet[] = [[0xf0, 0xbe, 0x79]];
                    const result = OCR.findReadLine(fullBuf, tooltipFont, colors, ox + 182, oy + 120, 340, 17);
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
        const dropdownSmall = !!(sp && sp.data[0] === 0xe3 && sp.data[1] === 0xbc && sp.data[2] === 0x7d);
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

        // —————— search box text ——————
        // Only active when the GE search dropdown is LARGE (dropdownSmall=false).
        //
        // The GE search box background is #1b1d1d. When the user types,
        // this background changes. Pixels (52,225) and (53,225) are sampled
        // as probes — if either differs from #1b1d1d, text is present.
        //
        // To find the typed text we locate the typing cursor, which is either
        // white (#ffffff, normal) or red (#ff0000, character limit reached).
        // The cursor sits on a 1px-tall scan-line at y=217 between x=49 and
        // x=217. We walk left → right; the first bright pixel marks the cursor.
        //
        //   • cursor at (49,217)  →  box focused but empty — skip
        //   • cursor found at x>49 →  OCR box = (49,217) × (x−49, 16)
        //   • no cursor found      →  do nothing
        //
        // OCR text colour is #f5f5f5 (off-white), chatbox 14pt font.
        if (!dropdownSmall) {
            const sb1 = img.read(ox + 52, oy + 225, 1, 1);
            const sb2 = img.read(ox + 53, oy + 225, 1, 1);
            const isBg = (d: Uint8ClampedArray) => d[0] === 0x1b && d[1] === 0x1d && d[2] === 0x1d;
            const hasText = (sb1 && !isBg(sb1.data)) || (sb2 && !isBg(sb2.data));
            if (hasText) {
                let cursorX = -1;
                for (let sx = 49; sx <= 217; sx++) {
                    const cp = img.read(ox + sx, oy + 217, 1, 1);
                    if (cp && ((cp.data[0] === 0xff && cp.data[1] === 0xff && cp.data[2] === 0xff) ||
                               (cp.data[0] === 0xff && cp.data[1] === 0x00 && cp.data[2] === 0x00))) {
                        cursorX = sx;
                        break;
                    }
                }
                if (cursorX >= 0 && cursorX > 49) {
                    const ocrW = cursorX - 49;
                    alt1.overLaySetGroup("bronzeman_searchbox");
                    alt1.overLayRect(a1lib.mixColor(255, 255, 0), _bx + 49, _by + 217, ocrW, 16, dur, 1);
                    if (cursorX !== _lastCursorX || ocrW !== _lastOcrW) {
                        _lastCursorX = cursorX;
                        _lastOcrW = ocrW;
                        try {
                            const fullBuf = img.toData();
                            const result = OCR.findReadLine(fullBuf, geSearchFont, [[0xff, 0xff, 0xff]], ox + 49, oy + 217, ocrW, 16);
                            if (result && result.text.length > 0) {
                                const wasEmpty = !_geSearchText;
                                _geSearchText = result.text;
                                log(`GE search text: "${_geSearchText}"`);
                                // Sync to the plugin's search input
                                const input = document.getElementById("search_input") as HTMLInputElement | null;
                                if (input && input.value !== _geSearchText) {
                                    input.value = _geSearchText;
                                    input.dispatchEvent(new Event("input", { bubbles: true }));
                                    const clear = document.getElementById("search_clear_btn");
                                    if (clear) clear.style.display = _geSearchText.length > 0 ? "block" : "none";
                                }
                                // Auto-switch to the Search tab on first character
                                if (wasEmpty) {
                                    // Remember which tab is active
                                    const activeTab = document.querySelector(".tab-btn.active") as HTMLElement | null;
                                    if (activeTab && !activeTab.getAttribute("onclick")?.includes("search")) {
                                        _tabBeforeSearch = activeTab.getAttribute("onclick") ?? "";
                                    }
                                    const searchTab = document.querySelector(".tab-btn[onclick*='search']") as HTMLElement | null;
                                    if (searchTab) searchTab.click();
                                }
                            }
                        } catch (_) {}
                    }
                }
                // Cursor not found or at position 49 (empty): just don't draw.
                // Don't reset _lastCursorX/_lastOcrW — the cursor may be blinking.
                // They'll be reset when the user deletes all text and hasText
                // becomes false, triggering the outer else.
            } else {
                _lastCursorX = -1;
                _lastOcrW = -1;
                if (_geSearchText) {
                    _geSearchText = "";
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
    } catch (_) {}
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
