// wiki.ts — RuneScape wiki API queries for item metadata
import { log } from "./core";

const WIKI_API = "https://runescape.wiki/api.php";
const MAX_REDIRECTS = 3;

export interface WikiQueryResult {
    ok: boolean;
    /** The parsed value of |tradeable = ..., when found. */
    tradeable?: string;
    /** HTTP status or MediaWiki error code when the query failed. */
    status?: string | number;
}

/** Pull the redirect target from "#REDIRECT [[Abyssal Whip]]" (or "[[Page|label]]"). */
function extractRedirectTarget(wikitext: string): string | null {
    const m = /^#REDIRECT\s*\[\[([^\]]+)\]\]/i.exec(wikitext.trim());
    if (!m) return null;
    return m[1].split("|")[0].trim();
}

/** Find the first |tradeable = ... in the item infobox wikitext. */
function extractTradeable(wikitext: string): string | null {
    const m = /\|tradeable\s*=\s*([^\n|]*)/.exec(wikitext);
    return m ? m[1].trim() : null;
}

/** One API parse query for a page; returns the wikitext or the error on failure. */
async function queryPage(page: string): Promise<{ wikitext: string | null; status?: string | number }> {
    const url = `${WIKI_API}?action=parse&page=${encodeURIComponent(page)}&prop=wikitext&format=json`;
    let res: Response;
    try {
        res = await fetch(url);
    } catch (e) {
        log(`Wiki API fetch error for "${page}": ${e}`);
        return { wikitext: null, status: 0 };
    }
    if (!res.ok) {
        log(`Wiki API returned ${res.status} for "${page}"`);
        return { wikitext: null, status: res.status };
    }
    try {
        const json = await res.json();
        // MediaWiki returns 200 with an error object for bad titles (e.g.
        // "missingtitle") — surface the code so the caller can report it.
        if (json?.error) {
            log(`Wiki API error for "${page}": ${json.error.code} — ${json.error.info}`);
            return { wikitext: null, status: json.error.code };
        }
        const wt = json?.parse?.wikitext?.["*"];
        return { wikitext: typeof wt === "string" ? wt : null };
    } catch (e) {
        log(`Wiki API parse error for "${page}": ${e}`);
        return { wikitext: null };
    }
}

/** Search the wiki for the closest page title to a fuzzy name (OCR noise). */
async function searchPage(name: string): Promise<string | null> {
    const url = `${WIKI_API}?action=query&list=search&srsearch=${encodeURIComponent(name)}&srlimit=1&format=json`;
    try {
        const res = await fetch(url);
        if (!res.ok) return null;
        const json = await res.json();
        const title = json?.query?.search?.[0]?.title;
        if (typeof title === "string") {
            log(`Wiki API search: "${name}" → "${title}"`);
            return title;
        }
    } catch (e) {
        log(`Wiki API search error for "${name}": ${e}`);
    }
    return null;
}

/** Resolve an item name to its |tradeable = value, following redirects.
 *  ok=false with status set = request/API error; ok=false without status =
 *  no tradeable field found (or redirect limit hit). */
export async function fetchItemTradeable(itemName: string): Promise<WikiQueryResult> {
    let page = itemName.trim();
    for (let i = 0; i <= MAX_REDIRECTS; i++) {
        let r = await queryPage(page);
        // Exact-name query failed — try a search fallback once before giving up.
        if (r.wikitext === null && r.status === "missingtitle") {
            const found = await searchPage(page);
            if (found) {
                page = found;
                r = await queryPage(page);
            }
        }
        if (r.wikitext === null) return { ok: false, status: r.status };
        const redirect = extractRedirectTarget(r.wikitext);
        if (redirect) {
            log(`Wiki API: "${page}" redirects to "${redirect}"`);
            page = redirect;
            continue;
        }
        const tradeable = extractTradeable(r.wikitext);
        if (tradeable === null) {
            log(`Wiki API: no "tradeable" field found for "${page}"`);
            return { ok: false };
        }
        return { ok: true, tradeable };
    }
    log(`Wiki API: too many redirects resolving "${itemName}"`);
    return { ok: false };
}
