// Pure PGN parser — no DOM, no chess.js, so it's fast enough for tens of
// thousands of games and unit-testable directly. It splits a PGN file into
// games, reads the Seven-Tag-Roster headers (+ ECO, FEN/SetUp), and reduces the
// movetext to the main line as a list of SAN tokens. Comments {…} (incl.
// [%clk]/[%eval]), variations (…), NAGs ($n), move numbers and result tokens are
// stripped. Legality is NOT checked here (that happens when a game is opened) so
// a bad game never blocks the rest.
//
// Limits (untrusted input): a header value over 1 KB is truncated; a game whose
// movetext exceeds 1 MB is reported as an error and skipped.

const MAX_HEADER = 1024;
const MAX_MOVETEXT = 1024 * 1024;
const KEEP_HEADERS = ['White', 'Black', 'Result', 'Date', 'Event', 'Site', 'ECO', 'WhiteElo', 'BlackElo', 'FEN', 'SetUp'];
const RESULTS = new Set(['1-0', '0-1', '1/2-1/2', '*']);

// Remove balanced variations (…) and comments {…} (comments are not nested).
function stripCommentsAndVariations(s) {
  let out = '';
  let paren = 0;
  let comment = false;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (comment) { if (ch === '}') comment = false; continue; }
    if (ch === '{') { comment = true; continue; }
    if (ch === '(') { paren += 1; continue; }
    if (ch === ')') { if (paren > 0) paren -= 1; continue; }
    if (paren === 0) out += ch;
  }
  return out;
}

/** Movetext → main-line SAN tokens. */
export function movetextToSan(movetext) {
  let s = stripCommentsAndVariations(movetext);
  s = s.replace(/\$\d+/g, ' ');          // NAGs
  s = s.replace(/\b\d+\.(\.\.)?/g, ' ');  // move numbers "12." / "12..."
  s = s.replace(/\.\.\./g, ' ');          // stray "..."
  const out = [];
  for (let tok of s.split(/\s+/)) {
    if (!tok || RESULTS.has(tok)) continue;
    tok = tok.replace(/[!?]+$/, '');       // drop !,?,!!,?! … suffixes
    if (!tok) continue;
    tok = tok.replace(/0/g, 'O');          // normalise 0-0 castling to O-O
    if (/^O-O(-O)?[+#]?$/.test(tok) || /^[KQRBNa-h]/.test(tok)) out.push(tok);
  }
  return out;
}

function buildGame(headers, movetext, index) {
  if (movetext.length > MAX_MOVETEXT) throw new Error(`game ${index}: movetext too large`);
  const kept = {};
  for (const k of KEEP_HEADERS) if (headers[k] != null) kept[k] = headers[k].slice(0, MAX_HEADER);
  const sanList = movetextToSan(movetext);
  const baseFen = (kept.FEN && (!kept.SetUp || kept.SetUp === '1')) ? kept.FEN : (kept.FEN || null);
  return {
    headers: kept,
    baseFen: baseFen || null,
    sanList,
    plyCount: sanList.length,
  };
}

/**
 * Parse a whole PGN file.
 * @param {string} text
 * @param {object} [opts] { onProgress(count), maxGames }
 * @returns {{ games: Array, errors: Array<{index,message}> }}
 */
export function parseAllGames(text, opts = {}) {
  const onProgress = opts.onProgress || (() => {});
  const maxGames = opts.maxGames || Infinity;
  const src = text.replace(/^﻿/, '');
  const lines = src.split(/\r?\n/);

  const games = [];
  const errors = [];
  let headers = {};
  let moveLines = [];
  let inMoves = false;
  let count = 0;

  const flush = () => {
    if (!inMoves && Object.keys(headers).length === 0) return;
    count += 1;
    try {
      games.push(buildGame(headers, moveLines.join('\n'), count));
    } catch (err) {
      errors.push({ index: count, message: err.message });
    }
    headers = {};
    moveLines = [];
    inMoves = false;
    if (count % 500 === 0) onProgress(count);
  };

  const HEADER_RE = /^\s*\[(\w+)\s+"((?:[^"\\]|\\.)*)"\]\s*$/;
  for (const line of lines) {
    if (games.length >= maxGames) break;
    const hm = line.match(HEADER_RE);
    if (hm) {
      if (inMoves) flush();                       // a tag after movetext → next game
      headers[hm[1]] = hm[2].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      continue;
    }
    if (line.trim() === '') {
      if (!inMoves && Object.keys(headers).length) inMoves = true; // blank after headers → movetext
      else if (inMoves) moveLines.push('');
      continue;
    }
    inMoves = true;
    moveLines.push(line);
  }
  flush();
  onProgress(count);
  return { games, errors };
}
