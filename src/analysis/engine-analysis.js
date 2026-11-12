// Runs the engine over a whole game and builds the review data the UI shows.
// One search per position (N+1 for N moves): the search at the position *before*
// a move gives the best move + best score; the search at the position *after* it
// gives the score of the move actually played (from the opponent's view, which
// we flip). Terminal positions (checkmate/stalemate) are not searched.
//
// `engine` is anything with `analyse(fen, {nodes, multipv})` → the Engine class,
// or a fake in tests. All the maths lives in review.js; this file only wires the
// engine output into those formulas and the labels.
import { createGame, tryMove, onlyOneLegalMove, gameResult } from '../shared/rules.js';
import { ENGINE_VERSION } from '../shared/engine.js';
import {
  scoreToCp, winPercent, winPercentFromScore, moveAccuracy, lossOf,
  classify, gameAccuracyByColor, LABELS,
} from './review.js';
import { deepestOpening } from './openings.js';

const PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

/** The three analysis budgets (fixed node counts so PC and phone agree). */
export const DEPTHS = [
  { id: 'fast', name: 'Fast', nodes: 150000 },
  { id: 'standard', name: 'Standard', nodes: 500000 },
  { id: 'deep', name: 'Deep', nodes: 1500000 },
];
export const getDepth = (id) => DEPTHS.find((d) => d.id === id) || DEPTHS[1];

const uciToMove = (uci) => ({
  from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length > 4 ? uci[4] : undefined,
});

function materialDiff(fen, color) {
  const g = createGame(fen);
  let diff = 0;
  for (const row of g.board()) {
    for (const cell of row) {
      if (!cell) continue;
      diff += (cell.color === color ? 1 : -1) * PIECE_VALUE[cell.type];
    }
  }
  return diff;
}

// Does the mover go at least 2 points of material down within 4 plies of the
// engine's best line (an approximation of Chess.com's "sacrifice" test)?
function isSacrifice(fenBefore, pvUci, moverColor) {
  if (!pvUci || pvUci.length === 0) return false;
  const g = createGame(fenBefore);
  let minDiff = materialDiff(fenBefore, moverColor);
  const plies = Math.min(4, pvUci.length);
  for (let i = 0; i < plies; i += 1) {
    if (!tryMove(g, uciToMove(pvUci[i]))) break;
    minDiff = Math.min(minDiff, materialDiff(g.fen(), moverColor));
  }
  return minDiff <= -2;
}

// SAN for the first few plies of a UCI line, for display.
function lineToSan(fen, pvUci, max = 8) {
  const g = createGame(fen);
  const out = [];
  for (let i = 0; i < Math.min(max, pvUci.length); i += 1) {
    const mv = tryMove(g, uciToMove(pvUci[i]));
    if (!mv) break;
    out.push(mv.san);
  }
  return out;
}

// Centipawns from the side-to-move's view at a position (terminal-aware).
function sideToMoveCp(lines, g) {
  const end = gameResult(g);
  if (end.over) return g.isCheckmate() ? -1000 : 0; // side to move is mated, or a draw
  return lines && lines.length ? scoreToCp(lines[0].score) : 0;
}

/**
 * Analyse a game. `game` is the Board/Upload hand-off: { baseFen, moves:[{san}],
 * pgn, headers }. Returns the full review object, or null if cancelled.
 *
 * opts: { nodes, multipv=2, onProgress(done,total), isCancelled() }
 */
export async function analyseGame(engine, game, opts = {}) {
  const nodes = opts.nodes || 500000;
  const multipv = opts.multipv || 2;
  const onProgress = opts.onProgress || (() => {});
  const isCancelled = opts.isCancelled || (() => false);

  // Replay the moves to get every position and each played move's UCI/SAN.
  const g = createGame(game.baseFen || undefined);
  const startColor = g.turn();
  const positions = [g.fen()];
  const played = [];
  for (const m of game.moves || []) {
    let mv;
    try { mv = g.move(m.san ?? m); } catch { break; } // untrusted upload: stop at the first illegal move
    if (!mv) break;
    played.push({ san: mv.san, from: mv.from, to: mv.to, promotion: mv.promotion, color: mv.color, uci: mv.from + mv.to + (mv.promotion || '') });
    positions.push(g.fen());
  }
  const N = played.length;
  const total = positions.length;

  // One search per position.
  const lines = new Array(total).fill(null);
  const cpStm = new Array(total).fill(0);
  const whiteWin = new Array(total).fill(50);
  for (let i = 0; i < total; i += 1) {
    if (isCancelled()) return null;
    onProgress(i, total);
    const gi = createGame(positions[i]);
    if (gameResult(gi).over) {
      lines[i] = [];
    } else {
      lines[i] = await engine.analyse(positions[i], { nodes, multipv });
    }
    cpStm[i] = sideToMoveCp(lines[i], gi);
    whiteWin[i] = winPercent(gi.turn() === 'w' ? cpStm[i] : -cpStm[i]);
  }
  onProgress(total, total);
  if (isCancelled()) return null;

  // Opening: the deepest unbroken book line from move 1.
  const opening = deepestOpening(positions.slice(1));
  const bookPly = opening ? opening.ply : 0;

  // Per-move metrics + labels.
  const moves = [];
  let prevLabel = null;
  for (let i = 0; i < N; i += 1) {
    const mover = played[i].color;
    const winBefore = winPercent(cpStm[i]);             // mover's view (side to move at i = mover)
    const winAfter = 100 - winPercent(cpStm[i + 1]);    // flip the opponent's view at i+1
    const loss = lossOf(winBefore, winAfter);
    const accuracy = moveAccuracy(winBefore, winAfter);
    const top = lines[i][0] || null;
    const second = lines[i][1] || null;
    const bestUci = top ? top.bestUci : null;
    const pv1Uci = top ? top.pvUci : [];
    const secondWinAfter = second ? winPercentFromScore(second.score) : null;

    const label = classify({
      onlyLegalMove: onlyOneLegalMove(createGame(positions[i])),
      isBook: i + 1 <= bookPly,
      playedUci: played[i].uci,
      bestUci,
      winBefore,
      winAfter,
      secondWinAfter,
      isSacrifice: top ? isSacrifice(positions[i], pv1Uci, mover) : false,
      prevOpponentLabel: prevLabel,
    });
    prevLabel = label;

    const whiteCpAfter = (played[i].color === 'w' ? -1 : 1) * cpStm[i + 1]; // cp after move, White's view
    moves.push({
      ply: i + 1,
      moverColor: mover,
      san: played[i].san,
      playedUci: played[i].uci,
      bestUci,
      bestSan: top ? (lineToSan(positions[i], pv1Uci, 1)[0] || null) : null,
      label,
      winBefore, winAfter, loss, accuracy,
      whiteWinAfter: whiteWin[i + 1],
      scoreWhiteCp: whiteCpAfter,
      pv1San: top ? lineToSan(positions[i], pv1Uci) : [],
      pv2San: second ? lineToSan(positions[i], second.pvUci) : [],
      pv1Uci,
      pv2Uci: second ? second.pvUci : [],
    });
  }

  return {
    baseFen: game.baseFen || null,
    headers: game.headers || {},
    source: game.source || 'board',
    pgn: game.pgn || null,
    startColor,
    positions,
    whiteWin,
    moves,
    accuracy: gameAccuracyByColor(whiteWin, startColor),
    labelCounts: countLabels(moves),
    opening: opening ? { eco: opening.eco, name: opening.name, ply: opening.ply } : null,
    nodes,
    engine: { version: ENGINE_VERSION, nodes },
  };
}

function countLabels(moves) {
  const counts = { w: {}, b: {} };
  for (const label of LABELS) { counts.w[label] = 0; counts.b[label] = 0; }
  for (const m of moves) counts[m.moverColor][m.label] += 1;
  return counts;
}
