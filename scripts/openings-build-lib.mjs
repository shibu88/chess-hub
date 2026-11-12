// Pure helpers for scripts/build-openings.mjs (unit-tested without the network).
// The Lichess chess-openings TSVs (a.tsv … e.tsv, CC0) have a header row and the
// columns `eco`, `name`, `pgn`. We replay each PGN through chess.js and key the
// result by the position's EPD (first four FEN fields) — the same EPD the app
// computes at runtime (src/analysis/openings.js), so lookups always match.
import { Chess } from 'chess.js';

/** Parse a TSV into row objects keyed by header name. */
export function parseTsv(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return [];
  const header = lines[0].split('\t');
  const col = (name) => header.indexOf(name);
  const iEco = col('eco');
  const iName = col('name');
  const iPgn = col('pgn');
  if (iEco < 0 || iName < 0 || iPgn < 0) {
    throw new Error(`TSV missing eco/name/pgn header (got: ${header.join(', ')})`);
  }
  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const f = lines[i].split('\t');
    rows.push({ eco: f[iEco], name: f[iName], pgn: f[iPgn] });
  }
  return rows;
}

/** EPD (first four FEN fields) for a position reached by replaying `pgn`. */
export function epdForPgn(pgn) {
  const g = new Chess();
  g.loadPgn(pgn); // throws on bad PGN — caller decides whether to skip
  return g.fen().split(/\s+/).slice(0, 4).join(' ');
}

/**
 * Build the EPD → { eco, name } map from parsed rows. First occurrence wins
 * (deterministic across a→e). Returns `{ map, kept, skipped }`.
 */
export function buildMap(rows) {
  const map = {};
  let kept = 0;
  let skipped = 0;
  for (const row of rows) {
    if (!row.pgn) { skipped += 1; continue; }
    let epd;
    try { epd = epdForPgn(row.pgn); } catch { skipped += 1; continue; }
    if (!(epd in map)) { map[epd] = { eco: row.eco, name: row.name }; kept += 1; }
  }
  return { map, kept, skipped };
}
