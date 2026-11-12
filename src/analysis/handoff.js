// A tiny one-shot hand-off so Play can send a finished game to Analysis > Review
// across a route change, without stuffing a whole game into the URL.
let pending = null;

/** Stash a game to review (called by Play, then navigate to #/analysis). */
export function setPendingReview(game) { pending = game; }

/** Take and clear the stashed game (called once by Analysis on mount). */
export function takePendingReview() { const g = pending; pending = null; return g; }
