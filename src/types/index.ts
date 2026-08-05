// types/index.ts — shared interfaces and type definitions for Bronzeman Mode.
// Every interface/type that is imported by more than one module lives here.

// ---------------------------------------------------------------------------
// Core
// ---------------------------------------------------------------------------

/** Handle returned by showNotification — the caller can update or remove
 *  the notification before its duration expires. */
export interface NotificationHandle {
    update(msg: string): void;
    remove(): void;
}

// ---------------------------------------------------------------------------
// Inventory geometry
// ---------------------------------------------------------------------------

/** Pixel coords within the RS game viewport. */
export interface Point {
    x: number;
    y: number;
}

/** Calibrated backpack anchor — the origin + stride of the slot grid. */
export interface BackpackAnchor {
    x: number;
    y: number;
    method: "manual" | "cursor" | "fallback" | "auto";
    colStride: number;
    rowStride: number;
    gridCols?: number;
    gridRows?: number;
    centerMismatch?: boolean;
    scrollbar?: boolean;
}

// ---------------------------------------------------------------------------
// Inventory detection
// ---------------------------------------------------------------------------

/** A fingerprint match during grid detection. */
export interface FingerprintHit {
    /** BL-corner pixel X in viewport coords. */
    x: number;
    /** BL-corner pixel Y in viewport coords. */
    y: number;
    /** Which fingerprint matched (index into FINGERPRINTS array). */
    fingerIndex: number;
}

// ---------------------------------------------------------------------------
// Data (unlock persistence)
// ---------------------------------------------------------------------------

/** Per-hash metadata stored alongside each variant. */
export interface HashEntry {
    hash: string;
    stackableQuantity: number | null;
    /** Timestamp when this hash variant was unlocked. */
    addedOn: number;
}

/** One unlock record — a named item with one or more hashes. */
export interface UnlockedItemRecord {
    name: string;
    tradeable: boolean;
    hashes: HashEntry[];
    /** Timestamp bumped every time a hash is added to this record. */
    lastUpdatedOn: number;
}

/** Lightweight in-memory entry for the search index. */
export interface SearchEntry {
    name: string;
    tradeable: boolean;
}

// ---------------------------------------------------------------------------
// Recent unlocks
// ---------------------------------------------------------------------------

/** A recently-unlocked item shown in the UI grid. */
export interface RecentEntry {
    name: string;
    imageUrl: string;
    displayLabel: string;
}

// ---------------------------------------------------------------------------
// Wiki API
// ---------------------------------------------------------------------------

/** A disambiguation page option parsed from wikitext. */
export interface DisambiguationOption {
    /** The page name from [[ ]], for re-querying. */
    name: string;
    /** The text after the link (the description), if any. */
    description: string;
}

/** An item inventory image parsed from wikitext |image / |image1 fields. */
export interface ItemImage {
    filename: string;
    /** The quantity number parsed from the filename, e.g. 500 from "Radiant energy 500.png".
     *  null when the filename has no number. */
    count: number | null;
}

/** Result of a wiki API query for an item's tradeability. */
export interface WikiQueryResult {
    ok: boolean;
    /** The parsed value of |tradeable = ..., when found. */
    tradeable?: string;
    /** HTTP status or MediaWiki error code when the query failed. */
    status?: string | number;
    /** When the page is a disambiguation page — the selectable options. */
    disambig?: DisambiguationOption[];
    /** Item inventory images, with parsed quantities. */
    images?: ItemImage[];
}

// ---------------------------------------------------------------------------
// Slot animation
// ---------------------------------------------------------------------------

/** Configuration for a SlotLoadingAnimation. */
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

/** The border edge at perimeter-distance d from TL, going clockwise. */
export interface BorderEdge {
    x: number;
    y: number;
    dx: number;
    dy: number;
    end: number;
}

// ---------------------------------------------------------------------------
// Tooltip reading
// ---------------------------------------------------------------------------

/** A tooltip border hit found during the walk from the cursor. */
export interface TooltipHit {
    x: number;
    y: number;
    dist: number;
    dir: "down" | "up";
}

/** Horizontal run measurement of tooltip border pixels. */
export interface TooltipRun {
    width: number;
    leftX: number;
}

/** Vertical run measurement along the tooltip's left border. */
export interface TooltipVerticalRun {
    startX: number;
    startY: number;
    height: number;
}

/** Complete tooltip measurement after the full scan pipeline. */
export interface TooltipMeasure {
    img: import("alt1/base").ImgRef;
    hit: TooltipHit;
    run: TooltipRun;
    vrun: TooltipVerticalRun;
    boxX: number;
    boxY: number;
    boxW: number;
    boxH: number;
    inX: number;
    inY: number;
    inW: number;
    inH: number;
    midX: number;
    midY: number;
    itemSectionH: number;
}
