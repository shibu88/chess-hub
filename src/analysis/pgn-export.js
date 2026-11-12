// Turn a finished review into a saved record, an annotated PGN, or a JSON dump.
// The record is what My games stores (CLAUDE.md "Data, storage and sync"); the
// annotated PGN gives every move a [%eval], a NAG glyph and a short comment; the
// JSON holds the full per-move review. The builders are pure; only the
// download* helpers touch the DOM.
import { saveFile } from '../app/save-file.js';

const GLYPH = { Brilliant: '!!', Great: '!', Inaccuracy: '?!', Mistake: '?', Blunder: '??' };
const KEEP_HEADERS = ['Event', 'Site', 'Date', 'Round', 'White', 'Black', 'Result', 'ECO'];
const r0 = (n) => (n == null ? null : Math.round(n));
const r1 = (n) => (n == null ? null : Math.round(n * 10) / 10);

const pickHeaders = (h = {}) => {
  const out = {};
  for (const k of KEEP_HEADERS) if (h[k] != null && h[k] !== '') out[k] = h[k];
  return out;
};

function evalTag(cp) { return `[%eval ${(cp / 100).toFixed(2)}]`; }

function comment(m) {
  let c = `${m.label}.`;
  if (m.bestSan && m.bestSan !== m.san) c += ` Best was ${m.bestSan}.`;
  return c;
}

function movetext(moves, startColor, startFullMove, annotate) {
  const out = [];
  let moveNo = startFullMove;
  let white = startColor === 'w';
  for (let i = 0; i < moves.length; i += 1) {
    const m = moves[i];
    let token = white ? `${moveNo}. ` : (i === 0 ? `${moveNo}... ` : '');
    token += m.san + (annotate ? (GLYPH[m.label] || '') : '');
    if (annotate) token += ` { ${evalTag(m.scoreWhiteCp)} ${comment(m)} }`;
    out.push(token);
    if (!white) moveNo += 1;
    white = !white;
  }
  return out.join(' ');
}

function tag(k, v) {
  return `[${k} "${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`;
}

/** Build a PGN string. `annotate` adds glyphs, [%eval] and comments. */
export function buildPgn({ headers = {}, baseFen = null, startColor = 'w', moves = [], result }, annotate = false) {
  const res = result || headers.Result || '*';
  const lines = [
    tag('Event', headers.Event || 'Chess Hub'),
    tag('Site', headers.Site || 'Chess Hub'),
    tag('Date', headers.Date || '????.??.??'),
    tag('Round', headers.Round || '-'),
    tag('White', headers.White || '?'),
    tag('Black', headers.Black || '?'),
    tag('Result', res),
  ];
  if (headers.ECO) lines.push(tag('ECO', headers.ECO));
  if (baseFen) { lines.push(tag('SetUp', '1')); lines.push(tag('FEN', baseFen)); }
  const startFull = baseFen ? (Number(baseFen.split(/\s+/)[5]) || 1) : 1;
  const body = `${movetext(moves, startColor, startFull, annotate)} ${res}`.trim();
  return `${lines.join('\n')}\n\n${body}\n`;
}

/** A finished review → the record My games stores (kept well under 200 KB). */
export function reviewToRecord(review, id) {
  const h = review.headers || {};
  const rec = {
    source: review.source || 'board',
    result: h.Result || '*',
    pgn: buildPgn({ headers: h, baseFen: review.baseFen, startColor: review.startColor, moves: review.moves, result: h.Result || '*' }, false),
    headers: pickHeaders(h),
    players: { white: h.White || '?', black: h.Black || '?' },
    engine: review.engine || null,
    review: {
      baseFen: review.baseFen || null,
      startColor: review.startColor,
      accuracy: review.accuracy,
      labelCounts: review.labelCounts,
      opening: review.opening,
      moves: review.moves.map((m) => ({
        san: m.san, label: m.label, scoreWhiteCp: r0(m.scoreWhiteCp),
        accuracy: r1(m.accuracy), best: m.bestUci, bestSan: m.bestSan,
      })),
    },
  };
  if (id) rec.id = id;
  return rec;
}

/** PGN for a stored record (annotated when it has per-move review data). */
export function recordToPgn(record, annotate = true) {
  const rv = record.review;
  if (annotate && rv && rv.moves && rv.moves.length) {
    return buildPgn({ headers: record.headers, baseFen: rv.baseFen, startColor: rv.startColor, moves: rv.moves, result: record.result }, true);
  }
  return record.pgn || buildPgn({ headers: record.headers, baseFen: rv && rv.baseFen, startColor: rv && rv.startColor, moves: (rv && rv.moves) || [], result: record.result }, false);
}

/** The full review as pretty JSON. */
export function toReviewJson(record) {
  return JSON.stringify({ headers: record.headers, source: record.source, engine: record.engine, review: record.review }, null, 2);
}

// ---- downloads (DOM) --------------------------------------------------------

function stamp() {
  return new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '').replace(/(\d{8})(\d{4})/, '$1-$2');
}

export function downloadText(filename, text, mime = 'text/plain') {
  // Web = download link; native = Filesystem write + Share sheet (save-file.js).
  saveFile(filename, text, mime);
}

export function downloadPgn(records, annotate = true) {
  const list = Array.isArray(records) ? records : [records];
  const text = list.map((r) => recordToPgn(r, annotate)).join('\n');
  downloadText(`chesshub-${stamp()}.pgn`, text, 'application/x-chess-pgn');
}

export function downloadJson(record) {
  downloadText(`chesshub-${stamp()}.json`, toReviewJson(record), 'application/json');
}
