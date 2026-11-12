// Two-sided countdown clock. The side whose turn it is ticks down; when a
// side reaches zero it flags (loses on time). The engine's per-move thinking
// budget is capped at 1/30 of its remaining clock (CLAUDE.md).

const TICK_MS = 100;

/**
 * @param {object} opts
 * @param {number} opts.initialMs  starting time per side
 * @param {(state:{w:number,b:number})=>void} [opts.onTick]
 * @param {(color:'w'|'b')=>void} [opts.onFlag]
 */
export function createClock({ initialMs, onTick, onFlag }) {
  const remaining = { w: initialMs, b: initialMs };
  let turn = null;      // 'w' | 'b' | null (stopped)
  let last = 0;         // timestamp of last decrement
  let timer = null;
  let flagged = false;

  function tick() {
    const now = Date.now();
    if (turn) {
      remaining[turn] = Math.max(0, remaining[turn] - (now - last));
      if (remaining[turn] === 0 && !flagged) {
        const flaggedColor = turn; // capture before stop() clears `turn`
        flagged = true;
        stop();
        onTick && onTick({ ...remaining });
        onFlag && onFlag(flaggedColor);
        return;
      }
    }
    last = now;
    onTick && onTick({ ...remaining });
  }

  function stop() {
    if (timer) { clearInterval(timer); timer = null; }
    turn = null;
  }

  return {
    /** Start (or switch) ticking for `color`, or pass null to pause. */
    setTurn(color) {
      if (flagged) return;
      // settle the outgoing side before switching
      if (turn && timer) { const now = Date.now(); remaining[turn] = Math.max(0, remaining[turn] - (now - last)); }
      turn = color;
      last = Date.now();
      if (timer) { clearInterval(timer); timer = null; }
      if (color) timer = setInterval(tick, TICK_MS);
      onTick && onTick({ ...remaining });
    },
    getRemaining(color) { return remaining[color]; },
    /** Engine's per-move budget for `color`: 1/30 of its remaining time. */
    engineBudget(color) { return Math.floor(remaining[color] / 30); },
    stop,
    destroy() { if (timer) clearInterval(timer); timer = null; },
    get flagged() { return flagged; },
  };
}
