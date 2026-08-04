// ge-debug.ts — GE interface identification overlay (Developer-mode)
import * as a1lib from "alt1";
import { findSubimage, imageDataFromUrl, ImgRefBind } from "alt1/base";
import type { ImgRef } from "alt1/base";
import * as OCR from "alt1/ocr";
const tooltipFont = require("alt1/fonts/chatbox/14pt");
import { log } from "./core";
import { getItemRecord } from "./data";
import geItemUnlockedUrl from "./assets/images/ge_item_unlocked_button.png";
import geItemNotUnlockedUrl from "./assets/images/ge_item_not_unlocked_button.png";
import needleUrl from "./assets/images/sub/grand.png";

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
        _handle = setInterval(geDebugTick, 1000);
    } else {
        if (_handle) { clearInterval(_handle); _handle = null; }
        try {
            alt1.overLayClearGroup("bronzeman_ge");
            alt1.overLayClearGroup("bronzeman_subimg");
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
// Tick — independent interval. Two modes:
//   Hunt: full capture → findSubimage → cache GE position
//   Locked: region-only capture (fast) → pixel checks + icon
// Never calls bindRegion twice in one tick — the tick that locates
// the GE falls through with the full capture already in hand.
// ----------------------------------------------------------------

let _bx = 0, _by = 0;
let _geLocated = false;
let _missTicks = 0;

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
            _bx = matches[0].x - 48;
            _by = matches[0].y - 22;
            _geLocated = true;
            _missTicks = 0;
        } else {
            // Locked: region-only capture
            img = captureGeRegion(_bx, _by);
            if (!img) { _missTicks++; checkLost(); return; }
        }

        const dur = 1500;

        // Pixel reads are relative to the captured region. When using a full
        // capture, the reads use screen-absolute offsets (_bx, _by). When using
        // a region capture, the region starts at (_bx, _by) on screen, so pixel
        // reads use (0, 0)-based offsets.
        const ox = _geLocated && img.width === 768 ? 0 : _bx;
        const oy = _geLocated && img.height === 572 ? 0 : _by;

        // All overlay draws use absolute screen coordinates
        alt1.overLaySetGroup("bronzeman_subimg");
        alt1.overLayClearGroup("bronzeman_subimg");
        alt1.overLayRect(a1lib.mixColor(255, 0, 255), _bx, _by, 768, 572, dur, 1);

        // Buy offer open?
        const px = img.read(ox + 36, oy + 128, 1, 1);
        if (!px) { _missTicks++; checkLost(); return; }
        if (!(px.data[0] === 0xb3 && px.data[1] === 0xc6 && px.data[2] === 0x03)) { _missTicks++; checkLost(); return; }

        _missTicks = 0;
        let geItemName = "";

        // Star pixel → item selected
        const fav = img.read(ox + 531, oy + 130, 1, 1);
        if (fav) {
            const fr = fav.data[0], fg = fav.data[1], fb = fav.data[2];
            if ((fr === 0x7b && fg === 0x7b && fb === 0x7b) ||
                (fr === 0xd4 && fg === 0xae && fb === 0x6d)) {
                alt1.overLayRect(a1lib.mixColor(255, 0, 255), _bx + 182, _by + 120, 340, 17, dur, 1);
                try {
                    const fullBuf = img.toData();
                    const colors: OCR.ColortTriplet[] = [[0xf0, 0xbe, 0x79]];
                    const result = OCR.findReadLine(fullBuf, tooltipFont, colors, ox + 182, oy + 120, 340, 17);
                    if (result && result.text.length > 1) geItemName = result.text;
                } catch (_) {}
            }
        }

        // Small dropdown → draw icon
        const sp = img.read(ox + 42, oy + 327, 1, 1);
        if (!sp) { alt1.overLayClearGroup("bronzeman_ge"); return; }
        const sr = sp.data[0], sg = sp.data[1], sb = sp.data[2];
        if (sr === 0xe3 && sg === 0xbc && sb === 0x7d && geItemName) {
            getItemRecord("unlocks_tradable", geItemName).then(async rec => {
                let enc = rec ? _encUnlocked : _encNotUnlocked;
                if (!enc) {
                    const url = rec ? geItemUnlockedUrl : geItemNotUnlockedUrl;
                    enc = await loadGeButtonEncoded(url);
                    if (rec) _encUnlocked = enc; else _encNotUnlocked = enc;
                }
                alt1.overLaySetGroup("bronzeman_ge");
                alt1.overLayImage(_bx + 184, _by + 330, enc.data, enc.width, dur);
            }).catch(() => {});
        } else {
            alt1.overLayClearGroup("bronzeman_ge");
        }
    } catch (_) {}
}

function checkLost(): void {
    if (_missTicks >= 3 && _geLocated) {
        _geLocated = false;
        alt1.overLayClearGroup("bronzeman_ge");
        alt1.overLayClearGroup("bronzeman_subimg");
    }
}
