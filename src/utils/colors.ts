// utils/colors.ts — shared RS overlay color constants.
// Every mixColor call in the codebase should reference a constant from here.
import * as a1lib from "alt1";

// ---------------------------------------------------------------------------
// RS palette — matches style.css custom properties
// ---------------------------------------------------------------------------

/** --rs-gold / comet-ring gold / tooltip gold box / anchor-watch dot */
export const RS_GOLD    = a1lib.mixColor(212, 168, 75);  // #D4A84B

/** --rs-green / green debug boxes / duplicate-hash border */
export const RS_GREEN   = a1lib.mixColor(28, 228, 1);    // #1CE401

/** --rs-red (ish) / detection error brackets */
export const RS_RED     = a1lib.mixColor(255, 60, 60);    // #FF3C3C

// ---------------------------------------------------------------------------
// Debug overlay colours
// ---------------------------------------------------------------------------

export const OVERLAY_YELLOW  = a1lib.mixColor(255, 255, 0);   // #FFFF00
export const OVERLAY_WHITE   = a1lib.mixColor(255, 255, 255); // #FFFFFF
export const OVERLAY_MAGENTA = a1lib.mixColor(255, 0, 255);   // #FF00FF
