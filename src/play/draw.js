// Engine's response to a draw offer (CLAUDE.md):
//   - Declined before move 20.
//   - After that, Stockfish accepts if its own eval is +0.20 (20 cp) or less.
// The offer happens on the player's turn, so a position evaluation returns a
// score from the player's side; the engine's view is the negation.

const ACCEPT_CP = 20;

function toCp(score) {
  if (!score) return 0;
  if (score.type === 'cp') return score.value;
  return score.value > 0 ? 100000 : -100000; // mate: huge for the side to move
}

/**
 * @param {import('chess.js').Chess} game
 * @param {import('../shared/engine.js').Engine} engine
 * @returns {Promise<{accepted:boolean, reason:string}>}
 */
export async function engineDrawResponse(game, engine) {
  if (game.moveNumber() < 20) {
    return { accepted: false, reason: 'too early (before move 20)' };
  }
  const score = await engine.evaluate(game.fen(), 300);
  const engineCp = -toCp(score); // engine's perspective
  if (engineCp <= ACCEPT_CP) return { accepted: true, reason: 'engine agrees' };
  return { accepted: false, reason: 'engine is better' };
}
