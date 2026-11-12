// Our own reader for ChessBase databases (.cbh index, .cbg games, .cbp players,
// .cbt tournaments). Pure — no DOM, no worker — so it's unit-tested directly and
// reused by src/analysis/chessbase-worker.js. Byte layouts + the move decoder are
// a JavaScript port of asdfjkl/cbh2pgn (MIT), with python-chess replaced by our
// chess.js wrapper (src/shared/rules.js) for legality + SAN.
//
//   cbh2pgn converter — Copyright (c) 2022 Dominik Klein — Licensed under MIT.
//   Ported move tables (CB_*_ENC, DEOBFUSCATE_2B) and the decode algorithm come
//   from that project; see reference/cbh2pgn and THIRD_PARTY_NOTICES.md.
//
// We produce the same shape the PGN/Scid readers produce — list rows with
// { headers, sgOffset } and decodeGame() → { sanList, baseFen } — so Review, Save
// and Download PGN (src/analysis/pgn-export.js) all work unchanged.
import { createGame, tryMove, FILES } from '../shared/rules.js';

// ---- text (UTF-8, falling back to Latin-1 for older files) ------------------
const UTF8 = new TextDecoder('utf-8', { fatal: true });
const LATIN1 = new TextDecoder('latin1');
function decodeText(bytes) {
  // ChessBase strings are null-terminated inside a fixed field; cut at the first null.
  let end = bytes.indexOf(0);
  if (end < 0) end = bytes.length;
  const slice = bytes.subarray(0, end);
  let s;
  try { s = UTF8.decode(slice); } catch { s = LATIN1.decode(slice); }
  return s.replace(/[\u0000-\u001f]/g, '').trim();
}

// piece-type codes (match cbh2pgn): white 1-4, black 5-8, kings 9/10, pawns 11/12
const W_QUEEN = 1; const W_KNIGHT = 2; const W_BISHOP = 3; const W_ROOK = 4;
const B_QUEEN = 5; const B_KNIGHT = 6; const B_BISHOP = 7; const B_ROOK = 8;
const W_KING = 9; const B_KING = 10; const W_PAWN = 11; const B_PAWN = 12;

const sq = (x, y) => FILES[x] + (y + 1); // (file 0..7, rank 0..7) → "e4"

// =============================================================================
// Move-value tables (ported verbatim from cbh2pgn game.py)
// Each entry: token byte → [dx, dy] applied to the piece's (file,rank), mod 8.
// =============================================================================
const CB_KING = { 0x49: [0, 1], 0x39: [1, 1], 0xD8: [1, 0], 0x5D: [1, 7], 0xC2: [0, 7], 0xB1: [7, 7], 0xB2: [7, 0], 0x47: [7, 1], 0x76: [2, 0], 0xB5: [-2, 0] };
const CB_QUEEN_1 = { 0xA5: [0, 1], 0xB8: [0, 2], 0xCB: [0, 3], 0x53: [0, 4], 0x7F: [0, 5], 0x6B: [0, 6], 0x8D: [0, 7], 0x79: [1, 0], 0xBE: [2, 0], 0xEB: [3, 0], 0x21: [4, 0], 0x99: [5, 0], 0xD2: [6, 0], 0x57: [7, 0], 0x4D: [1, 1], 0xB4: [2, 2], 0xBF: [3, 3], 0x62: [4, 4], 0xBD: [5, 5], 0x24: [6, 6], 0x96: [7, 7], 0xA7: [1, 7], 0x48: [2, 6], 0x28: [3, 5], 0x6E: [4, 4], 0x2F: [5, 3], 0x5A: [6, 2], 0x18: [7, 1] };
const CB_QUEEN_2 = { 0xE5: [0, 1], 0x94: [0, 2], 0x50: [0, 3], 0x11: [0, 4], 0xEA: [0, 5], 0x31: [0, 6], 0x01: [0, 7], 0x5C: [1, 0], 0x95: [2, 0], 0xCA: [3, 0], 0xD3: [4, 0], 0x1D: [5, 0], 0x7E: [6, 0], 0xEF: [7, 0], 0x44: [1, 1], 0x80: [2, 2], 0xA0: [3, 3], 0x1F: [4, 4], 0x83: [5, 5], 0x00: [6, 6], 0x4B: [7, 7], 0x67: [1, 7], 0x20: [2, 6], 0x5B: [3, 5], 0x2A: [4, 4], 0x92: [5, 3], 0xB6: [6, 2], 0x60: [7, 1] };
const CB_QUEEN_3 = { 0x1A: [0, 1], 0x42: [0, 2], 0x0F: [0, 3], 0x0D: [0, 4], 0xB0: [0, 5], 0xD1: [0, 6], 0x23: [0, 7], 0xF0: [1, 0], 0x7A: [2, 0], 0x54: [3, 0], 0x4F: [4, 0], 0xF4: [5, 0], 0xA8: [6, 0], 0x72: [7, 0], 0xE7: [1, 1], 0x40: [2, 2], 0x38: [3, 3], 0x59: [4, 4], 0x87: [5, 5], 0xE8: [6, 6], 0x6C: [7, 7], 0x86: [1, 7], 0x04: [2, 6], 0xF1: [3, 5], 0x8C: [4, 4], 0xCE: [5, 3], 0x6A: [6, 2], 0xDB: [7, 1] };
const CB_ROOK_1 = { 0x4E: [0, 1], 0xF8: [0, 2], 0x43: [0, 3], 0xD7: [0, 4], 0x63: [0, 5], 0x9C: [0, 6], 0xE6: [0, 7], 0x2E: [1, 0], 0xC6: [2, 0], 0x26: [3, 0], 0x88: [4, 0], 0x30: [5, 0], 0x61: [6, 0], 0x6F: [7, 0] };
const CB_ROOK_2 = { 0x14: [0, 1], 0xA9: [0, 2], 0x68: [0, 3], 0xEE: [0, 4], 0xFB: [0, 5], 0x77: [0, 6], 0xE2: [0, 7], 0xA6: [1, 0], 0x05: [2, 0], 0x8B: [3, 0], 0xA1: [4, 0], 0x98: [5, 0], 0x32: [6, 0], 0x52: [7, 0] };
const CB_ROOK_3 = { 0x81: [0, 1], 0x82: [0, 2], 0x9A: [0, 3], 0x1B: [0, 4], 0x9D: [0, 5], 0x0A: [0, 6], 0x2B: [0, 7], 0x8F: [1, 0], 0xCD: [2, 0], 0xED: [3, 0], 0x10: [4, 0], 0x74: [5, 0], 0x69: [6, 0], 0xD6: [7, 0] };
const CB_BISHOP_1 = { 0x02: [1, 1], 0x97: [2, 2], 0xE1: [3, 3], 0x41: [4, 4], 0xC3: [5, 5], 0x7C: [6, 6], 0xE4: [7, 7], 0x06: [1, 7], 0xB7: [2, 6], 0x55: [3, 5], 0xD9: [4, 4], 0x2C: [5, 3], 0xAE: [6, 2], 0x37: [7, 1] };
const CB_BISHOP_2 = { 0xF6: [1, 1], 0x3F: [2, 2], 0x08: [3, 3], 0x93: [4, 4], 0x73: [5, 5], 0x5E: [6, 6], 0x78: [7, 7], 0x35: [1, 7], 0xF2: [2, 6], 0x6D: [3, 5], 0x71: [4, 4], 0xA2: [5, 3], 0xF3: [6, 2], 0x16: [7, 1] };
const CB_BISHOP_3 = { 0x51: [1, 1], 0xB9: [2, 2], 0x45: [3, 3], 0x3B: [4, 4], 0x56: [5, 5], 0x91: [6, 6], 0xFD: [7, 7], 0xAB: [1, 7], 0x66: [2, 6], 0x3E: [3, 5], 0x46: [4, 4], 0xB3: [5, 3], 0xFC: [6, 2], 0xC8: [7, 1] };
const CB_KNIGHT_1 = { 0x58: [2, 1], 0x3D: [1, 2], 0xFA: [-1, 2], 0xE9: [-2, 1], 0xBA: [-2, -1], 0xD4: [-1, -2], 0xDD: [1, -2], 0x4A: [2, -1] };
const CB_KNIGHT_2 = { 0xC4: [2, 1], 0x0E: [1, 2], 0xFE: [-1, 2], 0x5F: [-2, 1], 0x75: [-2, -1], 0x07: [-1, -2], 0x89: [1, -2], 0x34: [2, -1] };
const CB_KNIGHT_3 = { 0x9B: [2, 1], 0xC0: [1, 2], 0xE3: [-1, 2], 0xA3: [-2, 1], 0xAC: [-2, -1], 0xC9: [-1, -2], 0xEC: [1, -2], 0x27: [2, -1] };
const CB_PAWN_A = { 0x2D: [0, 1], 0xC1: [0, 2], 0x8E: [1, 1], 0xF5: [-1, 1] };
const CB_PAWN_B = { 0x64: [0, 1], 0x17: [0, 2], 0x70: [1, 1], 0xA4: [-1, 1] };
const CB_PAWN_C = { 0x7B: [0, 1], 0xDA: [0, 2], 0xE0: [1, 1], 0x85: [-1, 1] };
const CB_PAWN_D = { 0xC5: [0, 1], 0x0B: [0, 2], 0x90: [1, 1], 0xF9: [-1, 1] };
const CB_PAWN_E = { 0x84: [0, 1], 0xFF: [0, 2], 0x15: [1, 1], 0x36: [-1, 1] };
const CB_PAWN_F = { 0x09: [0, 1], 0x9E: [0, 2], 0x7D: [1, 1], 0xDE: [-1, 1] };
const CB_PAWN_G = { 0xBB: [0, 1], 0xDF: [0, 2], 0xBC: [1, 1], 0x3A: [-1, 1] };
const CB_PAWN_H = { 0x12: [0, 1], 0x33: [0, 2], 0x13: [1, 1], 0x19: [-1, 1] };

// token → { kind, nr, dx, dy }. kinds: K,Q,R,B,N,P. nr = which piece of that kind
// (0 king; 0/1/2 for Q/R/B/N; 0..7 for pawns by original file). Byte sets are disjoint.
const ONE_BYTE = {};
const addTable = (tbl, kind, nr) => { for (const k of Object.keys(tbl)) { const [dx, dy] = tbl[k]; ONE_BYTE[+k] = { kind, nr, dx, dy }; } };
addTable(CB_KING, 'K', 0);
addTable(CB_QUEEN_1, 'Q', 0); addTable(CB_QUEEN_2, 'Q', 1); addTable(CB_QUEEN_3, 'Q', 2);
addTable(CB_ROOK_1, 'R', 0); addTable(CB_ROOK_2, 'R', 1); addTable(CB_ROOK_3, 'R', 2);
addTable(CB_BISHOP_1, 'B', 0); addTable(CB_BISHOP_2, 'B', 1); addTable(CB_BISHOP_3, 'B', 2);
addTable(CB_KNIGHT_1, 'N', 0); addTable(CB_KNIGHT_2, 'N', 1); addTable(CB_KNIGHT_3, 'N', 2);
[CB_PAWN_A, CB_PAWN_B, CB_PAWN_C, CB_PAWN_D, CB_PAWN_E, CB_PAWN_F, CB_PAWN_G, CB_PAWN_H]
  .forEach((tbl, i) => addTable(tbl, 'P', i));

// 256-entry de-obfuscation table for two-byte moves (ported from cbh2pgn).
const DEOBFUSCATE_2B = [
  0xA2, 0x95, 0x43, 0xF5, 0xC1, 0x3D, 0x4A, 0x6C, 0x53, 0x83, 0xCC, 0x7C, 0xFF, 0xAE, 0x68, 0xAD,
  0xD1, 0x92, 0x8B, 0x8D, 0x35, 0x81, 0x5E, 0x74, 0x26, 0x8E, 0xAB, 0xCA, 0xFD, 0x9A, 0xF3, 0xA0,
  0xA5, 0x15, 0xFC, 0xB1, 0x1E, 0xED, 0x30, 0xEA, 0x22, 0xEB, 0xA7, 0xCD, 0x4E, 0x6F, 0x2E, 0x24,
  0x32, 0x94, 0x41, 0x8C, 0x6E, 0x58, 0x82, 0x50, 0xBB, 0x02, 0x8A, 0xD8, 0xFA, 0x60, 0xDE, 0x52,
  0xBA, 0x46, 0xAC, 0x29, 0x9D, 0xD7, 0xDF, 0x08, 0x21, 0x01, 0x66, 0xA3, 0xF1, 0x19, 0x27, 0xB5,
  0x91, 0xD5, 0x42, 0x0E, 0xB4, 0x4C, 0xD9, 0x18, 0x5F, 0xBC, 0x25, 0xA6, 0x96, 0x04, 0x56, 0x6A,
  0xAA, 0x33, 0x1C, 0x2B, 0x73, 0xF0, 0xDD, 0xA4, 0x37, 0xD3, 0xC5, 0x10, 0xBF, 0x5A, 0x23, 0x34,
  0x75, 0x5B, 0xB8, 0x55, 0xD2, 0x6B, 0x09, 0x3A, 0x57, 0x12, 0xB3, 0x77, 0x48, 0x85, 0x9B, 0x0F,
  0x9E, 0xC7, 0xC8, 0xA1, 0x7F, 0x7A, 0xC0, 0xBD, 0x31, 0x6D, 0xF6, 0x3E, 0xC3, 0x11, 0x71, 0xCE,
  0x7D, 0xDA, 0xA8, 0x54, 0x90, 0x97, 0x1F, 0x44, 0x40, 0x16, 0xC9, 0xE3, 0x2C, 0xCB, 0x84, 0xEC,
  0x9F, 0x3F, 0x5C, 0xE6, 0x76, 0x0B, 0x3C, 0x20, 0xB7, 0x36, 0x00, 0xDC, 0xE7, 0xF9, 0x4F, 0xF7,
  0xAF, 0x06, 0x07, 0xE0, 0x1A, 0x0A, 0xA9, 0x4B, 0x0C, 0xD6, 0x63, 0x87, 0x89, 0x1D, 0x13, 0x1B,
  0xE4, 0x70, 0x05, 0x47, 0x67, 0x7B, 0x2F, 0xEE, 0xE2, 0xE8, 0x98, 0x0D, 0xEF, 0xCF, 0xC4, 0xF4,
  0xFB, 0xB0, 0x17, 0x99, 0x64, 0xF2, 0xD4, 0x2A, 0x03, 0x4D, 0x78, 0xC6, 0xFE, 0x65, 0x86, 0x88,
  0x79, 0x45, 0x3B, 0xE5, 0x49, 0x8F, 0x2D, 0xB9, 0xBE, 0x62, 0x93, 0x14, 0xE9, 0xD0, 0x38, 0x9C,
  0xB2, 0xC2, 0x59, 0x5D, 0xB6, 0x72, 0x51, 0xF8, 0x28, 0x7E, 0x61, 0x39, 0xE1, 0xDB, 0x69, 0x80,
];

const PROMO_TYPE = (pawnType, code) => {
  const white = pawnType === W_PAWN;
  return [white ? W_QUEEN : B_QUEEN, white ? W_ROOK : B_ROOK, white ? W_BISHOP : B_BISHOP, white ? W_KNIGHT : B_KNIGHT][code];
};
const pickType = (kind, white) => ({
  K: white ? W_KING : B_KING, Q: white ? W_QUEEN : B_QUEEN, R: white ? W_ROOK : B_ROOK,
  B: white ? W_BISHOP : B_BISHOP, N: white ? W_KNIGHT : B_KNIGHT, P: white ? W_PAWN : B_PAWN,
}[kind]);

// =============================================================================
// CB board state: pos[file][rank] = [type, nr]; list[type] = [[x,y]|null, …]
// =============================================================================
function emptyState() {
  const pos = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => [0, null]));
  const list = Array.from({ length: 13 }, () => [null, null, null, null, null, null, null, null]);
  return { pos, list };
}

function placeFromList(state) {
  for (let t = 1; t <= 12; t += 1) {
    for (let nr = 0; nr < state.list[t].length; nr += 1) {
      const c = state.list[t][nr];
      if (c) state.pos[c[0]][c[1]] = [t, nr];
    }
  }
}

// Standard start: numbering matches cbh2pgn (queens/rooks/… by file order; pawns a-h).
function standardStartState() {
  const s = emptyState();
  s.list[W_QUEEN] = [[3, 0], null, null, null, null, null, null, null];
  s.list[W_KNIGHT] = [[1, 0], [6, 0], null, null, null, null, null, null];
  s.list[W_BISHOP] = [[2, 0], [5, 0], null, null, null, null, null, null];
  s.list[W_ROOK] = [[0, 0], [7, 0], null, null, null, null, null, null];
  s.list[B_QUEEN] = [[3, 7], null, null, null, null, null, null, null];
  s.list[B_KNIGHT] = [[1, 7], [6, 7], null, null, null, null, null, null];
  s.list[B_BISHOP] = [[2, 7], [5, 7], null, null, null, null, null, null];
  s.list[B_ROOK] = [[0, 7], [7, 7], null, null, null, null, null, null];
  s.list[W_KING] = [[4, 0], null, null, null, null, null, null, null];
  s.list[B_KING] = [[4, 7], null, null, null, null, null, null, null];
  s.list[W_PAWN] = [0, 1, 2, 3, 4, 5, 6, 7].map((f) => [f, 1]);
  s.list[B_PAWN] = [0, 1, 2, 3, 4, 5, 6, 7].map((f) => [f, 6]);
  placeFromList(s);
  return s;
}

function cloneState(s) {
  return { pos: s.pos.map((col) => col.map((c) => c.slice())), list: s.list.map((a) => a.map((c) => (c ? c.slice() : null))) };
}

// A captured non-king, non-pawn piece: shift higher numbers of its kind down one.
function decreasePieceNr(state, type, nr) {
  for (let k = nr; k < 7; k += 1) state.list[type][k] = state.list[type][k + 1];
  state.list[type][7] = null;
  for (let x = 0; x < 8; x += 1) for (let y = 0; y < 8; y += 1) {
    const [p, t] = state.pos[x][y];
    if (p === type && t > nr) state.pos[x][y] = [p, t - 1];
  }
}

// Mutate CB state for one move (shared by decoder and the fixture encoder).
// castle: 'K' | 'Q' | null; promoteType: a CB piece-type for a promotion, else null.
function applyMove(state, pieceType, nr, fromX, fromY, toX, toY, castle, promoteType) {
  state.pos[fromX][fromY] = [0, null];
  const [tt, tn] = state.pos[toX][toY];
  if (tt !== 0 && tt !== W_KING && tt !== B_KING && tt !== W_PAWN && tt !== B_PAWN) decreasePieceNr(state, tt, tn);
  if (promoteType) {
    let free = state.list[promoteType].findIndex((c) => c === null);
    if (free < 0) free = state.list[promoteType].length;
    state.list[promoteType][free] = [toX, toY];
    state.pos[toX][toY] = [promoteType, free];
  } else {
    state.pos[toX][toY] = [pieceType, nr];
    state.list[pieceType][nr] = [toX, toY];
  }
  if (castle) {
    const rookType = pieceType === W_KING ? W_ROOK : B_ROOK;
    const rank = pieceType === W_KING ? 0 : 7;
    const rookFromX = castle === 'K' ? 7 : 0;
    const rookToX = castle === 'K' ? 5 : 3;
    state.pos[rookFromX][rank] = [0, null];
    const idx = state.list[rookType].findIndex((c) => c && c[0] === rookFromX && c[1] === rank);
    if (idx >= 0) { state.list[rookType][idx] = [rookToX, rank]; state.pos[rookToX][rank] = [rookType, idx]; }
  }
}

// =============================================================================
// Setup positions (games that don't start from the initial position)
// =============================================================================
const SETUP_CODE = {
  '10001': W_KING, '10010': W_QUEEN, '10011': W_KNIGHT, '10100': W_BISHOP, '10101': W_ROOK, '10110': W_PAWN,
  '11001': B_KING, '11010': B_QUEEN, '11011': B_KNIGHT, '11100': B_BISHOP, '11101': B_ROOK, '11110': B_PAWN,
};
const FEN_CHAR = { [W_KING]: 'K', [W_QUEEN]: 'Q', [W_ROOK]: 'R', [W_BISHOP]: 'B', [W_KNIGHT]: 'N', [W_PAWN]: 'P', [B_KING]: 'k', [B_QUEEN]: 'q', [B_ROOK]: 'r', [B_BISHOP]: 'b', [B_KNIGHT]: 'n', [B_PAWN]: 'p' };

function bitString(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 1) s += bytes[i].toString(2).padStart(8, '0');
  return s;
}

// Walk the setup bitstream: '0' = empty square, '1' begins a 5-bit piece code.
// Squares are visited in absolute order (a1,a2,…,a8,b1,…) → (file,rank).
function decodeSetupPosition(bits) {
  const state = emptyState();
  let si = 0;
  let b = 0;
  while (si < bits.length && b < 64) {
    if (bits[si] === '0') { si += 1; b += 1; continue; }
    if (bits.length - si < 5) throw new RangeError('setup');
    const code = bits.slice(si, si + 5);
    const type = SETUP_CODE[code];
    if (!type) throw new RangeError('setup piece');
    const x = b >> 3;
    const y = b & 7;
    state.list[type].push([x, y]); // temporary: appended in discovery order
    si += 5;
    b += 1;
  }
  // rebuild fixed-length lists, keeping discovery order as the piece numbering
  const fixed = emptyState();
  for (let t = 1; t <= 12; t += 1) {
    const coords = state.list[t].filter(Boolean);
    const arr = [null, null, null, null, null, null, null, null];
    coords.forEach((c, i) => { if (i < 8) arr[i] = c; });
    fixed.list[t] = arr;
  }
  placeFromList(fixed);
  return fixed;
}

function stateToFen(state, epFile, blackToMove, wl, ws, bl, bs, nextMoveNo) {
  let board = '';
  for (let r = 7; r >= 0; r -= 1) {
    let gap = 0;
    for (let f = 0; f < 8; f += 1) {
      const [t] = state.pos[f][r];
      if (t === 0) { gap += 1; continue; }
      if (gap) { board += gap; gap = 0; }
      board += FEN_CHAR[t];
    }
    if (gap) board += gap;
    if (r > 0) board += '/';
  }
  let castle = '';
  if (ws) castle += 'K';
  if (wl) castle += 'Q';
  if (bs) castle += 'k';
  if (bl) castle += 'q';
  if (!castle) castle = '-';
  let ep = '-';
  if (epFile > 0) ep = FILES[epFile - 1] + (blackToMove ? '3' : '6');
  return `${board} ${blackToMove ? 'b' : 'w'} ${castle} ${ep} 0 ${nextMoveNo || 1}`;
}

// =============================================================================
// Move stream decoder
// =============================================================================
const SPECIAL = new Set([0x29, 0xDC, 0x0C, 0x9F]);

/**
 * Decode the move bytes of one game into its main line.
 * @param {Uint8Array} moveBytes  the move stream (after the header/setup block)
 * @param {object} state  CB board state at the start position
 * @param {string|undefined} fen  start FEN (undefined = standard start)
 * @returns {{ sanList:string[] }}  throws RangeError on a corrupt stream
 */
function decodeMoves(moveBytes, state, fen) {
  const game = createGame(fen || undefined);
  const sanList = [];
  const n = moveBytes.length;
  let processed = 0;
  let idx = 0;
  let depth = 0;
  const deob = (raw) => (((raw - processed) % 256) + 256) % 256;

  while (idx < n) {
    const tkn = deob(moveBytes[idx]);
    if (!SPECIAL.has(tkn)) processed = (processed + 1) & 255;

    if (tkn === 0x9F) { idx += 1; continue; }        // filler
    if (tkn === 0xAA) { idx += 1; continue; }         // null move (skipped in our main line)

    if (tkn === 0x29) {                               // two-byte move
      if (idx + 2 >= n) throw new RangeError('2b eof');
      const b1 = DEOBFUSCATE_2B[deob(moveBytes[idx + 1])];
      const b2 = DEOBFUSCATE_2B[deob(moveBytes[idx + 2])];
      const mv = (b1 << 8) | b2;
      if (depth === 0) {
        const fromX = (mv & 0x3f) >> 3; const fromY = (mv & 0x3f) & 7;
        const toX = ((mv >> 6) & 0x3f) >> 3; const toY = ((mv >> 6) & 0x3f) & 7;
        const code = (mv >> 12) & 3;
        const [pt, pnr] = state.pos[fromX][fromY];
        if (!pt) throw new RangeError('2b empty');
        const isPawn = pt === W_PAWN || pt === B_PAWN;
        const promoteType = (isPawn && (toY === 7 || toY === 0)) ? PROMO_TYPE(pt, code) : null;
        const move = { from: sq(fromX, fromY), to: sq(toX, toY) };
        if (promoteType) move.promotion = FEN_CHAR[promoteType].toLowerCase();
        const m = tryMove(game, move);
        if (!m) throw new RangeError('2b illegal');
        applyMove(state, pt, pnr, fromX, fromY, toX, toY, null, promoteType);
        sanList.push(m.san);
      }
      processed = (processed + 1) & 255;
      idx += 3;
      continue;
    }

    if (tkn === 0xDC) { depth += 1; idx += 1; continue; }   // start variation
    if (tkn === 0x0C) {                                     // end variation / end game
      if (depth > 0) { depth -= 1; idx += 1; continue; }
      break;                                                // the final 0x0C ends the game
    }

    const entry = ONE_BYTE[tkn];
    if (!entry) { idx += 1; continue; }               // unknown token → no-op (cbh2pgn)
    if (depth === 0) {
      const white = game.turn() === 'w';
      const pieceType = pickType(entry.kind, white);
      const loc = state.list[pieceType][entry.nr];
      if (!loc) throw new RangeError('no piece');
      const [fromX, fromY] = loc;
      let dx = entry.dx; let dy = entry.dy;
      if (entry.kind === 'P' && !white) { dx = -dx; dy = -dy; }
      const toX = (((fromX + dx) % 8) + 8) % 8;
      const toY = (((fromY + dy) % 8) + 8) % 8;
      const m = tryMove(game, { from: sq(fromX, fromY), to: sq(toX, toY) });
      if (!m) throw new RangeError('illegal');
      const castle = entry.kind === 'K' && entry.dx === 2 ? 'K' : (entry.kind === 'K' && entry.dx === -2 ? 'Q' : null);
      applyMove(state, pieceType, entry.nr, fromX, fromY, toX, toY, castle, null);
      sanList.push(m.san);
    }
    idx += 1;
  }
  return { sanList };
}

// game-record flag bits in the leading u32 of a .cbg game
const F_NOT_ENCODED = 0x80000000;
const F_SETUP = 0x40000000;
const F_SPECIAL = 0x04000000;
const F_960 = 0x0A000000;
const F_LEN = 0x00FFFFFF;

/** Read a game record's declared length (bytes) from its first 4 bytes. */
export function gameRecordLength(bytes) {
  if (bytes.length < 4) return 0;
  const h = ((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
  return h & F_LEN;
}

/**
 * Decode one game's .cbg record into its main line.
 * @param {Uint8Array} record  the game bytes from its offset (length ≥ its declared length)
 * @returns {{ sanList, baseFen } | { skipped:string }}
 */
export function decodeGame(record) {
  try {
    if (record.length < 4) return { skipped: 'damaged' };
    const h = ((record[0] << 24) | (record[1] << 16) | (record[2] << 8) | record[3]) >>> 0;
    if (h & F_NOT_ENCODED) return { skipped: 'unencoded' };
    if (h & F_SPECIAL) return { skipped: 'special' };
    if (h & F_960) return { skipped: 'chess960' };
    const len = Math.min(h & F_LEN, record.length);

    let state;
    let fen;
    let movesStart;
    if (h & F_SETUP) {
      const epFile = record[5] & 7;
      const blackToMove = (record[5] & 0x10) >> 4;
      const wl = record[6] & 1;
      const ws = (record[6] & 2) >> 1;
      const bl = (record[6] & 4) >> 2;
      const bs = (record[6] & 8) >> 3;
      const nextMoveNo = record[7];
      state = decodeSetupPosition(bitString(record.subarray(8, 32)));
      fen = stateToFen(state, epFile, blackToMove, wl, ws, bl, bs, nextMoveNo);
      try { createGame(fen); } catch { return { skipped: 'badfen' }; }
      movesStart = 32;
    } else {
      state = standardStartState();
      fen = undefined;
      movesStart = 4;
    }
    const { sanList } = decodeMoves(record.subarray(movesStart, len), state, fen);
    return { sanList, baseFen: fen || null };
  } catch {
    return { skipped: 'damaged' };
  }
}

// =============================================================================
// Index (.cbh) + entity files (.cbp players, .cbt tournaments) → game-list rows
// =============================================================================
const CBH_RECORD = 46;
const RESULTS = ['0-1', '1/2-1/2', '1-0']; // result code 0/1/2 (else '*')

function entityStart(file) {
  if (file.length <= 0x18) return 28;
  return file[0x18] === 4 ? 32 : 28; // header version byte; both known variants
}

function playerName(cbp, id) {
  const start = entityStart(cbp);
  const o = start + id * 67;
  if (o + 59 > cbp.length) return '?';
  const last = decodeText(cbp.subarray(o + 9, o + 39));
  const first = decodeText(cbp.subarray(o + 39, o + 59));
  if (!last && !first) return '?';
  return first ? `${last}, ${first}` : last;
}

function tournamentInfo(cbt, id) {
  const start = entityStart(cbt);
  const o = start + id * 99;
  if (o + 79 > cbt.length) return { event: '', site: '' };
  return { event: decodeText(cbt.subarray(o + 9, o + 49)), site: decodeText(cbt.subarray(o + 49, o + 79)) };
}

const u16 = (b, o) => (b[o] << 8) | b[o + 1];
const u24 = (b, o) => (b[o] << 16) | (b[o + 1] << 8) | b[o + 2];

function fmtDate(packed) {
  const day = packed & 31;
  const month = (packed >> 5) & 15;
  const year = (packed >> 9) & 2047;
  const yy = year ? String(year).padStart(4, '0') : '????';
  const mm = month ? String(month).padStart(2, '0') : '??';
  const dd = day ? String(day).padStart(2, '0') : '??';
  return `${yy}.${mm}.${dd}`;
}

function cbhRow(cbh, cbp, cbt, i) {
  const o = CBH_RECORD * (i + 1); // record 0 is the DB header
  const flags = cbh[o];
  const isGame = (flags & 0x01) === 1;
  const deleted = (flags & 0x80) !== 0;
  const sgOffset = ((cbh[o + 1] << 24) | (cbh[o + 2] << 16) | (cbh[o + 3] << 8) | cbh[o + 4]) >>> 0;
  const whiteId = u24(cbh, o + 9);
  const blackId = u24(cbh, o + 12);
  const tournId = u24(cbh, o + 15);
  const date = u24(cbh, o + 24);
  const resultCode = cbh[o + 27];
  const round = cbh[o + 29];
  const subround = cbh[o + 30];
  const whiteElo = u16(cbh, o + 31);
  const blackElo = u16(cbh, o + 33);
  const { event, site } = tournamentInfo(cbt, tournId);
  const roundStr = round ? (subround ? `${round}.${subround}` : `${round}`) : '';
  return {
    sgOffset,
    deleted,
    isText: !isGame,
    variant: false, // Chess960 is flagged in the .cbg record, detected on decode
    headers: {
      White: playerName(cbp, whiteId),
      Black: playerName(cbp, blackId),
      Result: RESULTS[resultCode] || '*',
      Date: fmtDate(date),
      Event: event,
      Site: site,
      Round: roundStr,
      WhiteElo: whiteElo ? String(whiteElo) : '',
      BlackElo: blackElo ? String(blackElo) : '',
    },
  };
}

/**
 * Parse a ChessBase index + entity files into a lazy game list.
 * @param {Uint8Array} cbh  the .cbh bytes (whole file)
 * @param {Uint8Array} cbp  the .cbp bytes (whole file)
 * @param {Uint8Array} cbt  the .cbt bytes (whole file)
 * @returns {{ count:number, row(i):object }}
 */
export function parseCbhIndex(cbh, cbp, cbt) {
  const total = Math.floor(cbh.length / CBH_RECORD);
  const count = Math.max(0, total - 1); // record 0 is the header
  return {
    count,
    row(i) {
      if (i < 0 || i >= count) return null;
      return cbhRow(cbh, cbp, cbt, i);
    },
  };
}

// Exposed for the fixture generator (scripts/make-cbh-fixture.mjs) and tests.
export const _internal = {
  standardStartState, cloneState, applyMove, decodeSetupPosition, stateToFen, bitString,
  ONE_BYTE, DEOBFUSCATE_2B, CB_KING, CB_PAWN_A, CB_PAWN_E, pickType, PROMO_TYPE, sq,
  W_QUEEN, W_KNIGHT, W_BISHOP, W_ROOK, B_QUEEN, B_KNIGHT, B_BISHOP, B_ROOK, W_KING, B_KING, W_PAWN, B_PAWN,
  CBH_RECORD, decodeText, fmtDate,
};
