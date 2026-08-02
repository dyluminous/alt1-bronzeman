// gold-dot.ts — shared gold-dot overlay asset + draw position.
// Used by both the slot-27 debug dot (overlay.ts) and the non-unlocked dot
// refresh (dot-hover.ts), so the encoded asset and position live here once.
import * as a1lib from "alt1";
import goldDot from "./assets/images/gold_dot.png";

/** Dot position on the slot, relative to the TL border pixel (0,0). */
export const SLOT_DOT_X = 26;
export const SLOT_DOT_Y = 2;
/** gold_dot.png is 10×10. */
export const SLOT_DOT_W = 10;

let goldDotPromise: Promise<string> | null = null;

/** Load gold_dot.png once and return its encoded overlay-image string. */
export function loadGoldDotEncoded(): Promise<string> {
    if (!goldDotPromise) {
        goldDotPromise = new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const cv = document.createElement("canvas");
                cv.width = img.width;
                cv.height = img.height;
                const ctx = cv.getContext("2d");
                if (!ctx) { reject(new Error("no 2d context")); return; }
                ctx.drawImage(img, 0, 0);
                resolve(a1lib.encodeImageString(ctx.getImageData(0, 0, img.width, img.height)));
            };
            img.onerror = () => reject(new Error("failed to load gold_dot.png"));
            img.src = goldDot;
        });
    }
    return goldDotPromise;
}
