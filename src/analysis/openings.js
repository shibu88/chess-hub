// Opening book lookup. `public/openings.json` maps an EPD (the first four FEN
// fields) to `{ eco, name }`, built from the Lichess chess-openings TSVs by
// scripts/build-openings.mjs. Used by Review for the "Book" label and the
// opening name. The lookup logic is pure and the map is injectable so it can be
// unit-tested without the generated file.

let MAP = null;

/** Inject the opening map directly (tests, or a preloaded map). */
export function setOpeningsMap(map) { MAP = map; }

/** Load and cache `public/openings.json`. Safe to call repeatedly. */
export async function loadOpenings(url = '/openings.json') {
  if (MAP) return MAP;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`openings.json ${res.status}`);
  MAP = await res.json();
  return MAP;
}

/**
 * EPD key for a position: the first four FEN fields (placement, side to move,
 * castling, en passant) — the halfmove/fullmove counters are dropped. Both this
 * and the build script derive the EPD from chess.js FENs, so they always agree.
 */
export function epdOf(fen) {
  return String(fen).trim().split(/\s+/).slice(0, 4).join(' ');
}

/** The opening for this exact position, or null. */
export function lookup(fen) {
  if (!MAP) return null;
  return MAP[epdOf(fen)] || null;
}

/** Is this position in the opening book? */
export function isBook(fen) {
  return lookup(fen) != null;
}

/**
 * Given the positions after each move in order (`fensAfterMove[i]` = FEN after
 * move i+1), return `{ eco, name, ply }` for the deepest opening reached by an
 * unbroken book line from move 1, or null. `ply` is the 1-based move count of
 * that deepest match — used to mark which leading moves are "Book".
 */
export function deepestOpening(fensAfterMove) {
  let best = null;
  for (let i = 0; i < fensAfterMove.length; i += 1) {
    const hit = lookup(fensAfterMove[i]);
    if (!hit) break; // book line is broken — stop
    best = { ...hit, ply: i + 1 };
  }
  return best;
}
