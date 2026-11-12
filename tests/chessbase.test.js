import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../src/shared/rules.js';
import { parseCbhIndex, decodeGame, gameRecordLength, _internal } from '../src/importers/chessbase.js';
import { buildDatabase, sampleGames, encodeGameRecord } from '../scripts/make-cbh-fixture.mjs';

// Canonical SAN for a line, as chess.js renders it (so we compare like-for-like).
function sanLine(moves, fen) {
  const g = createGame(fen || undefined);
  return moves.map((m) => g.move(m).san);
}
const recOf = (db, row) => {
  const len = gameRecordLength(db.cbg.subarray(row.sgOffset, row.sgOffset + 4));
  return db.cbg.subarray(row.sgOffset, row.sgOffset + len);
};

// --- ground-truth byte check (hand-derived from cbh2pgn's own tables) ---------
test('the move stream matches a hand-derived obfuscated byte sequence', () => {
  // 1.e4 e5 2.Nf3 Nc6: pawn-e(0,2)=0xFF twice, Nf3=0xFE, Nc6=0xDD, each +movesSoFar,
  // then end-of-game 0x0C+4 → bytes FF 00 00 E0 10 (see tasks notes).
  const { moveBytes } = encodeGameRecord({ moves: ['e4', 'e5', 'Nf3', 'Nc6'] });
  assert.deepEqual([...moveBytes], [0xFF, 0x00, 0x00, 0xE0, 0x10]);

  // and the decoder reads those literal bytes back to the same line (pins the tables)
  const rec = Uint8Array.from([0x00, 0x00, 0x00, 4 + moveBytes.length, ...moveBytes]);
  assert.deepEqual(decodeGame(rec).sanList, ['e4', 'e5', 'Nf3', 'Nc6']);
});

// --- round-trip through a whole database --------------------------------------
test('index count + headers + decoded main lines (incl. capture + castling)', () => {
  const db = buildDatabase(sampleGames());
  const idx = parseCbhIndex(db.cbh, db.cbp, db.cbt);
  assert.equal(idx.count, 2);

  const row0 = idx.row(0);
  assert.equal(row0.headers.White, 'Carlsen, Magnus'); // "Last, First" from .cbp
  assert.equal(row0.headers.Black, 'Nakamura, Hikaru');
  assert.equal(row0.headers.Result, '1-0');
  assert.equal(row0.headers.Date, '2019.06.01');
  assert.equal(row0.headers.Event, 'Test Masters');   // title from .cbt
  assert.equal(row0.headers.Site, 'Leon ESP');        // place from .cbt
  assert.equal(row0.headers.Round, '1');
  assert.equal(row0.headers.WhiteElo, '2875');
  assert.equal(row0.deleted, false);
  assert.equal(row0.isText, false);

  const g0 = decodeGame(recOf(db, row0));
  assert.deepEqual(g0.sanList, sanLine(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'Nf6', 'O-O', 'Nxe4', 'd4', 'Nd6']));
  assert.ok(g0.sanList.includes('O-O'));   // castling updates K + rook in the piece list
  assert.ok(g0.sanList.includes('Nxe4'));  // capture renumbers the piece list

  const row1 = idx.row(1);
  assert.equal(row1.headers.Round, '2.1'); // round.subround
  assert.deepEqual(decodeGame(recOf(db, row1)).sanList, sanLine(['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6', 'Bg5', 'Be7']));
});

// --- promotion via a two-byte move + a setup (non-initial) start position -----
test('a setup start position decodes to a FEN, and a promotion (2-byte move) works', () => {
  const fen = '8/P6k/8/8/8/8/6K1/8 w - - 0 1';
  const rec = encodeGameRecord({ moves: ['a8=Q', 'Kg6'], baseFen: fen });
  const dec = decodeGame(rec.sg);
  assert.equal(dec.baseFen, fen);
  assert.deepEqual(dec.sanList, ['a8=Q', 'Kg6']);
});

test('under-promotion to knight (2-byte promo code 3) decodes', () => {
  const fen = '8/P6k/8/8/8/8/6K1/8 w - - 0 1';
  const dec = decodeGame(encodeGameRecord({ moves: ['a8=N', 'Kg6'], baseFen: fen }).sg);
  assert.deepEqual(dec.sanList, ['a8=N', 'Kg6']);
});

// --- the 4th piece of a kind is stored as a two-byte move ---------------------
test('moving the 4th queen uses the two-byte encoding and decodes', () => {
  // Four white queens a1,c1,e1,g1; the g1 queen is the 4th (nr 3) → 2-byte move.
  const fen = '8/8/1k6/8/8/8/8/Q1Q1Q1QK w - - 0 1';
  const { sg, moveBytes } = encodeGameRecord({ moves: ['Qg2'], baseFen: fen });
  let processed = 0;
  let saw2b = false;
  for (let i = 0; i < moveBytes.length; i += 1) {
    const t = (((moveBytes[i] - processed) % 256) + 256) % 256;
    const special = [0x29, 0xDC, 0x0C, 0x9F].includes(t);
    if (!special) processed = (processed + 1) & 255;
    if (t === 0x29) { saw2b = true; i += 2; processed = (processed + 1) & 255; }
  }
  assert.equal(saw2b, true);
  const dec = decodeGame(sg);
  assert.equal(dec.baseFen, fen);
  assert.deepEqual(dec.sanList, ['Qg2']);
});

// --- en passant (pawn diagonal to an empty square) ----------------------------
test('an en-passant capture decodes', () => {
  const moves = ['e4', 'a6', 'e5', 'd5', 'exd6']; // 5.exd6 e.p.
  const dec = decodeGame(encodeGameRecord({ moves }).sg);
  assert.deepEqual(dec.sanList, sanLine(moves));
});

// --- names: UTF-8 round-trip + Latin-1 fallback -------------------------------
test('a UTF-8 player name round-trips through .cbp', () => {
  const games = [{ headers: { White: 'Réti, Richárd', Black: 'Él, Ana', Result: '*' }, record: encodeGameRecord({ moves: ['Nf3', 'd5'] }) }];
  const db = buildDatabase(games);
  const row = parseCbhIndex(db.cbh, db.cbp, db.cbt).row(0);
  assert.equal(row.headers.White, 'Réti, Richárd');
  assert.equal(row.headers.Black, 'Él, Ana');
});

test('a non-UTF-8 name field falls back to Latin-1', () => {
  // 0xE9 alone is invalid UTF-8; as Latin-1 it is "é".
  assert.equal(_internal.decodeText(Uint8Array.of(0x52, 0xE9, 0x74, 0x69)), 'Réti');
});

// --- deleted + guiding-text rows carry flags (the worker hides them) ----------
test('deleted and guiding-text records are flagged, not decoded as games', () => {
  const games = [
    { headers: { White: 'A', Black: 'B', Result: '*' }, record: encodeGameRecord({ moves: ['e4'] }), deleted: true },
    { headers: { White: '', Black: '', Result: '*' }, record: encodeGameRecord({ moves: ['e4'] }), isText: true },
    { headers: { White: 'C', Black: 'D', Result: '*' }, record: encodeGameRecord({ moves: ['d4'] }) },
  ];
  const db = buildDatabase(games);
  const ix = parseCbhIndex(db.cbh, db.cbp, db.cbt);
  assert.equal(ix.count, 3);
  assert.equal(ix.row(0).deleted, true);
  assert.equal(ix.row(1).isText, true);
  assert.equal(ix.row(2).deleted, false);
  assert.equal(ix.row(2).isText, false);
});

// --- robustness: a corrupt record is skipped, never thrown --------------------
test('a damaged move stream returns { skipped }, without throwing', () => {
  const db = buildDatabase(sampleGames());
  const rec = Uint8Array.from(recOf(db, parseCbhIndex(db.cbh, db.cbp, db.cbt).row(0)));
  rec[4] = 0x4E; // first move byte → a rook token → illegal from the start → damaged
  const dec = decodeGame(rec);
  assert.equal(dec.skipped, 'damaged');
});

test('a Chess960 flag in the .cbg header is skipped', () => {
  // header with the 960 flag bits set → decodeGame skips without decoding.
  const h = (0x0A000000 | 5) >>> 0;
  const rec = Uint8Array.from([(h >>> 24) & 255, (h >>> 16) & 255, (h >>> 8) & 255, h & 255, 0x0f]);
  assert.equal(decodeGame(rec).skipped, 'chess960');
});

test('gameRecordLength reads the low-24-bit length from the header', () => {
  const { sg } = encodeGameRecord({ moves: ['e4', 'e5'] });
  assert.equal(gameRecordLength(sg), sg.length);
});
