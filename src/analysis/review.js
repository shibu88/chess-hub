// Review maths — pure, no DOM. Implements the formulas in CLAUDE.md
// ("Review maths (Analysis)"): Lichess Win% and move accuracy, Lichess's
// per-side game accuracy, the loss metric, and the Chess.com-style move labels.
//
// Conventions:
// - A "win%" is always from the point of view of ONE side, 0..100.
// - cp (centipawns) is clamped to ±1000; a mate counts as ±1000.
// - Scores from the engine are from the side to move; the orchestration layer
//   converts them (to White's view for the bar/graph, the mover's view here).

export const CP_CLAMP = 1000;

/** All move labels this module can produce (rough best→worst order). */
export const LABELS = [
  'Brilliant', 'Great', 'Best', 'Excellent', 'Good', 'Book',
  'Inaccuracy', 'Miss', 'Mistake', 'Blunder',
];

/** Clamp a centipawn value to ±1000. */
export function clampCp(cp) {
  return Math.max(-CP_CLAMP, Math.min(CP_CLAMP, cp));
}

/**
 * Turn an engine score `{type:'cp'|'mate', value}` (from one side's POV) into
 * clamped centipawns from that same POV. A mate counts as ±1000, a stalemate /
 * missing score as 0.
 */
export function scoreToCp(score) {
  if (!score) return 0;
  if (score.type === 'mate') return score.value >= 0 ? CP_CLAMP : -CP_CLAMP;
  return clampCp(score.value);
}

/**
 * Lichess Win% for the side the centipawns favour.
 * Win% = 50 + 50 * (2 / (1 + exp(-0.00368208 * cp)) - 1)
 */
export function winPercent(cp) {
  const c = clampCp(cp);
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * c)) - 1);
}

/** Convenience: Win% straight from an engine score (same POV as the score). */
export function winPercentFromScore(score) {
  return winPercent(scoreToCp(score));
}

/**
 * Lichess move accuracy (mover's view), given the mover's Win% before and after
 * the move. accuracy = 103.1668 * exp(-0.04354 * (before - after)) - 3.1669,
 * clamped 0..100. (Lichess adds a +1 "uncertainty bonus"; CLAUDE.md's written
 * formula omits it, so we do too.)
 */
export function moveAccuracy(winBefore, winAfter) {
  const winDiff = Math.max(0, winBefore - winAfter);
  const raw = 103.1668 * Math.exp(-0.04354 * winDiff) - 3.1669;
  return Math.max(0, Math.min(100, raw));
}

/** Win% lost by the move (mover's view), never below 0. */
export function lossOf(winBefore, winAfter) {
  return Math.max(0, winBefore - winAfter);
}

// --- Game accuracy per side (Lichess method) ---------------------------------
// See lila modules/analyse/src/main/AccuracyPercent.scala. Input is the list of
// White-view Win% at every position (length = moves + 1); `startColor` is the
// side to move at the first position.

function population(values) {
  const n = values.length;
  if (n === 0) return { mean: 0, stdev: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  return { mean, stdev: Math.sqrt(variance) };
}

function weightedMean(values, weights) {
  let num = 0;
  let den = 0;
  for (let i = 0; i < values.length; i += 1) { num += values[i] * weights[i]; den += weights[i]; }
  return den === 0 ? null : num / den;
}

function harmonicMean(values) {
  if (values.length === 0) return null;
  let sum = 0;
  for (const v of values) sum += v > 0 ? 1 / v : Infinity;
  return values.length / sum;
}

/**
 * Per-side game accuracy. Returns `{ white, black }` in 0..100 (or null for a
 * side with no moves).
 */
export function gameAccuracyByColor(whiteWinPercents, startColor = 'w') {
  const wp = whiteWinPercents;
  const positions = wp.length;
  if (positions < 2) return { white: null, black: null };

  const windowSize = Math.max(2, Math.min(8, Math.floor((positions - 1) / 10)));

  // Build the windows: a few leading copies of the first window (Lichess's
  // padding so weights line up with moves), then regular sliding windows.
  const windows = [];
  const firstWindow = wp.slice(0, windowSize);
  const padCount = Math.max(0, Math.min(positions, windowSize) - 2);
  for (let i = 0; i < padCount; i += 1) windows.push(firstWindow);
  for (let i = 0; i + windowSize <= positions; i += 1) windows.push(wp.slice(i, i + windowSize));

  const weights = windows.map((w) => Math.max(0.5, Math.min(12, population(w).stdev)));

  const other = startColor === 'w' ? 'b' : 'w';
  const acc = { w: [], b: [] };
  const wts = { w: [], b: [] };

  for (let i = 0; i < positions - 1; i += 1) {
    const mover = i % 2 === 0 ? startColor : other;
    // Move accuracy is from the mover's view; wp is White's view, so flip for Black.
    const a = mover === 'w' ? moveAccuracy(wp[i], wp[i + 1]) : moveAccuracy(wp[i + 1], wp[i]);
    const weight = weights[i] ?? 0.5;
    acc[mover].push(a);
    wts[mover].push(weight);
  }

  const combine = (list, w) => {
    if (list.length === 0) return null;
    const wm = weightedMean(list, w);
    const hm = harmonicMean(list);
    if (wm == null || hm == null) return null;
    return (wm + hm) / 2;
  };

  return { white: combine(acc.w, wts.w), black: combine(acc.b, wts.b) };
}

// --- Move label ---------------------------------------------------------------

/**
 * Classify a single move. All Win% values are the mover's view (0..100).
 *
 * ctx = {
 *   onlyLegalMove?  : boolean  — a forced move is never an error
 *   isBook?         : boolean  — position after the move is still "in book"
 *   playedUci       : string   — the move played
 *   bestUci         : string   — the engine's top move
 *   winBefore       : number   — mover's Win% in the position before the move
 *                                (≈ Win% after the best move)
 *   winAfter        : number   — mover's Win% after the move played
 *   secondWinAfter? : number|null — mover's Win% the 2nd engine line leads to (for "Great")
 *   isSacrifice?    : boolean  — the move gives up material along the engine line (for "Brilliant")
 *   prevOpponentLabel? : string|null — the label of the opponent's previous move (for "Miss")
 * }
 */
export function classify(ctx) {
  const {
    onlyLegalMove = false,
    isBook = false,
    playedUci,
    bestUci,
    winBefore,
    winAfter,
    secondWinAfter = null,
    isSacrifice = false,
    prevOpponentLabel = null,
  } = ctx;

  const loss = lossOf(winBefore, winAfter);
  const isTop = Boolean(bestUci) && playedUci === bestUci;

  if (isBook) return 'Book';
  if (onlyLegalMove) return 'Best';

  const great = isTop && secondWinAfter != null && (winBefore - secondWinAfter) >= 10;
  const brilliant = (isTop || great) && isSacrifice && winAfter >= 50 && winBefore < 90;

  if (brilliant) return 'Brilliant';
  if (great) return 'Great';
  if (isTop || loss === 0) return 'Best';

  if ((prevOpponentLabel === 'Mistake' || prevOpponentLabel === 'Blunder') && loss >= 10) {
    return 'Miss';
  }

  if (loss <= 2) return 'Excellent';
  if (loss <= 5) return 'Good';
  if (loss <= 10) return 'Inaccuracy';
  if (loss <= 20) return 'Mistake';
  return 'Blunder';
}
