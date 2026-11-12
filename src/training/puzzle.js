// Pure solver state machine for one Lichess puzzle (no DOM). A puzzle is
//   { id, fen, moves, rating, themes }
// where `fen` is the position BEFORE the opponent's move and `moves` is the
// solution in UCI (space-joined or an array). moves[0] is the opponent's first
// move (the app plays it); then the solver plays moves[1], moves[3], … and the
// app plays the replies moves[2], moves[4], …. Every move goes through chess.js
// via rules.js. On a mate-in-one, any checkmating move is accepted.
import { createGame, tryMove } from '../shared/rules.js';

/** UCI string → { from, to, promotion? }. e.g. "e7e8q" → promotion 'q'. */
export function parseUci(uci) {
  return { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined };
}

/** { from, to, promotion? } → UCI string. */
export function toUci(m) {
  return m.from + m.to + (m.promotion || '');
}

export function createPuzzleSolver(puzzle) {
  const moves = Array.isArray(puzzle.moves)
    ? puzzle.moves.slice()
    : String(puzzle.moves).trim().split(/\s+/).filter(Boolean);
  const game = createGame(puzzle.fen);
  const opponentColor = game.turn();
  const solverColor = opponentColor === 'w' ? 'b' : 'w';

  let index = 0;            // next move in `moves` to play
  let status = 'init';      // 'init' → 'solving' → 'solved' | 'failed'

  function asMove(applied) {
    return { from: applied.from, to: applied.to, promotion: applied.promotion };
  }

  /** Play the opponent's first move. Returns { from, to } for the board to show. */
  function firstMove() {
    if (index !== 0) return null;
    const applied = tryMove(game, parseUci(moves[0]));
    index = 1;
    status = moves.length > 1 ? 'solving' : 'solved';
    return applied ? asMove(applied) : null;
  }

  /** The UCI the solver is expected to play next (or null if none). */
  function expectedUci() {
    return status === 'solving' ? moves[index] : null;
  }

  /** The from-square of the expected move (for the Hint button). */
  function hintSquare() {
    const uci = expectedUci();
    return uci ? uci.slice(0, 2) : null;
  }

  /**
   * Try the solver's move. Returns one of:
   *   { status: 'wrong' }                                   — illegal or not the solution
   *   { status: 'continue', userMove, userFen, replyMove, replyFen }
   *   { status: 'solved', userMove, userFen }
   */
  function tryUser({ from, to, promotion }) {
    if (status !== 'solving') return { status: 'ignored' };
    // Test legality (and checkmate) on a clone first; don't mutate on a wrong move.
    const probe = createGame(game.fen());
    const applied = tryMove(probe, { from, to, promotion });
    if (!applied) return { status: 'wrong' };
    const isMate = probe.isCheckmate();
    if (toUci(asMove(applied)) !== moves[index] && !isMate) return { status: 'wrong' };

    tryMove(game, { from, to, promotion });
    index += 1;
    const userMove = asMove(applied);
    const userFen = game.fen();
    if (isMate || index >= moves.length) {
      status = 'solved';
      return { status: 'solved', userMove, userFen };
    }
    const reply = tryMove(game, parseUci(moves[index]));
    index += 1;
    const replyMove = asMove(reply);
    const replyFen = game.fen();
    if (index >= moves.length) status = 'solved'; // defensive; puzzles end on a solver move
    return { status: 'continue', userMove, userFen, replyMove, replyFen };
  }

  /** Can the solver's last completed move (+ the app's reply) be taken back? */
  function canUndo() {
    return status === 'solving' && index >= 3;
  }

  /**
   * Take back the last solver move and the app's reply, returning to the
   * previous decision point. Returns { fen, from, to } (the move now last on the
   * board) or null if there's nothing to undo.
   */
  function undo() {
    if (!canUndo()) return null;
    game.undo(); // the app's reply
    game.undo(); // the solver's move
    index -= 2;
    const hist = game.history({ verbose: true });
    const last = hist[hist.length - 1];
    return { fen: game.fen(), from: last ? last.from : null, to: last ? last.to : null };
  }

  /**
   * Play out the rest of the solution from the current position (for "Show
   * solution"). Mutates to the end and marks the puzzle failed. Returns the
   * steps as [{ from, to, promotion?, fen }] for the board to animate.
   */
  function revealSolution() {
    const steps = [];
    while (index < moves.length) {
      const applied = tryMove(game, parseUci(moves[index]));
      index += 1;
      if (!applied) break;
      steps.push({ ...asMove(applied), fen: game.fen() });
    }
    if (status !== 'solved') status = 'failed';
    return steps;
  }

  return {
    solverColor,
    orientation: solverColor === 'w' ? 'white' : 'black',
    firstMove,
    expectedUci,
    hintSquare,
    tryUser,
    undo,
    canUndo,
    revealSolution,
    currentFen: () => game.fen(),
    get status() { return status; },
    get solved() { return status === 'solved'; },
    get done() { return status === 'solved' || status === 'failed'; },
  };
}
