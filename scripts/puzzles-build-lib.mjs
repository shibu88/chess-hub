// Pure helpers for scripts/build-puzzles.mjs (unit-tested without the 295 MB file).
//
// The Lichess puzzle CSV (CC0) has a header row and the columns:
//   PuzzleId, FEN, Moves, Rating, RatingDeviation, Popularity, NbPlays, Themes,
//   GameUrl, OpeningTags, DailyDate
// We bucket puzzles into 12 levels by Rating, keep good ones (with step-wise
// relaxation per level if a level is short), and pick a fixed number per level
// spread across themes using a seeded PRNG so the output is deterministic.
//
// Memory: the real file has millions of rows, so the collector keeps only a
// bounded, seeded reservoir per (level, tier) instead of every row.

// ---- rating → level ----------------------------------------------------------

/** 12 rating bands from CLAUDE.md. `max` is inclusive; level 11 has max = null. */
export const LEVEL_BANDS = [
  { level: 0, min: 0, max: 799 },
  { level: 1, min: 800, max: 999 },
  { level: 2, min: 1000, max: 1199 },
  { level: 3, min: 1200, max: 1399 },
  { level: 4, min: 1400, max: 1599 },
  { level: 5, min: 1600, max: 1799 },
  { level: 6, min: 1800, max: 1999 },
  { level: 7, min: 2000, max: 2199 },
  { level: 8, min: 2200, max: 2399 },
  { level: 9, min: 2400, max: 2599 },
  { level: 10, min: 2600, max: 2799 },
  { level: 11, min: 2800, max: null },
];

export const LEVEL_COUNT = LEVEL_BANDS.length;

/** Which level (0–11) a rating falls in. */
export function levelOf(rating) {
  if (!Number.isFinite(rating) || rating < 800) return 0;
  return Math.min(LEVEL_COUNT - 1, Math.floor((rating - 800) / 200) + 1);
}

// ---- quality tiers (relaxed per level only if short of the target) ----------

/** Strictest first. A row passes a tier when it clears all three thresholds. */
export const QUALITY_TIERS = [
  { popularity: 85, nbPlays: 300, ratingDeviation: 90 },
  { popularity: 75, nbPlays: 150, ratingDeviation: 100 },
  { popularity: 60, nbPlays: 50, ratingDeviation: 120 },
  { popularity: -Infinity, nbPlays: -Infinity, ratingDeviation: Infinity }, // rating band only
];

function passesTier(row, tier) {
  return row.popularity >= tier.popularity
    && row.nbPlays >= tier.nbPlays
    && row.ratingDeviation <= tier.ratingDeviation;
}

/** The strictest tier index (0 best) a row passes. Every row passes the last tier. */
export function bestTier(row) {
  for (let t = 0; t < QUALITY_TIERS.length; t += 1) {
    if (passesTier(row, QUALITY_TIERS[t])) return t;
  }
  return QUALITY_TIERS.length - 1;
}

// ---- CSV parsing -------------------------------------------------------------

/** Column name → index from the header line. Throws if a required column is missing. */
export function headerIndex(headerLine) {
  const cols = headerLine.replace(/^﻿/, '').split(',');
  const idx = {};
  cols.forEach((name, i) => { idx[name] = i; });
  for (const need of ['PuzzleId', 'FEN', 'Moves', 'Rating', 'RatingDeviation', 'Popularity', 'NbPlays', 'Themes']) {
    if (!(need in idx)) throw new Error(`CSV missing "${need}" column (got: ${cols.join(', ')})`);
  }
  return idx;
}

/**
 * Parse one CSV data line into a typed row, or null if it's malformed.
 * The Lichess puzzle fields never contain commas, so a plain split is correct
 * and fast; we still bounds-check the field count.
 */
export function parseRow(line, idx) {
  const f = line.split(',');
  if (f.length < 8) return null;
  const rating = Number(f[idx.Rating]);
  const id = f[idx.PuzzleId];
  const fen = f[idx.FEN];
  const moves = f[idx.Moves];
  if (!id || !fen || !moves || !Number.isFinite(rating)) return null;
  return {
    id,
    fen,
    moves,
    rating,
    ratingDeviation: Number(f[idx.RatingDeviation]),
    popularity: Number(f[idx.Popularity]),
    nbPlays: Number(f[idx.NbPlays]),
    themes: (f[idx.Themes] || '').trim(),
  };
}

/** Compact record written to the JSON files. `moves`/`themes` stay space-joined strings. */
export function toRecord(row) {
  return { id: row.id, fen: row.fen, moves: row.moves, rating: row.rating, themes: row.themes };
}

// ---- seeded PRNG + helpers ---------------------------------------------------

/** Deterministic PRNG (mulberry32): returns a function giving floats in [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** In-place Fisher–Yates shuffle using `rng`. Returns the array. */
export function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** The theme a puzzle is bucketed under for spreading (its first theme token). */
export function primaryTheme(row) {
  const first = row.themes.split(/\s+/)[0];
  return first || 'other';
}

/**
 * Pick up to `n` rows spread across themes: group by primary theme, shuffle each
 * group and the group order with `rng`, then round-robin until `n` are taken.
 */
export function pickSpread(rows, n, rng) {
  if (rows.length <= n) return shuffle(rows.slice(), rng);
  const groups = new Map();
  for (const row of rows) {
    const key = primaryTheme(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const order = shuffle([...groups.keys()], rng);
  for (const key of order) shuffle(groups.get(key), rng);
  const picked = [];
  let progressed = true;
  while (picked.length < n && progressed) {
    progressed = false;
    for (const key of order) {
      const g = groups.get(key);
      if (g.length) { picked.push(g.pop()); progressed = true; if (picked.length >= n) break; }
    }
  }
  return picked;
}

/** The most common theme tokens across a set of rows (for the level's chips). */
export function topThemes(rows, limit = 10) {
  const counts = new Map();
  for (const row of rows) {
    for (const t of row.themes.split(/\s+/)) {
      if (t) counts.set(t, (counts.get(t) || 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([t]) => t);
}

// ---- streaming collector -----------------------------------------------------

/**
 * Collects rows into bounded, seeded reservoirs keyed by (level, tier) so the
 * whole file never sits in memory. `finalize` then relaxes per level and picks.
 *
 * @param {object} [opts]
 * @param {number} [opts.perLevel=500]  target puzzles per level
 * @param {number} [opts.seed=20240601] PRNG seed (reservoir + pick)
 * @param {number} [opts.reservoir]     max rows kept per (level, tier)
 */
export function createCollector(opts = {}) {
  const perLevel = opts.perLevel ?? 500;
  const seed = opts.seed ?? 20240601;
  const reservoir = opts.reservoir ?? Math.max(4000, perLevel * 6);
  const nTiers = QUALITY_TIERS.length;
  const rng = mulberry32(seed ^ 0x9e3779b9); // separate stream for reservoir sampling

  // buckets[level][tier] = { count, sample[] }
  const buckets = Array.from({ length: LEVEL_COUNT }, () =>
    Array.from({ length: nTiers }, () => ({ count: 0, sample: [] })));
  let seen = 0;

  function add(row) {
    seen += 1;
    const level = levelOf(row.rating);
    const tier = bestTier(row);
    const b = buckets[level][tier];
    b.count += 1;
    if (b.sample.length < reservoir) {
      b.sample.push(row);
    } else {
      // Reservoir sampling: replace an existing item with probability reservoir/count.
      const j = Math.floor(rng() * b.count);
      if (j < reservoir) b.sample[j] = row;
    }
  }

  function finalize() {
    const pickRng = mulberry32(seed);
    const levels = [];
    for (let level = 0; level < LEVEL_COUNT; level += 1) {
      const tiers = buckets[level];
      // Relax: use the strictest tier whose cumulative TRUE count reaches perLevel.
      let cumCount = 0;
      let usedTier = nTiers - 1;
      for (let t = 0; t < nTiers; t += 1) {
        cumCount += tiers[t].count;
        if (cumCount >= perLevel) { usedTier = t; break; }
      }
      const pool = [];
      for (let t = 0; t <= usedTier; t += 1) pool.push(...tiers[t].sample);
      const chosen = pickSpread(pool, perLevel, pickRng);
      const band = LEVEL_BANDS[level];
      levels.push({
        level,
        min: band.min,
        max: band.max,
        tier: usedTier,
        available: tiers.reduce((s, t) => s + t.count, 0),
        rows: chosen,
      });
    }
    return { levels, seen };
  }

  return { add, finalize, get seen() { return seen; } };
}
