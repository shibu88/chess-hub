// Pure training-progress model and transitions (no store, no DOM). The screen
// drives these; src/training/training-store.js persists the object through the
// shared store, and Stage D adds cross-device merge/sync on top.
//
// Shape:
//   { pathLevel, levelsPassed, set, solvedIds[], seenIds[], stats:{ [level]:{solved,attempts} } }
//   set = { level, ids[], index, score, results[] } | null   (the current path set)

export const MAX_LEVEL = 11;
export const SET_SIZE = 10;
export const PASS_THRESHOLD = 8;   // first-try solves (of 10) needed to pass a set
export const SOLVED_CAP = 2000;    // keep the newest N solved puzzle ids
export const SEEN_CAP = 200;       // don't repeat a puzzle seen in the last N

const clampLevel = (n) => Math.max(0, Math.min(MAX_LEVEL, Math.trunc(Number(n) || 0)));

export function defaultProgress() {
  return { pathLevel: 0, levelsPassed: 0, set: null, solvedIds: [], seenIds: [], stats: {} };
}

/** Coerce a loaded (possibly partial/legacy) object into a valid progress shape. */
export function normalize(p) {
  p = p && typeof p === 'object' ? p : {};
  const stats = {};
  if (p.stats && typeof p.stats === 'object') {
    for (const [k, v] of Object.entries(p.stats)) {
      stats[k] = { solved: Math.max(0, v?.solved || 0), attempts: Math.max(0, v?.attempts || 0) };
    }
  }
  return {
    pathLevel: clampLevel(p.pathLevel),
    levelsPassed: Math.max(0, Math.trunc(Number(p.levelsPassed) || 0)),
    set: p.set && typeof p.set === 'object' ? p.set : null,
    solvedIds: Array.isArray(p.solvedIds) ? p.solvedIds.slice(0, SOLVED_CAP) : [],
    seenIds: Array.isArray(p.seenIds) ? p.seenIds.slice(0, SEEN_CAP) : [],
    stats,
  };
}

/** Newest-first insert with de-dupe and a cap. Mutates and returns `list`. */
function pushCapped(list, id, cap) {
  const at = list.indexOf(id);
  if (at !== -1) list.splice(at, 1);
  list.unshift(id);
  if (list.length > cap) list.length = cap;
  return list;
}

export function pushSeen(p, id) { pushCapped(p.seenIds, id, SEEN_CAP); return p; }
export function pushSolved(p, id) { pushCapped(p.solvedIds, id, SOLVED_CAP); return p; }

/**
 * Record one finished puzzle (any mode). Updates per-level stats, the global
 * solved/seen lists, and returns `p`.
 */
export function recordAttempt(p, { level, id, solved }) {
  const key = String(level);
  const stat = p.stats[key] || (p.stats[key] = { solved: 0, attempts: 0 });
  stat.attempts += 1;
  const isNewSolve = solved && !p.solvedIds.includes(id);
  if (solved) pushSolved(p, id);
  if (isNewSolve) stat.solved += 1;
  pushSeen(p, id);
  return p;
}

/** Count of distinct solved puzzles at a level (for the levels grid). */
export function solvedCount(p, level) { return p.stats[String(level)]?.solved || 0; }

// ---- the path (sets of SET_SIZE, PASS_THRESHOLD first-try solves to pass) ----

export function startSet(p, level, ids) {
  p.set = { level: clampLevel(level), ids: ids.slice(), index: 0, score: 0, results: [] };
  return p;
}

/** Record the outcome of the current set puzzle (firstTry = solved with no help/wrong). */
export function recordSetOutcome(p, firstTry) {
  if (!p.set) return p;
  p.set.results.push(!!firstTry);
  if (firstTry) p.set.score += 1;
  p.set.index += 1;
  return p;
}

export function isSetComplete(p) { return !!p.set && p.set.index >= p.set.ids.length; }
export function didPassSet(p) { return !!p.set && p.set.score >= PASS_THRESHOLD; }

/**
 * Finish the current set: if passed, advance the path (unlock the next level).
 * Clears `p.set`. Returns { passed, score, level, unlockedLevel }.
 */
export function completeSet(p) {
  if (!p.set) return { passed: false, score: 0, level: p.pathLevel, unlockedLevel: p.pathLevel };
  const { level, score } = p.set;
  const passed = score >= PASS_THRESHOLD;
  let unlockedLevel = p.pathLevel;
  if (passed) {
    unlockedLevel = Math.min(MAX_LEVEL, level + 1);
    if (level >= p.pathLevel) p.pathLevel = unlockedLevel;
    p.levelsPassed = Math.max(p.levelsPassed, level + 1);
  }
  p.set = null;
  return { passed, score, level, unlockedLevel };
}

// ---- merge two progress objects (sign-in; Stage D uses this) ----

export function mergeProgress(a, b) {
  const base = normalize(a);
  const other = normalize(b);
  const merged = normalize({
    pathLevel: Math.max(base.pathLevel, other.pathLevel),
    levelsPassed: Math.max(base.levelsPassed, other.levelsPassed),
    set: base.set || other.set,
    solvedIds: [...base.solvedIds, ...other.solvedIds],
    seenIds: [...base.seenIds, ...other.seenIds],
    stats: {},
  });
  // de-dupe id lists while preserving newest-first order
  merged.solvedIds = [...new Set(merged.solvedIds)].slice(0, SOLVED_CAP);
  merged.seenIds = [...new Set(merged.seenIds)].slice(0, SEEN_CAP);
  const levels = new Set([...Object.keys(base.stats), ...Object.keys(other.stats)]);
  for (const k of levels) {
    const x = base.stats[k] || { solved: 0, attempts: 0 };
    const y = other.stats[k] || { solved: 0, attempts: 0 };
    merged.stats[k] = { solved: Math.max(x.solved, y.solved), attempts: x.attempts + y.attempts };
  }
  return merged;
}
