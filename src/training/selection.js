// Loading and picking puzzles for Training. Fetches the committed JSON files
// (public/puzzles/*, built by scripts/build-puzzles.mjs) and chooses puzzles for
// a path set or endless practice, avoiding recently-seen ones. The pure pick
// logic is separated from fetching so it can be unit-tested without a network.

const BASE = '/puzzles';
let indexPromise = null;
const levelCache = new Map();

/** Fetch index.json ([{ level, min, max, count, topThemes }]). Cached. */
export async function loadIndex() {
  if (!indexPromise) {
    indexPromise = fetch(`${BASE}/index.json`).then((r) => {
      if (!r.ok) throw new Error(`puzzle index HTTP ${r.status}`);
      return r.json();
    }).catch((err) => { indexPromise = null; throw err; });
  }
  return indexPromise;
}

/** Fetch level-N.json (array of { id, fen, moves, rating, themes }). Cached. */
export async function loadLevel(n) {
  if (!levelCache.has(n)) {
    const pr = fetch(`${BASE}/level-${n}.json`).then((r) => {
      if (!r.ok) throw new Error(`puzzle level ${n} HTTP ${r.status}`);
      return r.json();
    }).catch((err) => { levelCache.delete(n); throw err; });
    levelCache.set(n, pr);
  }
  return levelCache.get(n);
}

export function themesOf(p) {
  return typeof p.themes === 'string' ? p.themes.split(/\s+/).filter(Boolean) : (p.themes || []);
}

/** True if the puzzle has at least one of `tokens` (empty tokens = match all). */
export function matchesThemes(p, tokens) {
  if (!tokens || tokens.length === 0) return true;
  const set = new Set(themesOf(p));
  return tokens.some((t) => set.has(t));
}

export function filterByThemes(pool, tokens) {
  return (!tokens || tokens.length === 0) ? pool : pool.filter((p) => matchesThemes(p, tokens));
}

/** Deterministic PRNG so tests can pin selection; the app passes Math.random. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Pick up to `count` distinct puzzles, preferring ones whose id isn't in
 * `exclude` (the recently-seen set). Falls back to the full pool if avoiding
 * seen would leave too few. Never repeats a puzzle within the result.
 *
 * @param {object[]} pool
 * @param {object} [opts]
 * @param {number} [opts.count=1]
 * @param {Set<string>|string[]} [opts.exclude]
 * @param {()=>number} [opts.rng=Math.random]
 */
export function pickSet(pool, { count = 1, exclude = new Set(), rng = Math.random } = {}) {
  const ex = exclude instanceof Set ? exclude : new Set(exclude);
  const fresh = pool.filter((p) => !ex.has(p.id));
  const source = fresh.length >= count ? fresh : pool;
  const picked = [];
  const used = new Set();
  for (const p of shuffled(source, rng)) {
    if (used.has(p.id)) continue;
    used.add(p.id);
    picked.push(p);
    if (picked.length >= count) break;
  }
  return picked;
}

/**
 * Which colour the solver plays: the puzzle FEN is the position before the
 * opponent's move, so the solver is the opposite side to the FEN's side-to-move.
 */
export function solverColor(p) {
  const stm = (p.fen.split(/\s+/)[1] || 'w');
  return stm === 'w' ? 'b' : 'w';
}

/**
 * Pick one puzzle, avoiding a third puzzle in a row of the same solver colour.
 * Draws uniformly at random, but when the last two served were the same colour
 * it prefers the other colour, so long same-colour runs don't happen even
 * though the pool is colour-imbalanced. Falls back to any puzzle if the pool
 * has nothing of the other colour.
 *
 * @param {object[]} pool
 * @param {object} [opts]
 * @param {Set<string>|string[]} [opts.exclude]
 * @param {string[]} [opts.recent]  recent solver colours, newest last
 * @param {()=>number} [opts.rng=Math.random]
 */
export function pickVaried(pool, { exclude = new Set(), recent = [], rng = Math.random } = {}) {
  const ex = exclude instanceof Set ? exclude : new Set(exclude);
  const n = recent.length;
  const onARun = n >= 2 && recent[n - 1] === recent[n - 2];
  if (onARun) {
    const other = recent[n - 1] === 'w' ? 'b' : 'w';
    const otherPool = pool.filter((p) => !ex.has(p.id) && solverColor(p) === other);
    const pick = pickSet(otherPool, { count: 1, rng })[0];
    if (pick) return pick;
  }
  return pickSet(pool, { count: 1, exclude: ex, rng })[0] || null;
}

/**
 * Build an ordered list of up to `count` distinct puzzles with no three in a
 * row of the same solver colour (e.g. a path set). Uses pickVaried internally.
 */
export function buildVariedSet(pool, { count, exclude = new Set(), rng = Math.random } = {}) {
  const used = new Set(exclude instanceof Set ? exclude : exclude);
  const recent = [];
  const chosen = [];
  for (let i = 0; i < count; i += 1) {
    const pick = pickVaried(pool, { exclude: used, recent, rng });
    if (!pick) break;
    used.add(pick.id);
    chosen.push(pick);
    recent.push(solverColor(pick));
    if (recent.length > 2) recent.shift();
  }
  return chosen;
}
