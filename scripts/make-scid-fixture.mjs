// Synthesizes tiny but REAL Scid 4 and Scid 5 databases (.si4/.sn4/.sg4 and
// .si5/.sn5/.sg5) from games given as SAN. It inverts the encoders our reader
// (src/importers/scid.js) decodes, reusing that module's internals so the tricky
// move-value tables have a single source of truth. Tests import the `encode*`
// helpers to build in-memory fixtures (hermetic — no committed samples/); run as
// a CLI it writes a sample set to a directory for manual testing.
//
//   node scripts/make-scid-fixture.mjs <out-dir>
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGame } from '../src/shared/rules.js';
import { _internal } from '../src/importers/scid.js';

const {
  initState, updateState, cloneState, toScid, fileOf, rankOf, KING_DIFF, KNIGHT_DIFF,
} = _internal;

const ENC = new TextEncoder();
const concat = (parts) => {
  const total = parts.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const a of parts) { out.set(a, o); o += a.length; }
  return out;
};

// ---- the move encoder: inverse of src/importers/scid.js targetSquare() -------
function encodeMoveBytes(state, m) {
  const ci = state.side === 'w' ? 0 : 1; // eslint-disable-line no-unused-vars
  const fromSq = toScid(m.from);
  const toSq = toScid(m.to);
  const pieceNum = state.listPos[fromSq];
  let val;
  let extra = null;
  switch (m.piece) {
    case 'k':
      if (m.flags.includes('k')) val = 10;
      else if (m.flags.includes('q')) val = 9;
      else val = KING_DIFF.indexOf(toSq - fromSq);
      break;
    case 'n':
      val = KNIGHT_DIFF.indexOf(toSq - fromSq);
      break;
    case 'r':
      val = rankOf(fromSq) === rankOf(toSq) ? fileOf(toSq) : 8 + rankOf(toSq);
      break;
    case 'b': {
      const fd = fileOf(toSq) - fileOf(fromSq);
      val = (toSq - fromSq === 9 * fd) ? fileOf(toSq) : 8 + fileOf(toSq);
      break;
    }
    case 'q':
      if (rankOf(fromSq) === rankOf(toSq)) val = fileOf(toSq);
      else if (fileOf(fromSq) === fileOf(toSq)) val = 8 + rankOf(toSq);
      else { val = fileOf(fromSq); extra = toSq + 64; }
      break;
    case 'p': {
      const ad = Math.abs(toSq - fromSq);
      if (m.promotion) {
        const pr = { q: 1, r: 2, b: 3, n: 4 }[m.promotion];
        val = (ad === 7 ? 0 : ad === 8 ? 1 : 2) + 3 * pr;
      } else {
        val = ad === 16 ? 15 : ad === 7 ? 0 : ad === 8 ? 1 : 2;
      }
      break;
    }
    default:
      throw new Error(`bad piece ${m.piece}`);
  }
  if (val < 0 || val > 15) throw new Error(`bad encode val ${val} for ${m.san}`);
  const bytes = [(pieceNum << 4) | val];
  if (extra != null) bytes.push(extra);
  updateState(state, m, pieceNum, fromSq, toSq);
  state.side = state.side === 'w' ? 'b' : 'w';
  return bytes;
}

const isPromoSan = (san) => san.includes('=');

/**
 * Encode one game's .sg record.
 * spec = { moves:[san], baseFen?, extraTags?:[[name,value]],
 *          comments?:[{afterPly,text}], nags?:[{afterPly,nag}],
 *          variations?:[{afterPly,moves:[san]}] }
 */
export function encodeGameRecord(spec) {
  const game = createGame(spec.baseFen || undefined);
  const state = initState(game, spec.baseFen || null);
  const body = [];

  for (const [name, value] of (spec.extraTags || [])) {
    const nb = ENC.encode(name);
    const vb = ENC.encode(value);
    body.push(nb.length, ...nb, vb.length, ...vb);
  }
  body.push(0x00); // end of tags

  let flags = spec.baseFen ? 1 : 0;
  if (spec.moves.some(isPromoSan)) flags |= 2;
  body.push(flags);
  if (spec.baseFen) { body.push(...ENC.encode(spec.baseFen), 0x00); }

  const byPly = (list, key) => {
    const map = {};
    for (const x of (list || [])) map[x.afterPly] = key ? x[key] : x;
    return map;
  };
  const nags = byPly(spec.nags, 'nag');
  const comments = byPly(spec.comments, 'text');
  const vars = byPly(spec.variations, null);
  const commentTexts = [];

  for (let i = 0; i < spec.moves.length; i += 1) {
    const before = { fen: game.fen(), state: cloneState(state) };
    const m = game.move(spec.moves[i]);
    body.push(...encodeMoveBytes(state, m));
    const ply = i + 1;
    if (nags[ply] != null) body.push(0x0b, nags[ply]);
    if (comments[ply] != null) { body.push(0x0c); commentTexts.push(comments[ply]); }
    if (vars[ply]) {
      body.push(0x0d);
      const vg = createGame(before.fen);
      const vs = cloneState(before.state);
      for (const san of vars[ply].moves) body.push(...encodeMoveBytes(vs, vg.move(san)));
      body.push(0x0e);
    }
  }
  body.push(0x0f); // end of game
  for (const t of commentTexts) body.push(...ENC.encode(t), 0x00);

  return { sg: Uint8Array.from(body), hasFen: !!spec.baseFen, plyCount: spec.moves.length };
}

// ---- dates / eco (inverse of the reader's fmtDate / decodeEco) ---------------
function packDate(str) {
  const m = /^(\d{4})\.(\d{2})\.(\d{2})$/.exec(str || '');
  if (!m) return 0;
  return (Number(m[1]) << 9) | (Number(m[2]) << 5) | Number(m[3]);
}
function packEco(str) {
  const m = /^([A-E])(\d)(\d)$/.exec(str || '');
  if (!m) return 0;
  const base = (m[1].charCodeAt(0) - 65) * 100 + Number(m[2]) * 10 + Number(m[3]);
  return base * 131 + 1;
}
const resultCode = (r) => ({ '*': 0, '1-0': 1, '0-1': 2, '1/2-1/2': 3 }[r] ?? 0);

// ---- name files -------------------------------------------------------------
function encodeNames4(tables) {
  const magic = ENC.encode('Scid.sn\0');
  const parts = [magic];
  const u24 = (n) => Uint8Array.of((n >> 16) & 255, (n >> 8) & 255, n & 255);
  parts.push(Uint8Array.of(0, 0, 0, 0)); // timestamp
  const order = ['players', 'events', 'sites', 'rounds'];
  for (const k of order) parts.push(u24(tables[k].length));
  for (let i = 0; i < 4; i += 1) parts.push(u24(1)); // maxFrequency = 1 → 1-byte freq

  for (const k of order) {
    const recs = tables[k].map((name, id) => ({ id, bytes: ENC.encode(name) }));
    recs.sort((a, b) => {
      const n = Math.min(a.bytes.length, b.bytes.length);
      for (let j = 0; j < n; j += 1) if (a.bytes[j] !== b.bytes[j]) return a.bytes[j] - b.bytes[j];
      return a.bytes.length - b.bytes.length;
    });
    let prev = new Uint8Array(0);
    recs.forEach((rec, i) => {
      let prefix = 0;
      if (i > 0) {
        const n = Math.min(prev.length, rec.bytes.length);
        while (prefix < n && prev[prefix] === rec.bytes[prefix]) prefix += 1;
      }
      const rowParts = [Uint8Array.of((rec.id >> 8) & 255, rec.id & 255), Uint8Array.of(1), Uint8Array.of(rec.bytes.length)];
      if (i > 0) rowParts.push(Uint8Array.of(prefix));
      rowParts.push(rec.bytes.subarray(prefix));
      parts.push(concat(rowParts));
      prev = rec.bytes;
    });
  }
  return concat(parts);
}

function leb128(v) {
  const out = [];
  do { let b = v & 0x7f; v >>>= 7; if (v) b |= 0x80; out.push(b); } while (v);
  return Uint8Array.from(out);
}
function encodeNames5(tables) {
  const parts = [];
  ['players', 'events', 'sites', 'rounds'].forEach((k, type) => {
    for (const name of tables[k]) {
      const payload = ENC.encode(name);
      parts.push(leb128((payload.length << 3) | type), payload);
    }
  });
  return concat(parts);
}

// ---- index files ------------------------------------------------------------
function encodeIndex4(entries) {
  const header = new Uint8Array(182);
  header.set(ENC.encode('Scid.si\0'), 0);
  header[8] = 1; header[9] = 0x90;            // version 400 (0x0190), big-endian
  header[14] = (entries.length >> 16) & 255;
  header[15] = (entries.length >> 8) & 255;
  header[16] = entries.length & 255;
  const recs = entries.map((e) => {
    const r = new Uint8Array(47);
    const dv = new DataView(r.buffer);
    dv.setUint32(0, e.sgOffset);
    dv.setUint16(4, e.sgLength & 0xffff);
    r[6] = e.sgLength > 0xffff ? 0x80 : 0;
    dv.setUint16(7, (e.deleted ? 1 << 3 : 0) | (e.hasFen ? 1 : 0));
    r[9] = (((e.whiteId >> 16) & 0xf) << 4) | ((e.blackId >> 16) & 0xf);
    dv.setUint16(10, e.whiteId & 0xffff);
    dv.setUint16(12, e.blackId & 0xffff);
    r[14] = (((e.eventId >> 16) & 0x7) << 5) | (((e.siteId >> 16) & 0x7) << 2) | ((e.roundId >> 16) & 0x3);
    dv.setUint16(15, e.eventId & 0xffff);
    dv.setUint16(17, e.siteId & 0xffff);
    dv.setUint16(19, e.roundId & 0xffff);
    dv.setUint16(21, (e.result & 0xf) << 12);
    dv.setUint16(23, e.eco);
    dv.setUint32(25, e.gameDate);
    dv.setUint16(29, e.whiteElo & 0x0fff);
    dv.setUint16(31, e.blackElo & 0x0fff);
    r[37] = e.plyCount & 0xff;                  // 10-bit half-move count (B37 + B38 bits 6-7)
    r[38] = ((e.plyCount >> 8) & 3) << 6;
    return r;
  });
  return concat([header, ...recs]);
}

function encodeIndex5(entries) {
  const recs = entries.map((e) => {
    const r = new Uint8Array(56);
    const dv = new DataView(r.buffer);
    const w = (k, v) => dv.setUint32(k * 4, v >>> 0, true);
    w(0, e.whiteId); w(1, e.blackId); w(2, e.eventId); w(3, e.siteId);
    w(4, ((e.variant ? 0x80000000 : 0) | (e.roundId & 0x7fffffff)) >>> 0);
    w(5, ((e.whiteElo & 0xfff) * (1 << 20)) + (e.gameDate & 0xfffff));
    w(6, ((e.blackElo & 0xfff) * (1 << 20)) + (e.gameDate & 0xfffff));
    // word 7: flags (deleted/custom-start) + half-move count in bits 22-31.
    // Multiply, not <<22: (ply<<22) can exceed the signed-32-bit range in JS.
    w(7, ((e.deleted ? 1 << 3 : 0) | (e.hasFen ? 1 : 0)) + (e.plyCount & 0x3ff) * 4194304);
    w(8, ((e.sgLength & 0x1ffff) * (1 << 15)) + (Math.floor(e.sgOffset / 4294967296) & 0x7fff));
    w(9, e.sgOffset >>> 0);
    w(10, 0);
    w(11, ((e.result & 3) << 16) | (e.eco & 0xffff));
    return r;
  });
  return concat(recs);
}

/**
 * Build a whole database from games.
 * @param {Array} games  [{ headers, record:{sg,hasFen}, deleted?, variant? }]
 * @param {number} version 4 or 5
 * @returns {{ si:Uint8Array, sn:Uint8Array, sg:Uint8Array }}
 */
export function buildDatabase(games, version) {
  const tables = { players: [], events: [], sites: [], rounds: [] };
  const idOf = (arr, name) => {
    const s = name || '';
    let i = arr.indexOf(s);
    if (i < 0) { i = arr.length; arr.push(s); }
    return i;
  };
  const sgParts = [];
  let offset = 0;
  const entries = games.map((g) => {
    const h = g.headers;
    const rec = g.record.sg;
    const e = {
      sgOffset: offset,
      sgLength: rec.length,
      hasFen: g.record.hasFen,
      plyCount: g.record.plyCount || 0,
      deleted: !!g.deleted,
      variant: !!g.variant,
      result: resultCode(h.Result),
      eco: packEco(h.ECO),
      gameDate: packDate(h.Date),
      whiteElo: Number(h.WhiteElo) || 0,
      blackElo: Number(h.BlackElo) || 0,
      whiteId: idOf(tables.players, h.White),
      blackId: idOf(tables.players, h.Black),
      eventId: idOf(tables.events, h.Event),
      siteId: idOf(tables.sites, h.Site),
      roundId: idOf(tables.rounds, h.Round),
    };
    sgParts.push(rec);
    offset += rec.length;
    return e;
  });
  return {
    si: version === 5 ? encodeIndex5(entries) : encodeIndex4(entries),
    sn: version === 5 ? encodeNames5(tables) : encodeNames4(tables),
    sg: concat(sgParts),
  };
}

// A small, representative set of games used by both the CLI and the unit tests.
export function sampleGames() {
  return [
    {
      headers: { White: 'Carlsen, Magnus', Black: 'Nakamura, Hikaru', Result: '1-0', Date: '2019.06.01', Event: 'Test Masters', Site: 'Leon ESP', Round: '1', ECO: 'C65', WhiteElo: '2875', BlackElo: '2789' },
      record: encodeGameRecord({ moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'Nf6', 'O-O', 'Nxe4', 'd4', 'Nd6'] }),
    },
    {
      headers: { White: 'Carlsen, Henrik', Black: 'Short, Nigel', Result: '0-1', Date: '2018.12.24', Event: 'Test Masters', Site: 'London ENG', Round: '2', ECO: 'B12' },
      record: encodeGameRecord({
        moves: ['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6'],
        comments: [{ afterPly: 2, text: 'A solid reply.' }],
        nags: [{ afterPly: 3, nag: 1 }],
        variations: [{ afterPly: 4, moves: ['c5', 'Nf3'] }], // alt to Black's 4th move
      }),
    },
  ];
}

// ---- CLI --------------------------------------------------------------------
function writeSet(dir, base, version) {
  const { si, sn, sg } = buildDatabase(sampleGames(), version);
  const ext = version === 5 ? ['si5', 'sn5', 'sg5'] : ['si4', 'sn4', 'sg4'];
  writeFileSync(join(dir, `${base}.${ext[0]}`), si);
  writeFileSync(join(dir, `${base}.${ext[1]}`), sn);
  writeFileSync(join(dir, `${base}.${ext[2]}`), sg);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dir = process.argv[2] || '.';
  mkdirSync(dir, { recursive: true });
  writeSet(dir, 'sample4', 4);
  writeSet(dir, 'sample5', 5);
  console.log(`Wrote sample4.si4/.sn4/.sg4 and sample5.si5/.sn5/.sg5 to ${dir}`);
}
