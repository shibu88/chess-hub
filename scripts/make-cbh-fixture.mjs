// Synthesises tiny but REAL ChessBase databases (.cbh/.cbg/.cbp/.cbt) from games
// given as SAN. It inverts the encoders our reader (src/importers/chessbase.js)
// decodes, reusing that module's internals (move tables, CB state helpers) so the
// tricky encoding has a single source of truth. Tests import the `encode*`/`build*`
// helpers to build in-memory fixtures (hermetic — no committed samples); run as a
// CLI it writes a sample set to a directory for manual testing / cross-checking
// against reference/cbh2pgn.
//
//   node scripts/make-cbh-fixture.mjs <out-dir>
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGame } from '../src/shared/rules.js';
import { _internal } from '../src/importers/chessbase.js';

const {
  standardStartState, applyMove, decodeSetupPosition, bitString,
  ONE_BYTE, DEOBFUSCATE_2B,
  W_QUEEN, W_KNIGHT, W_BISHOP, W_ROOK, B_QUEEN, B_KNIGHT, B_BISHOP, B_ROOK,
  W_KING, B_KING, W_PAWN, B_PAWN,
} = _internal;

const ENC = new TextEncoder();

// --- reverse lookups built from the decoder's tables (single source of truth) ---
const BY_CAT = {}; // "kind+nr" → [{ tok, dx, dy }]
for (const [tok, e] of Object.entries(ONE_BYTE)) {
  const key = e.kind + e.nr;
  (BY_CAT[key] ||= []).push({ tok: +tok, dx: e.dx, dy: e.dy });
}
const REOBF_2B = new Array(256);
DEOBFUSCATE_2B.forEach((v, i) => { REOBF_2B[v] = i; });

const KIND_OF = {
  [W_KING]: 'K', [B_KING]: 'K', [W_QUEEN]: 'Q', [B_QUEEN]: 'Q', [W_ROOK]: 'R', [B_ROOK]: 'R',
  [W_BISHOP]: 'B', [B_BISHOP]: 'B', [W_KNIGHT]: 'N', [B_KNIGHT]: 'N', [W_PAWN]: 'P', [B_PAWN]: 'P',
};
const PROMO_CODE = { q: 0, r: 1, b: 2, n: 3 };
const PROMO_CB = (white, code) => [
  white ? W_QUEEN : B_QUEEN, white ? W_ROOK : B_ROOK, white ? W_BISHOP : B_BISHOP, white ? W_KNIGHT : B_KNIGHT,
][code];

const xy = (sqStr) => [sqStr.charCodeAt(0) - 97, sqStr.charCodeAt(1) - 49]; // "e4" → [4,3]

function findToken(kind, nr, fromX, fromY, toX, toY, black) {
  for (const { tok, dx, dy } of (BY_CAT[kind + nr] || [])) {
    const ddx = kind === 'P' && black ? -dx : dx;
    const ddy = kind === 'P' && black ? -dy : dy;
    if ((((fromX + ddx) % 8) + 8) % 8 === toX && (((fromY + ddy) % 8) + 8) % 8 === toY) return tok;
  }
  return null;
}

// Encode one game's .cbg record from a spec: { moves:[san], baseFen? }.
export function encodeGameRecord(spec) {
  const game = createGame(spec.baseFen || undefined);
  let state;
  let header; // 4-byte game header
  let block = []; // optional 28-byte setup block
  if (spec.baseFen) {
    const { setupBlock, pieceState } = fenToSetup(spec.baseFen);
    block = setupBlock;
    state = pieceState;
  } else {
    state = standardStartState();
  }

  const body = [];
  let processed = 0;
  const emit1 = (tkn) => { body.push((tkn + processed) & 255); processed = (processed + 1) & 255; };
  const emit2 = (mv16) => {
    body.push((0x29 + processed) & 255);
    body.push((REOBF_2B[(mv16 >> 8) & 0xff] + processed) & 255);
    body.push((REOBF_2B[mv16 & 0xff] + processed) & 255);
    processed = (processed + 1) & 255;
  };

  for (const san of spec.moves) {
    const m = game.move(san);
    const [fromX, fromY] = xy(m.from);
    const [toX, toY] = xy(m.to);
    const [pieceType, nr] = state.pos[fromX][fromY];
    const kind = KIND_OF[pieceType];
    const black = m.color === 'b';
    const castle = m.flags.includes('k') ? 'K' : (m.flags.includes('q') ? 'Q' : null);

    let promoteType = null;
    if (m.promotion) {
      const code = PROMO_CODE[m.promotion];
      const mv16 = (fromX * 8 + fromY) | ((toX * 8 + toY) << 6) | (code << 12);
      emit2(mv16);
      promoteType = PROMO_CB(!black, code);
    } else {
      const canOneByte = kind === 'K' || kind === 'P' || nr <= 2;
      const tok = canOneByte ? findToken(kind, nr, fromX, fromY, toX, toY, black) : null;
      if (tok != null) {
        emit1(tok);
      } else {
        emit2((fromX * 8 + fromY) | ((toX * 8 + toY) << 6)); // 4th+ piece of a kind
      }
    }
    applyMove(state, pieceType, nr, fromX, fromY, toX, toY, castle, promoteType);
  }
  body.push((0x0c + processed) & 255); // terminating end-of-game

  const moveBytes = Uint8Array.from(body);
  const setupLen = block.length; // 0 or 28
  const len = 4 + setupLen + moveBytes.length;
  const flags = spec.baseFen ? 0x40000000 : 0;
  const h = (flags | (len & 0x00ffffff)) >>> 0;
  header = [(h >>> 24) & 255, (h >>> 16) & 255, (h >>> 8) & 255, h & 255];
  const sg = Uint8Array.from([...header, ...block, ...moveBytes]);
  return { sg, moveBytes, hasFen: !!spec.baseFen };
}

// FEN → { setupBlock (28 bytes from record[4]), pieceState (matches the decoder) }.
function fenToSetup(fen) {
  const [board, turn, castling = '-', ep = '-', , fullmove = '1'] = fen.split(/\s+/);
  const FEN_TYPE = { K: W_KING, Q: W_QUEEN, R: W_ROOK, B: W_BISHOP, N: W_KNIGHT, P: W_PAWN, k: B_KING, q: B_QUEEN, r: B_ROOK, b: B_BISHOP, n: B_KNIGHT, p: B_PAWN };
  const CODE = { [W_KING]: '10001', [W_QUEEN]: '10010', [W_KNIGHT]: '10011', [W_BISHOP]: '10100', [W_ROOK]: '10101', [W_PAWN]: '10110', [B_KING]: '11001', [B_QUEEN]: '11010', [B_KNIGHT]: '11011', [B_BISHOP]: '11100', [B_ROOK]: '11101', [B_PAWN]: '11110' };
  // grid[file][rank] = type or 0
  const grid = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => 0));
  const rows = board.split('/'); // rows[0] = rank 8
  rows.forEach((row, ri) => {
    const rank = 7 - ri;
    let file = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) { file += Number(ch); continue; }
      grid[file][rank] = FEN_TYPE[ch];
      file += 1;
    }
  });
  // bitstream over absolute squares (file*8 + rank), a1,a2,…,a8,b1,…
  let bits = '';
  for (let b = 0; b < 64; b += 1) {
    const type = grid[b >> 3][b & 7];
    bits += type ? CODE[type] : '0';
  }
  const bitBytes = new Uint8Array(24);
  for (let i = 0; i < bits.length && i < 192; i += 1) if (bits[i] === '1') bitBytes[i >> 3] |= 128 >> (i & 7);

  const epFile = ep === '-' ? 0 : (ep.charCodeAt(0) - 96); // a→1
  const blackToMove = turn === 'b' ? 1 : 0;
  const ws = castling.includes('K') ? 1 : 0;
  const wl = castling.includes('Q') ? 1 : 0;
  const bs = castling.includes('k') ? 1 : 0;
  const bl = castling.includes('q') ? 1 : 0;
  const b5 = (epFile & 7) | (blackToMove << 4);
  const b6 = wl | (ws << 1) | (bl << 2) | (bs << 3);
  const b7 = Number(fullmove) & 255;
  const setupBlock = [0, b5, b6, b7, ...bitBytes]; // record[4..32]
  const pieceState = decodeSetupPosition(bitString(bitBytes)); // same numbering the decoder uses
  return { setupBlock, pieceState };
}

// --- .cbp / .cbt / .cbh encoders ---------------------------------------------
function splitName(full) {
  const i = full.indexOf(', ');
  return i < 0 ? [full, ''] : [full.slice(0, i), full.slice(i + 2)];
}
function writeField(rec, off, str, max) {
  const b = ENC.encode(str).subarray(0, max);
  rec.set(b, off);
}
function encodePlayers(names) {
  const start = 28;
  const out = new Uint8Array(start + names.length * 67);
  out[0x18] = 0; // version → start 28
  names.forEach((name, id) => {
    const o = start + id * 67;
    const [last, first] = splitName(name);
    writeField(out, o + 9, last, 30);
    writeField(out, o + 39, first, 20);
  });
  return out;
}
function encodeTournaments(tours) {
  const start = 28;
  const out = new Uint8Array(start + tours.length * 99);
  out[0x18] = 0;
  tours.forEach(({ event, site }, id) => {
    const o = start + id * 99;
    writeField(out, o + 9, event, 40);
    writeField(out, o + 49, site, 30);
  });
  return out;
}

const RESULT_CODE = { '0-1': 0, '1/2-1/2': 1, '1-0': 2, '*': 3 };
function packDate(str) {
  const m = /^(\d{4})\.(\d{2})\.(\d{2})$/.exec(str || '');
  if (!m) return 0;
  return (Number(m[1]) << 9) | (Number(m[2]) << 5) | Number(m[3]);
}

function encodeIndex(entries) {
  const out = new Uint8Array(46 * (entries.length + 1));
  out.set([0x00, 0x00, 0x2c, 0x00, 0x2e, 0x01], 0); // record 0 = DB header (CB9+ magic)
  entries.forEach((e, i) => {
    const o = 46 * (i + 1);
    out[o] = (e.isText ? 0 : 0x01) | (e.deleted ? 0x80 : 0);
    out[o + 1] = (e.sgOffset >>> 24) & 255; out[o + 2] = (e.sgOffset >>> 16) & 255;
    out[o + 3] = (e.sgOffset >>> 8) & 255; out[o + 4] = e.sgOffset & 255;
    const u24 = (off, v) => { out[off] = (v >> 16) & 255; out[off + 1] = (v >> 8) & 255; out[off + 2] = v & 255; };
    u24(o + 9, e.whiteId); u24(o + 12, e.blackId); u24(o + 15, e.tournId);
    u24(o + 24, e.date);
    out[o + 27] = e.result;
    out[o + 29] = e.round; out[o + 30] = e.subround;
    out[o + 31] = (e.whiteElo >> 8) & 255; out[o + 32] = e.whiteElo & 255;
    out[o + 33] = (e.blackElo >> 8) & 255; out[o + 34] = e.blackElo & 255;
  });
  return out;
}

/**
 * Build a whole ChessBase database from games.
 * @param {Array} games  [{ headers, record:{sg}, deleted?, isText? }]
 * @returns {{ cbh, cbg, cbp, cbt }}
 */
export function buildDatabase(games) {
  const players = [];
  const tours = [];
  const idOf = (arr, key, make) => { let i = arr.findIndex((x) => x.key === key); if (i < 0) { i = arr.length; arr.push({ key, ...make() }); } return i; };
  const sgParts = [];
  let offset = 0;
  const entries = games.map((g) => {
    const h = g.headers;
    const sg = g.record.sg;
    const [r, sub] = (h.Round || '').split('.');
    const e = {
      sgOffset: offset,
      deleted: !!g.deleted,
      isText: !!g.isText,
      whiteId: idOf(players, `p:${h.White || ''}`, () => ({ name: h.White || '' })),
      blackId: idOf(players, `p:${h.Black || ''}`, () => ({ name: h.Black || '' })),
      tournId: idOf(tours, `t:${h.Event || ''}|${h.Site || ''}`, () => ({ event: h.Event || '', site: h.Site || '' })),
      date: packDate(h.Date),
      result: RESULT_CODE[h.Result] ?? 3,
      round: Number(r) || 0,
      subround: Number(sub) || 0,
      whiteElo: Number(h.WhiteElo) || 0,
      blackElo: Number(h.BlackElo) || 0,
    };
    sgParts.push(sg);
    offset += sg.length;
    return e;
  });
  const cbg = (() => { const total = sgParts.reduce((s, a) => s + a.length, 0); const b = new Uint8Array(total); let o = 0; for (const a of sgParts) { b.set(a, o); o += a.length; } return b; })();
  return {
    cbh: encodeIndex(entries),
    cbg,
    cbp: encodePlayers(players.map((p) => p.name)),
    cbt: encodeTournaments(tours.map((t) => ({ event: t.event, site: t.site }))),
  };
}

// A small, representative set of games used by both the CLI and the unit tests.
export function sampleGames() {
  return [
    {
      headers: { White: 'Carlsen, Magnus', Black: 'Nakamura, Hikaru', Result: '1-0', Date: '2019.06.01', Event: 'Test Masters', Site: 'Leon ESP', Round: '1', WhiteElo: '2875', BlackElo: '2789' },
      record: encodeGameRecord({ moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'Nf6', 'O-O', 'Nxe4', 'd4', 'Nd6'] }),
    },
    {
      headers: { White: 'Short, Nigel', Black: 'Kramnik, Vladimir', Result: '1/2-1/2', Date: '2001.12.24', Event: 'London Classic', Site: 'London ENG', Round: '2.1' },
      record: encodeGameRecord({ moves: ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6', 'Bg5', 'Be7'] }),
    },
  ];
}

// ---- CLI --------------------------------------------------------------------
function writeSet(dir, base) {
  const { cbh, cbg, cbp, cbt } = buildDatabase(sampleGames());
  writeFileSync(join(dir, `${base}.cbh`), cbh);
  writeFileSync(join(dir, `${base}.cbg`), cbg);
  writeFileSync(join(dir, `${base}.cbp`), cbp);
  writeFileSync(join(dir, `${base}.cbt`), cbt);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dir = process.argv[2] || '.';
  mkdirSync(dir, { recursive: true });
  writeSet(dir, 'sample');
  console.log(`Wrote sample.cbh/.cbg/.cbp/.cbt to ${dir}`);
}
