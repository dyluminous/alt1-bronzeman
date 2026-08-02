// slot-animation.ts — gold comet-ring animation tracing an inventory slot border.
// A head draws along the border leaving a fading trail; a second comet launches
// half a lap behind the first so the two circle the slot together.
import * as a1lib from "alt1";
import { InventorySlot } from "./inventory-slot";

/** Perimeter of a slot border cell in px. */
const PERIMETER = 2 * (InventorySlot.CELL_W + InventorySlot.CELL_H);

/** Normalize a (possibly negative, possibly > perimeter) distance to [0, PERIMETER). */
const norm = (v: number): number => ((Math.round(v) % PERIMETER) + PERIMETER) % PERIMETER;

/** The border edge at perimeter-distance d from TL, going clockwise.
 *  Corners are counted once at the start of each edge, so the four corner
 *  pixels get double-drawn (harmless overlap). */
interface BorderEdge { x: number; y: number; dx: number; dy: number; end: number }

function borderEdgeAt(slot: InventorySlot, d: number): BorderEdge {
    const W = InventorySlot.CELL_W, H = InventorySlot.CELL_H;
    if (d < W) return { x: slot.x + d, y: slot.y, dx: 1, dy: 0, end: W };                               // TL→TR
    if (d < W + H) return { x: slot.x + W - 1, y: slot.y + d - W, dx: 0, dy: 1, end: W + H };           // TR→BR
    if (d < 2 * W + H) return { x: slot.x + (2 * W + H - 1 - d), y: slot.y + H - 1, dx: -1, dy: 0, end: 2 * W + H }; // BR→BL
    return { x: slot.x, y: slot.y + (PERIMETER - 1 - d), dx: 0, dy: -1, end: PERIMETER };               // BL→TL
}

/** Draw a 1px border segment of length len starting at perimeter-distance d (wraps corners). */
function drawBorderSegment(slot: InventorySlot, d: number, len: number, dur: number, color: number): void {
    let remaining = len;
    while (remaining > 0) {
        const e = borderEdgeAt(slot, d);
        const n = Math.min(remaining, e.end - d);
        if (e.dx === 1) alt1.overLayRect(color, e.x, e.y, n, 1, dur, 1);
        else if (e.dy === 1) alt1.overLayRect(color, e.x, e.y, 1, n, dur, 1);
        else if (e.dx === -1) alt1.overLayRect(color, e.x - n + 1, e.y, n, 1, dur, 1);
        else alt1.overLayRect(color, e.x, e.y - n + 1, 1, n, dur, 1);
        d = (d + n) % PERIMETER;
        remaining -= n;
    }
}

export interface SlotAnimationOptions {
    /** Trail length in px (default 34). */
    tailPx?: number;
    /** Perimeter distance at which the second comet launches (default: half a lap).
     *  Pass null to run a single comet. */
    secondCometOffset?: number | null;
    /** Frame interval in ms (default 33 ≈ 30fps — Alt1's overlay redraw ceiling). */
    stepMs?: number;
    /** Approx px the head advances per frame (default 3). */
    speedPxPerFrame?: number;
}

/** A comet-ring animation around one inventory slot's border. */
export class SlotLoadingAnimation {
    private static readonly GROUP = "bronzeman_slotanim";
    private static readonly GOLD = a1lib.mixColor(212, 168, 75); // --rs-gold (#D4A84B)

    private readonly slot: InventorySlot;
    private readonly tailMs: number;
    private readonly secondCometOffset: number | null;
    private readonly stepMs: number;
    private readonly cycleMs: number;

    private timer: ReturnType<typeof setInterval> | null = null;
    private startTime = 0;
    /** Cumulative head distance (px) at the last frame — never modded, so the
     *  [prev, cur) tiling stays contiguous across the cycle wrap. */
    private lastPos = 0;

    constructor(slot: InventorySlot, options: SlotAnimationOptions = {}) {
        this.slot = slot;
        this.stepMs = options.stepMs ?? 33;
        this.cycleMs = Math.ceil(PERIMETER / (options.speedPxPerFrame ?? 3)) * this.stepMs;
        this.tailMs = Math.round((options.tailPx ?? 34) / PERIMETER * this.cycleMs);
        this.secondCometOffset = options.secondCometOffset ?? PERIMETER / 2;
    }

    get running(): boolean { return this.timer !== null; }

    /** Start the animation. */
    start(): void {
        if (this.timer) return;
        alt1.overLaySetGroup(SlotLoadingAnimation.GROUP);
        this.startTime = Date.now();
        this.lastPos = 0;
        this.tick();
        this.timer = setInterval(() => this.tick(), this.stepMs);
    }

    /** Stop the animation. Already-drawn segments are left to fade out naturally
     *  (they carry a finite duration), rather than force-clearing the group. */
    stop(): void {
        if (this.timer) { clearInterval(this.timer); this.timer = null; }
    }

    /** One frame: draw each comet's segment from its last head position to the current one.
     *  Tiling [prev, cur) keeps each trail contiguous — rounding the endpoints can't
     *  leave 1px gaps the way rounding a fixed 3px step per frame can. */
    private tick(): void {
        alt1.overLaySetGroup(SlotLoadingAnimation.GROUP); // immune to other code switching the active group
        const pos = (Date.now() - this.startTime) / this.cycleMs * PERIMETER;
        this.drawComet(this.lastPos, pos);
        if (this.secondCometOffset != null) {
            // Launches when comet 1 is secondCometOffset in, then stays exactly that
            // far behind forever (clamped to 0 so nothing draws before launch).
            this.drawComet(Math.max(0, this.lastPos - this.secondCometOffset), Math.max(0, pos - this.secondCometOffset));
        }
        this.lastPos = pos;
    }

    /** Draw the trail segment covering [from, to) along the perimeter. */
    private drawComet(from: number, to: number): void {
        const start = norm(from);
        const end = norm(to);
        const len = (end - start + PERIMETER) % PERIMETER;
        if (len > 0) drawBorderSegment(this.slot, start, len, this.tailMs, SlotLoadingAnimation.GOLD);
    }
}
