// Thin wrapper over chess.js 1.4.0. Every move in the app goes through here,
// so rules, SAN/FEN/PGN and game-end detection live in one place.
import { Chess } from 'chess.js';

export const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
export const RANKS = ['8', '7', '6', '5', '4', '3', '2', '1'];

/** All 64 squares, a8..h1 (board() row order). */
export const SQUARES = RANKS.flatMap((r) => FILES.map((f) => f + r));

/** Is this a valid FEN? */
export function isValidFen(fen) {
  try { new Chess(fen); return true; } catch { return false; }
}

/** Create a game, optionally from a FEN. Throws if the FEN is invalid. */
export function createGame(fen) {
  return fen ? new Chess(fen) : new Chess();
}

/** Legal destination squares for the piece on `square` (empty if none / not its turn). */
export function legalDests(game, square) {
  return game.moves({ square, verbose: true }).map((m) => m.to);
}

/** Would a move from->to be a pawn promotion? */
export function isPromotion(game, from, to) {
  return game.moves({ square: from, verbose: true }).some((m) => m.to === to && m.promotion);
}

/** The square of the given colour's king, or null. */
export function kingSquare(game, color) {
  for (const row of game.board()) {
    for (const cell of row) {
      if (cell && cell.type === 'k' && cell.color === color) return cell.square;
    }
  }
  return null;
}

/**
 * Try to make a move. Returns the verbose move object, or null if illegal.
 * `move` is { from, to, promotion? }.
 */
export function tryMove(game, move) {
  try { return game.move(move); } catch { return null; }
}

/** Does the side to move have exactly one legal move? */
export function onlyOneLegalMove(game) {
  return game.moves().length === 1;
}

/**
 * Current result of the game.
 * @returns {{over:boolean, result:('1-0'|'0-1'|'1/2-1/2'|null), reason:string}}
 */
export function gameResult(game) {
  if (game.isCheckmate()) {
    const loserIsWhite = game.turn() === 'w';
    return { over: true, result: loserIsWhite ? '0-1' : '1-0', reason: 'checkmate' };
  }
  if (game.isStalemate()) return { over: true, result: '1/2-1/2', reason: 'stalemate' };
  if (game.isInsufficientMaterial()) return { over: true, result: '1/2-1/2', reason: 'insufficient material' };
  if (game.isThreefoldRepetition()) return { over: true, result: '1/2-1/2', reason: 'threefold repetition' };
  if (game.isDraw()) return { over: true, result: '1/2-1/2', reason: 'fifty-move rule' };
  return { over: false, result: null, reason: '' };
}
