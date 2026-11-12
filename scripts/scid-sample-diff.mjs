// Local check that our Scid reader decodes a real database to the same moves a
// trusted PGN export has. Committed but inert without data: it reads a Scid set
// and a reference PGN you point it at (samples/ is never committed).
//
//   node scripts/scid-sample-diff.mjs <base-path-without-ext> <reference.pgn>
//   node scripts/scid-sample-diff.mjs samples/test4 samples/HiRes_standard_pieces/Adams.pgn
//
// It decodes every non-deleted game, matches it to a PGN game by header key
// (robust to any reordering), compares the SAN move lists, and prints a summary
// plus the first few mismatches.
import { readFileSync } from 'node:fs';
import { parseScidIndex, decodeGame } from '../src/importers/scid.js';
import { parseAllGames } from '../src/analysis/pgn-parse.js';

const [, , base, pgnPath] = process.argv;
if (!base || !pgnPath) {
  console.error('usage: node scripts/scid-sample-diff.mjs <base-path-without-ext> <reference.pgn>');
  process.exit(2);
}

// Scid version from whichever index file exists.
let version = 4;
let si;
let sn;
let sg;
try {
  si = new Uint8Array(readFileSync(`${base}.si4`));
  sn = new Uint8Array(readFileSync(`${base}.sn4`));
  sg = new Uint8Array(readFileSync(`${base}.sg4`));
} catch {
  version = 5;
  si = new Uint8Array(readFileSync(`${base}.si5`));
  sn = new Uint8Array(readFileSync(`${base}.sn5`));
  sg = new Uint8Array(readFileSync(`${base}.sg5`));
}

// Round is intentionally excluded: PGN exports often drop the Round tag while the
// Scid index keeps it. Whitespace is stripped because Scid normalises player names
// on import (it inserts a space after the comma: "Adams,Mi" → "Adams, Mi"), so the
// stored name differs cosmetically from the source PGN. Same-key duplicates are
// paired in order (both are in game order), so a queue per key lines them up.
const norm = (v) => (v == null ? '' : String(v).replace(/\s+/g, ''));

// Dates are normalised the way Scid does on import, so an invalid source date
// matches the value Scid stored for it. Scid blanks an unparseable date: a bad
// month (e.g. the source typo "2011.19.11") drops BOTH month and day → "2011.??.??".
const normDate = (v) => {
  const [y = '', mo = '', d = ''] = String(v == null ? '' : v).split('.');
  const year = /^\d{4}$/.test(y) && +y >= 1 ? y : '????';
  const monthOk = /^\d\d$/.test(mo) && +mo >= 1 && +mo <= 12;
  const dayOk = /^\d\d$/.test(d) && +d >= 1 && +d <= 31;
  if (!monthOk) return `${year}.??.??`;
  return `${year}.${mo}.${dayOk ? d : '??'}`;
};

const key = (h) => [norm(h.White), norm(h.Black), norm(h.Result), normDate(h.Date), norm(h.Event), norm(h.Site)].join('|');

// Move text without the check/mate glyph — so "Nf5+" (as a source PGN wrote it)
// and "Nf5#" (what chess.js emits when it detects mate) count as the same move.
const bareSan = (s) => s.replace(/[+#]$/, '');

// Index the reference PGN by header key → a queue of its games.
const pgn = parseAllGames(readFileSync(pgnPath, 'utf8'));
const byKey = new Map();
for (const g of pgn.games) {
  const k = key(g.headers);
  if (!byKey.has(k)) byKey.set(k, []);
  byKey.get(k).push(g);
}

const idx = parseScidIndex(si, sn, version);
console.log(`Scid v${version}: ${idx.count} index records · reference PGN: ${pgn.games.length} games`);

let matched = 0;
let unmatched = 0;
let sanMismatch = 0;
let annotationOnly = 0;   // games that match move-for-move but differ only in +/# glyphs
let skipped = 0;
let deleted = 0;
const samples = [];

for (let i = 0; i < idx.count; i += 1) {
  const row = idx.row(i);
  if (!row) { unmatched += 1; continue; }
  if (row.deleted) { deleted += 1; continue; }
  const dec = decodeGame(sg.subarray(row.sgOffset, row.sgOffset + row.sgLength), { version, variant: row.variant });
  if (dec.skipped) { skipped += 1; continue; }

  const queue = byKey.get(key(row.headers));
  const ref = queue && queue.length ? queue.shift() : null;
  if (!ref) {
    unmatched += 1;
    if (samples.length < 10) samples.push(`#${i} no PGN match: ${row.headers.White} vs ${row.headers.Black} (${row.headers.Date})`);
    continue;
  }
  const a = dec.sanList;
  const b = ref.sanList;
  let realDiffAt = -1;
  let glyphDiff = false;
  if (a.length !== b.length) realDiffAt = Math.min(a.length, b.length);
  else {
    for (let p = 0; p < a.length; p += 1) {
      if (a[p] === b[p]) continue;
      if (bareSan(a[p]) === bareSan(b[p])) { glyphDiff = true; continue; } // +/# only
      realDiffAt = p; break;
    }
  }
  if (realDiffAt !== -1) {
    sanMismatch += 1;
    if (samples.length < 10) {
      samples.push(`#${i} ${row.headers.White} vs ${row.headers.Black}: diverge at ply ${realDiffAt + 1} — scid="${a[realDiffAt] ?? '∅'}" pgn="${b[realDiffAt] ?? '∅'}" (scid ${a.length} plies, pgn ${b.length})`);
    }
  } else if (glyphDiff) { matched += 1; annotationOnly += 1; } else { matched += 1; }

  if ((i + 1) % 500 === 0) process.stdout.write(`\r  …${i + 1}/${idx.count}`);
}
process.stdout.write('\n');

console.log(`matched: ${matched} (of which ${annotationOnly} differ only in +/# glyphs)  sanMismatch: ${sanMismatch}  unmatched: ${unmatched}  skipped: ${skipped}  deleted: ${deleted}`);
if (samples.length) { console.log('first issues:'); for (const s of samples) console.log('  ' + s); }
process.exit(sanMismatch || unmatched ? 1 : 0);
