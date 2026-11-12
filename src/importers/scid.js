// Our own reader for Scid chess databases (Scid 4: .si4/.sg4/.sn4, Scid 5:
// .si5/.sg5/.sn5). Pure — no DOM, no worker — so it's unit-tested directly and
// reused by src/analysis/scid-worker.js. Byte layouts were confirmed in Phase 4
// Stage A against Scid's own C++ source (see tasks/todo.md "Format notes" and
// reference/scidtopgn + reference/si4spec).
//
// The two versions differ a lot in their index + name files (header presence,
// record size, endianness — v4 big-endian, v5 little-endian — and name coding),
// but share the exact .sg move-stream encoding, so there is one shared decoder.
//
// We produce the same shape the PGN parser does — list rows with
// { headers, sgOffset, sgLength } and decodeGame() → { sanList, baseFen } — so
// Review, Save and Download PGN (src/analysis/pgn-export.js) all work unchanged.
import { createGame, tryMove, FILES } from '../shared/rules.js';

// ---- text (UTF-8, falling back to Latin-1 for older files) ------------------
const UTF8 = new TextDecoder('utf-8', { fatal: true });
const LATIN1 = new TextDecoder('latin1');
function decodeText(bytes) {
  let s;
  try { s = UTF8.decode(bytes); } catch { s = LATIN1.decode(bytes); }
  return s.replace(/[\u0000-\u001f]/g, '').trim(); // drop control chars
}

// ---- square geometry (Scid: square = rank*8 + file, a1=0 .. h8=63) ----------
const fileOf = (sq) => sq & 7;
const rankOf = (sq) => sq >> 3;
const algeb = (sq) => FILES[sq & 7] + (1 + (sq >> 3));          // 4 → "e1"
const toScid = (alg) => (alg.charCodeAt(1) - 49) * 8 + (alg.charCodeAt(0) - 97);

// ---- move-value tables (verified from Scid game.cpp) ------------------------
const KING_DIFF = [0, -9, -8, -7, -1, 1, 7, 8, 9];   // val 1..8 (9/10 castle, 0 null)
const KNIGHT_DIFF = [0, -17, -15, -10, -6, 6, 10, 15, 17]; // val 1..8
const PAWN_DIFF = [7, 8, 9, 7, 8, 9, 7, 8, 9, 7, 8, 9, 7, 8, 9, 16];
const PAWN_PROMO = [null, null, null, 'q', 'q', 'q', 'r', 'r', 'r', 'b', 'b', 'b', 'n', 'n', 'n', null];

// Standard-start piece numbering (piece# → Scid square), King always 0.
const STD_WHITE = [4, 0, 1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
const STD_BLACK = [60, 56, 57, 58, 59, 61, 62, 63, 48, 49, 50, 51, 52, 53, 54, 55];

// =============================================================================
// Index + names → game-list rows
// =============================================================================

const RESULTS = ['*', '1-0', '0-1', '1/2-1/2'];

function fmtDate(packed) {
  const day = packed & 31;
  const month = (packed >> 5) & 15;
  const year = (packed >> 9) & 2047;
  const yy = year ? String(year).padStart(4, '0') : '????';
  const mm = month ? String(month).padStart(2, '0') : '??';
  const dd = day ? String(day).padStart(2, '0') : '??';
  return `${yy}.${mm}.${dd}`;
}

// ECO code → base classification (e.g. "B12"); subcodes omitted (list display).
function decodeEco(code) {
  if (!code) return '';
  const base = Math.floor((code - 1) / 131);
  if (base < 0 || base >= 500) return '';
  const letter = String.fromCharCode(65 + Math.floor(base / 100));
  return `${letter}${Math.floor((base % 100) / 10)}${base % 10}`;
}

// ---- Scid 4 index: 182-byte header, then 47-byte big-endian records ---------
const SI4_HEADER = 182;
const SI4_ENTRY = 47;

function scid4Count(b) {
  if (b.length < SI4_HEADER) return 0;
  const numGames = (b[14] << 16) | (b[15] << 8) | b[16];
  const avail = Math.floor((b.length - SI4_HEADER) / SI4_ENTRY);
  return Math.max(0, Math.min(numGames, avail));
}

function scid4Entry(b, i) {
  const o = SI4_HEADER + i * SI4_ENTRY;
  const u16 = (k) => (b[o + k] << 8) | b[o + k + 1];
  const u32 = (k) => ((b[o + k] << 24) | (b[o + k + 1] << 16) | (b[o + k + 2] << 8) | b[o + k + 3]) >>> 0;
  const flags = u16(7);
  const varc = u16(21);
  return {
    sgOffset: u32(0),
    sgLength: u16(4) | ((b[o + 6] & 0x80) << 9),
    plyCount: b[o + 37] | (((b[o + 38] >> 6) & 3) << 8), // 10-bit half-move count
    deleted: !!(flags & (1 << 3)),
    variant: false,                 // v4 index has no variant flag (see Stage A notes)
    result: varc >>> 12,
    eco: u16(23),
    gameDate: u32(25) & 0xfffff,
    whiteElo: u16(29) & 0x0fff,
    blackElo: u16(31) & 0x0fff,
    whiteId: ((b[o + 9] & 0xf0) << 12) | u16(10),
    blackId: ((b[o + 9] & 0x0f) << 16) | u16(12),
    eventId: ((b[o + 14] & 0xe0) << 11) | u16(15),
    siteId: ((b[o + 14] & 0x1c) << 14) | u16(17),
    roundId: ((b[o + 14] & 0x03) << 16) | u16(19),
  };
}

// ---- Scid 5 index: no header, 56-byte little-endian records -----------------
const SI5_ENTRY = 56;

function scid5Entry(b, i) {
  const dv = new DataView(b.buffer, b.byteOffset + i * SI5_ENTRY, SI5_ENTRY);
  const w = (k) => dv.getUint32(k * 4, true);
  const w4 = w(4);
  const w5 = w(5);
  const w6 = w(6);
  const w7 = w(7);
  const w8 = w(8);
  const w11 = w(11);
  return {
    sgOffset: (w8 & 0x7fff) * 4294967296 + (w(9) >>> 0), // 47-bit offset
    sgLength: (w8 >>> 15) & 0x1ffff,
    plyCount: (w7 >>> 22) & 0x3ff,                 // word 7 bits 22-31 (10-bit)
    deleted: !!(w7 & (1 << 3)),
    variant: !!(w4 & 0x80000000),
    result: (w11 >>> 16) & 3,
    eco: w11 & 0xffff,
    gameDate: w5 & 0xfffff,
    whiteElo: (w5 >>> 20) & 0xfff,
    blackElo: (w6 >>> 20) & 0xfff,
    whiteId: w(0) & 0x0fffffff,
    blackId: w(1) & 0x0fffffff,
    eventId: w(2) & 0x0fffffff,
    siteId: w(3) >>> 0,
    roundId: w4 & 0x7fffffff,
  };
}

function rowFromEntry(e, names) {
  return {
    sgOffset: e.sgOffset,
    sgLength: e.sgLength,
    plyCount: e.plyCount,
    deleted: e.deleted,
    variant: e.variant,
    headers: {
      White: names.players[e.whiteId] || '?',
      Black: names.players[e.blackId] || '?',
      Result: RESULTS[e.result] || '*',
      Date: fmtDate(e.gameDate),
      Event: names.events[e.eventId] || '',
      Site: names.sites[e.siteId] || '',
      Round: names.rounds[e.roundId] || '',
      ECO: decodeEco(e.eco),
      WhiteElo: e.whiteElo ? String(e.whiteElo) : '',
      BlackElo: e.blackElo ? String(e.blackElo) : '',
    },
  };
}

// ---- name files -------------------------------------------------------------
// Scid 4 .sn4: 36-byte header then four front-coded sections (player, event,
// site, round). Each record = id · frequency · length · prefix(after the first)
// · suffix; the name = previous name's first `prefix` bytes + the suffix bytes.
function parseNames4(b) {
  const out = { players: [], events: [], sites: [], rounds: [] };
  if (b.length < 36) return out;
  const u24 = (o) => (b[o] << 16) | (b[o + 1] << 8) | b[o + 2];
  const numNames = [u24(12), u24(15), u24(18), u24(21)];
  const maxFreq = [u24(24), u24(27), u24(30), u24(33)];
  const sections = [out.players, out.events, out.sites, out.rounds];
  let p = 36;
  for (let nt = 0; nt < 4; nt += 1) {
    const n = numNames[nt];
    const arr = sections[nt];
    const idBytes = n >= 65536 ? 3 : 2;
    const freqBytes = maxFreq[nt] >= 65536 ? 3 : (maxFreq[nt] >= 256 ? 2 : 1);
    let prev = new Uint8Array(0);
    for (let i = 0; i < n; i += 1) {
      let id = 0;
      for (let k = 0; k < idBytes; k += 1) { id = (id << 8) | b[p]; p += 1; }
      p += freqBytes;                              // frequency — unused here
      const length = b[p]; p += 1;
      const prefix = i > 0 ? b[p] : 0; if (i > 0) p += 1;
      const name = new Uint8Array(length);
      name.set(prev.subarray(0, prefix), 0);
      name.set(b.subarray(p, p + (length - prefix)), prefix);
      p += length - prefix;
      prev = name;
      arr[id] = decodeText(name);
    }
  }
  return out;
}

// Scid 5 .sn5: no header; a run of records, each a LEB128 varint `(len<<3)|type`
// then `len` UTF-8 bytes. IDs are assigned sequentially per type (0..3); type 4
// is database metadata and is ignored.
function parseNames5(b) {
  const out = { players: [], events: [], sites: [], rounds: [] };
  const sections = [out.players, out.events, out.sites, out.rounds];
  const counters = [0, 0, 0, 0];
  let p = 0;
  while (p < b.length) {
    let v = 0;
    let shift = 0;
    let byte;
    do { byte = b[p]; p += 1; v |= (byte & 0x7f) << shift; shift += 7; } while ((byte & 0x80) && p < b.length && shift < 28);
    const type = v & 7;
    const len = v >>> 3;
    const payload = decodeText(b.subarray(p, p + len));
    p += len;
    if (type <= 3) { sections[type][counters[type]] = payload; counters[type] += 1; }
  }
  return out;
}

/**
 * Parse a Scid index + name file into a lazy game list.
 * @param {Uint8Array} si  the .si4/.si5 bytes (whole file)
 * @param {Uint8Array} sn  the .sn4/.sn5 bytes (whole file)
 * @param {number} version 4 or 5
 * @returns {{ version:number, count:number, names:object, row(i):object }}
 */
export function parseScidIndex(si, sn, version) {
  const v5 = version === 5;
  const names = v5 ? parseNames5(sn) : parseNames4(sn);
  const count = v5 ? Math.floor(si.length / SI5_ENTRY) : scid4Count(si);
  const entryAt = v5 ? (i) => scid5Entry(si, i) : (i) => scid4Entry(si, i);
  return {
    version,
    count,
    names,
    row(i) {
      if (i < 0 || i >= count) return null;
      return rowFromEntry(entryAt(i), names);
    },
  };
}

// =============================================================================
// Move decoder (shared by .sg4 and .sg5)
// =============================================================================

const sideIdx = (side) => (side === 'w' ? 0 : 1);

function initState(game, baseFen) {
  const list = [new Array(16).fill(-1), new Array(16).fill(-1)];
  const listPos = new Int16Array(64).fill(-1);
  const count = [0, 0];
  if (!baseFen) {
    for (let n = 0; n < 16; n += 1) {
      list[0][n] = STD_WHITE[n]; listPos[STD_WHITE[n]] = n;
      list[1][n] = STD_BLACK[n]; listPos[STD_BLACK[n]] = n;
    }
    count[0] = 16; count[1] = 16;
  } else {
    const board = game.board(); // row 0 = rank 8, each row a..h
    for (let r = 7; r >= 0; r -= 1) {          // Scid rank index 7 (rank 8) → 0
      for (let f = 0; f < 8; f += 1) {
        const cell = board[7 - r][f];
        if (!cell) continue;
        const c = cell.color === 'w' ? 0 : 1;
        const sq = r * 8 + f;
        if (cell.type === 'k') {               // King is always piece 0
          if (count[c] > 0) { const old = list[c][0]; list[c][count[c]] = old; listPos[old] = count[c]; }
          list[c][0] = sq; listPos[sq] = 0;
        } else {
          list[c][count[c]] = sq; listPos[sq] = count[c];
        }
        count[c] += 1;
      }
    }
  }
  return { list, listPos, count, side: game.turn() };
}

function cloneState(s) {
  return {
    list: [s.list[0].slice(), s.list[1].slice()],
    listPos: s.listPos.slice(),
    count: s.count.slice(),
    side: s.side,
  };
}

// Where does `val` send a piece of `type` sitting on Scid square `from`?
// Returns { to } (+ promo, castle, nullMove), or null if nonsensical. For a
// queen diagonal it consumes a second byte via rd().
function targetSquare(type, from, val, side, rd) {
  switch (type) {
    case 'k':
      if (val >= 1 && val <= 8) return { to: from + KING_DIFF[val] };
      if (val === 9) return { to: from - 2, castle: true };
      if (val === 10) return { to: from + 2, castle: true };
      return { to: from, nullMove: true };          // val 0
    case 'n':
      return (val >= 1 && val <= 8) ? { to: from + KNIGHT_DIFF[val] } : null;
    case 'r':
      return { to: val < 8 ? rankOf(from) * 8 + val : (val - 8) * 8 + fileOf(from) };
    case 'b': {
      const fd = (val & 7) - fileOf(from);
      return { to: val >= 8 ? from - 7 * fd : from + 9 * fd };
    }
    case 'q': {
      if (val >= 8) return { to: (val - 8) * 8 + fileOf(from) };
      if (val !== fileOf(from)) return { to: rankOf(from) * 8 + val };
      const b2 = rd();                               // diagonal → second byte
      return (b2 >= 64 && b2 <= 127) ? { to: b2 - 64 } : null;
    }
    case 'p': {
      const d = PAWN_DIFF[val];
      return { to: side === 'w' ? from + d : from - d, promo: PAWN_PROMO[val] };
    }
    default:
      return null;
  }
}

// Update the Scid piece tables after a move was applied to `game`.
function updateState(state, m, pieceNum, fromSq, toSq) {
  const ci = sideIdx(state.side);
  const ei = ci ^ 1;
  if (m.flags.includes('c') || m.flags.includes('e')) {
    const capSq = m.flags.includes('e') ? (state.side === 'w' ? toSq - 8 : toSq + 8) : toSq;
    const capNum = state.listPos[capSq];
    if (capNum >= 0 && capNum < state.count[ei]) {
      const lastNum = (state.count[ei] -= 1);      // swap last enemy piece into the slot
      const lastSq = state.list[ei][lastNum];
      state.list[ei][capNum] = lastSq;
      state.listPos[lastSq] = capNum;
      state.list[ei][lastNum] = -1;
    }
    if (m.flags.includes('e')) state.listPos[capSq] = -1;
  }
  state.listPos[fromSq] = -1;
  state.list[ci][pieceNum] = toSq;
  state.listPos[toSq] = pieceNum;
  if (m.flags.includes('k') || m.flags.includes('q')) {
    const rookFrom = m.flags.includes('k') ? toSq + 1 : toSq - 2;
    const rookTo = m.flags.includes('k') ? toSq - 1 : toSq + 1;
    const rn = state.listPos[rookFrom];
    if (rn >= 0) { state.listPos[rookFrom] = -1; state.list[ci][rn] = rookTo; state.listPos[rookTo] = rn; }
  }
}

// Decode + apply one move byte. Returns the chess.js move, or null (→ damaged).
function applyMove(game, state, pieceNum, val, rd) {
  const ci = sideIdx(state.side);
  const fromSq = state.list[ci][pieceNum];
  if (fromSq < 0 || fromSq > 63) return null;
  const from = algeb(fromSq);
  const pc = game.get(from);
  if (!pc || pc.color !== state.side) return null;
  const dec = targetSquare(pc.type, fromSq, val, state.side, rd);
  if (!dec || dec.nullMove || dec.to < 0 || dec.to > 63) return null;
  const move = { from, to: algeb(dec.to) };
  if (dec.promo) move.promotion = dec.promo;
  const m = tryMove(game, move);
  if (!m) return null;
  updateState(state, m, pieceNum, fromSq, dec.to);
  state.side = state.side === 'w' ? 'b' : 'w';
  return m;
}

// Read one line (main line or a variation) until an end/variation marker.
// Variations are fully parsed on a cloned state (so multi-byte tokens are
// consumed correctly) but their output is discarded — we keep only the main line.
function decodeLine(rd, snapFen, game, state, sanList, ctx, mainline) {
  let prev = { fen: snapFen(game), state: cloneState(state) };
  for (;;) {
    const byte = rd();
    const pieceNum = byte >> 4;
    const val = byte & 15;
    if (pieceNum === 0 && val >= 11) {
      if (val === 15 || val === 14) return;        // end of game / end of variation
      if (val === 13) {                            // start of a variation
        ctx.hadVar = true;
        decodeLine(rd, snapFen, createGame(prev.fen), cloneState(prev.state), [], ctx, false);
        continue;
      }
      if (val === 11) { const nag = rd(); if (mainline) ctx.nags.push({ ply: sanList.length, nag }); continue; }
      if (val === 12) { if (mainline) ctx.commentMarks.push(sanList.length); continue; }
    }
    const before = { fen: snapFen(game), state: cloneState(state) };
    const m = applyMove(game, state, pieceNum, val, rd);
    if (!m) throw new RangeError('bad move');
    if (mainline) sanList.push(m.san);
    prev = before;
  }
}

/**
 * Decode one game's .sg bytes into its main line.
 * @param {Uint8Array} sg  the game record (exactly offset..offset+length)
 * @param {object} opts { version, variant }
 * @returns {{ sanList, baseFen, comments, nags } | { skipped:string }}
 */
export function decodeGame(sg, opts = {}) {
  if (opts.variant) return { skipped: 'chess960' };
  try {
    const n = sg.length;
    let p = 0;
    const rd = () => { if (p >= n) throw new RangeError('eof'); const v = sg[p]; p += 1; return v; };

    for (;;) {                                     // 1. extra tags → 0x00
      const t = rd();
      if (t === 0) break;
      if (t === 255) p += 3;                       // event date (v4)
      else if (t >= 241 && t <= 250) { p += rd(); } // common tag + value
      else { p += t; p += rd(); }                  // custom name + value
      if (p > n) throw new RangeError('tags');
    }

    const flags = rd();                            // 2. start-board flags
    let baseFen = null;
    if (flags & 1) {                               // 3. custom start → FEN
      const s = p;
      while (p < n && sg[p] !== 0) p += 1;
      baseFen = decodeText(sg.subarray(s, p));
      if (p < n) p += 1;
    }
    if (baseFen && /[A-Ha-h]/.test(baseFen.split(/\s+/)[2] || '')) return { skipped: 'chess960' };

    let game;
    try { game = createGame(baseFen || undefined); } catch { return { skipped: 'badfen' }; }
    const state = initState(game, baseFen);

    const sanList = [];
    const ctx = { nags: [], commentMarks: [], hadVar: false };
    decodeLine(rd, (g) => g.fen(), game, state, sanList, ctx, true); // 4. move stream

    const commentStrings = [];                     // 5. comments section
    while (p < n) {
      const s = p;
      while (p < n && sg[p] !== 0) p += 1;
      commentStrings.push(decodeText(sg.subarray(s, p)));
      if (p < n) p += 1; else break;
    }
    let comments = [];
    if (!ctx.hadVar && ctx.commentMarks.length === commentStrings.length) {
      comments = ctx.commentMarks.map((ply, idx) => ({ ply, text: commentStrings[idx] }));
    }
    return { sanList, baseFen, comments, nags: ctx.nags };
  } catch {
    return { skipped: 'damaged' };
  }
}

// Exposed for the fixture generator (scripts/make-scid-fixture.mjs) and tests —
// not part of the app's runtime surface.
export const _internal = {
  initState, updateState, cloneState, algeb, toScid, fileOf, rankOf,
  KING_DIFF, KNIGHT_DIFF, PAWN_DIFF, PAWN_PROMO, STD_WHITE, STD_BLACK,
  decodeEco, fmtDate, scid4Entry, scid5Entry, parseNames4, parseNames5,
};
