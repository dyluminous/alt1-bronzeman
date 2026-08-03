// =============================================================================
// test/stress/populate-test-data.ts
//
// Standalone stress-test script: generates random unlock records and inserts
// them into the Bronzeman IndexedDB via the UnlockStore singleton.
//
// To use from the browser console:
//   Bronzeman.populateTestData(30000)   // 30k random records
//
// Or use the Developer tab → "Stress Test DB" button with its number input.
//
// What this script provides (saved here for reference / reuse):
//   - Syllabic name generator — 44 consonants × 17 vowels, 1–4 words of 1–3
//     syllables each. Millions of pronouncable RuneScape-ish names like
//     "Klaebrei Phua", "Zhaustro Gri Quos Lai". No fixed word list.
//   - 192-char hex hash generator (48 bytes → 3 nibbles per 8×8 cell as
//     stored by hashInterior).
//   - Timestamp generator spanning 2000-01-01 → now.
//   - Batched insertion (250 records per IDB transaction) for performance.
//   - Collision guard: regenerates names that already exist in the DB.
//
// The actual populateTestData method lives in src/data.ts on the UnlockStore
// class. This file captures the name-generator algorithm for posterity in
// case the in-repo version is removed before merging back to main.
// =============================================================================

// --- Syllabic name generator ------------------------------------------------

/** Consonant clusters that start a syllable. */
const C = ["b","br","c","ch","cl","cr","d","dr","f","fr","g","gh","gl","gr",
           "h","j","k","kh","kl","kr","l","m","n","p","ph","pl","pr","qu",
           "r","rh","s","sh","sk","sl","sm","sn","sp","st","str","t","th",
           "tr","v","vr","w","wh","x","z","zh"];

/** Vowel clusters that follow a consonant. */
const V = ["a","ae","ai","e","ea","ei","i","ia","ie","o","oa","oe","u","ua","ue","ui"];

/** One consonant + one vowel → one syllable, e.g. "kla", "brei", "zho". */
function syll(): string {
    return C[Math.random() * C.length | 0] + V[Math.random() * V.length | 0];
}

/** 1–3 syllables with the first letter capitalised → one word, e.g. "Klaebrei". */
function word(): string {
    const n = (Math.random() * 3 | 0) + 1;
    let s = "";
    for (let i = 0; i < n; i++) s += syll();
    return s[0].toUpperCase() + s.slice(1);
}

/** 1–4 words joined by spaces → an item name, e.g. "Phua Zhaustro Lai". */
function randomName(): string {
    const n = (Math.random() * 4 | 0) + 1;
    const parts: string[] = [];
    for (let i = 0; i < n; i++) parts.push(word());
    return parts.join(" ");
}

// --- Hash & timestamp generators -------------------------------------------

function randomInRange(lo: number, hi: number): number {
    return Math.floor(Math.random() * (hi - lo + 1)) + lo;
}

/** 192-char hex string — the same format produced by hashInterior(). */
function randomHexHash(): string {
    return Array.from({ length: 192 }, () => "0123456789abcdef"[randomInRange(0, 15)]).join("");
}

/** Unix-epoch ms between 2000-01-01 and now. */
function randomTimestamp(): number {
    return randomInRange(946684800000, Date.now());
}

// =============================================================================
// If this file is ever revived, wire it up to the UnlockStore like this:
//
//   const BATCH = 250;
//   for (let inserted = 0; inserted < count; ) {
//       const batch = Math.min(BATCH, count - inserted);
//       const tx = db.transaction([TRADABLE, UNTRADABLE], "readwrite");
//       for (let i = 0; i < batch; i++) {
//           const tradeable = Math.random() < 0.5;
//           let n: string;
//           do { n = randomName(); } while (names.has(n));
//           const ts = randomTimestamp();
//           tx.objectStore(tradeable ? TRADABLE : UNTRADABLE).put({
//               name: n,
//               tradeable,
//               hashes: [{ hash: randomHexHash(), stackableQuantity: null, addedOn: ts }],
//               lastUpdatedOn: ts,
//           });
//           // … update in-memory indexes
//       }
//       await txComplete(tx);
//       inserted += batch;
//   }
// =============================================================================
