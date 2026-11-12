// One Stockfish engine over a single Web Worker speaking UCI. Used by Play
// now and Analysis/Training later. Only one worker exists at a time: start()
// when a screen needs it, terminate() when leaving.

export const ENGINE_URL = '/engine/stockfish-19-lite-single.js';
export const ENGINE_VERSION = 'Stockfish 19 lite (single)';

// The 7 Play levels (CLAUDE.md). `movetime` is the nominal think time; the
// caller lowers it to the clock cap (1/30 of the engine's remaining time).
export const LEVELS = [
  { id: 'beginner', name: 'Beginner', skill: 0, limitElo: false, depth: 1, movetime: 100 },
  { id: 'casual', name: 'Casual', elo: 1400, limitElo: true, movetime: 300 },
  { id: 'intermediate', name: 'Intermediate', elo: 1800, limitElo: true, movetime: 500 },
  { id: 'advanced', name: 'Advanced', elo: 2200, limitElo: true, movetime: 800 },
  { id: 'hard', name: 'Hard', elo: 2400, limitElo: true, movetime: 900 },
  { id: 'master', name: 'Master', elo: 2600, limitElo: true, movetime: 1000 },
  { id: 'grandmaster', name: 'GrandMaster', limitElo: false, movetime: 3000 },
];

export function getLevel(id) {
  return LEVELS.find((l) => l.id === id) || LEVELS[0];
}

const ELO_MIN = 1320;
const ELO_MAX = 3190;

function parseScore(line) {
  const m = line.match(/score (cp|mate) (-?\d+)/);
  if (!m) return null;
  return { type: m[1], value: Number(m[2]) };
}

function parseBestmove(line) {
  const m = line.match(/^bestmove\s+(\S+)/);
  if (!m) return null;
  const uci = m[1];
  if (uci === '(none)' || uci === '0000') return { uci: null };
  return {
    uci,
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    promotion: uci.length > 4 ? uci[4] : undefined,
  };
}

// Parse an `info ... multipv K ... score cp|mate V ... pv m1 m2 ...` line into a
// principal variation. Returns null for info lines without a score+pv (e.g.
// `info depth 1 currmove ...` or `info string ...`). Score is side-to-move.
// Exported for the analysis test.
export function parseInfoLine(line) {
  if (!line.startsWith('info ')) return null;
  const score = parseScore(line);
  const pvM = line.match(/\bpv (.+)$/);
  if (!score || !pvM) return null;
  const mpvM = line.match(/\bmultipv (\d+)/);
  const pvUci = pvM[1].trim().split(/\s+/);
  return {
    multipv: mpvM ? Number(mpvM[1]) : 1,
    score,
    pvUci,
    bestUci: pvUci[0],
  };
}

export class Engine {
  constructor() {
    this.worker = null;
    this.ready = false;
    this._listeners = new Set();
  }

  _emit(line) {
    for (const fn of [...this._listeners]) fn(line);
  }

  /** Register a line listener; returns an unsubscribe fn. */
  _on(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  /** Resolve when a line satisfies `pred`, within `timeoutMs`. */
  _await(pred, timeoutMs, onLine) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { off(); reject(new Error('Engine timed out')); }, timeoutMs);
      const off = this._on((line) => {
        if (onLine) onLine(line);
        if (pred(line)) { clearTimeout(timer); off(); resolve(line); }
      });
    });
  }

  send(cmd) {
    if (this.worker) this.worker.postMessage(cmd);
  }

  /** Start the worker and complete the UCI handshake. */
  async start() {
    if (this.worker) return;
    this.worker = new Worker(ENGINE_URL);
    this.worker.onmessage = (e) => {
      const line = typeof e.data === 'string' ? e.data : (e.data && e.data.data) || '';
      if (line) this._emit(line);
    };
    this.worker.onerror = () => { this._emit('__error__'); };

    this.send('uci');
    await this._await((l) => l === 'uciok' || l === '__error__', 10000);
    this.send('isready');
    await this._await((l) => l === 'readyok' || l === '__error__', 10000);
    this.ready = true;
  }

  /** Apply a level's options (Skill Level / UCI_LimitStrength / UCI_Elo). */
  async setLevel(level) {
    this.level = level;
    if (level.limitElo) {
      const elo = Math.max(ELO_MIN, Math.min(ELO_MAX, level.elo));
      this.send('setoption name UCI_LimitStrength value true');
      this.send(`setoption name UCI_Elo value ${elo}`);
      this.send('setoption name Skill Level value 20');
    } else {
      this.send('setoption name UCI_LimitStrength value false');
      this.send(`setoption name Skill Level value ${level.skill != null ? level.skill : 20}`);
    }
    this.send('isready');
    await this._await((l) => l === 'readyok', 10000);
  }

  /** Tell the engine a new game is starting (clears hashes/heuristics). */
  async newGame() {
    this.send('ucinewgame');
    this.send('isready');
    await this._await((l) => l === 'readyok', 10000);
  }

  /**
   * Best move for `fen`. opts: { movetime, depth }.
   * Resolves { uci, from, to, promotion, score } (score from side to move).
   */
  async bestMove(fen, opts = {}) {
    let lastScore = null;
    const budget = opts.movetime || this.level?.movetime || 500;
    let go = 'go';
    if (opts.depth) go += ` depth ${opts.depth}`;
    go += ` movetime ${budget}`;

    this.send(`position fen ${fen}`);
    this.send(go);
    const line = await this._await(
      (l) => l.startsWith('bestmove') || l === '__error__',
      budget + 8000,
      (l) => { const s = parseScore(l); if (s) lastScore = s; }
    );
    if (line === '__error__') throw new Error('Engine error');
    const bm = parseBestmove(line);
    return { ...bm, score: lastScore };
  }

  /** Evaluate `fen` for `movetime` ms; returns score from the side to move. */
  async evaluate(fen, movetime = 300) {
    const { score } = await this.bestMove(fen, { movetime });
    return score;
  }

  /** Set MultiPV (how many lines the engine reports). Idempotent. */
  async setMultiPV(n) {
    if (this._multipv === n) return;
    this._multipv = n;
    this.send(`setoption name MultiPV value ${n}`);
    this.send('isready');
    await this._await((l) => l === 'readyok', 10000);
  }

  /**
   * Analyse `fen` to a fixed node budget (so results match across devices) with
   * MultiPV. opts: { nodes, multipv }. Resolves an array of lines sorted by
   * multipv index: [{ multipv, score:{type,value}, pvUci:[...], bestUci }], each
   * score from the side to move. Empty if the position is terminal (no moves).
   */
  async analyse(fen, opts = {}) {
    const nodes = opts.nodes || 500000;
    const multipv = opts.multipv || 2;
    await this.setMultiPV(multipv);

    const lines = new Map(); // multipv index -> latest (deepest) PV for it
    this.send(`position fen ${fen}`);
    this.send(`go nodes ${nodes}`);
    const result = await this._await(
      (l) => l.startsWith('bestmove') || l === '__error__',
      120000,
      (l) => { const info = parseInfoLine(l); if (info) lines.set(info.multipv, info); },
    );
    if (result === '__error__') throw new Error('Engine error');
    return [...lines.values()].sort((a, b) => a.multipv - b.multipv);
  }

  /** Stop the current search (bestmove still arrives). */
  stopSearch() { this.send('stop'); }

  /** Terminate the worker. */
  terminate() {
    if (!this.worker) return;
    try { this.send('quit'); } catch { /* ignore */ }
    this.worker.terminate();
    this.worker = null;
    this.ready = false;
    this._listeners.clear();
  }
}
