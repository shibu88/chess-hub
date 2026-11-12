import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../src/shared/rules.js';
import { parseScidIndex, decodeGame, _internal } from '../src/importers/scid.js';
import { buildDatabase, encodeGameRecord, sampleGames } from '../scripts/make-scid-fixture.mjs';

// Canonical SAN for a line, as chess.js renders it (so we compare like-for-like).
function sanLine(moves, fen) {
  const g = createGame(fen || undefined);
  return moves.map((m) => g.move(m).san);
}
const sgOf = (db, row) => db.sg.subarray(row.sgOffset, row.sgOffset + row.sgLength);

// --- ground-truth byte check (si4spec worked example) ------------------------
test('the move stream matches Scid\'s own worked example byte-for-byte', () => {
  // 1. b4 e5 2. Bb2 Bxb4  → piece/opcode bytes 9F CF 39 51 (si4spec §5).
  const { sg } = encodeGameRecord({ moves: ['b4', 'e5', 'Bb2', 'Bxb4'] });
  // record = [tags 0x00][flags 0x00][moves…][end 0x0F]
  assert.deepEqual([...sg], [0x00, 0x00, 0x9f, 0xcf, 0x39, 0x51, 0x0f]);
});

// --- round-trip through a whole database, both versions ----------------------
for (const version of [4, 5]) {
  test(`v${version}: index count + headers + decoded main line`, () => {
    const db = buildDatabase(sampleGames(), version);
    const idx = parseScidIndex(db.si, db.sn, version);
    assert.equal(idx.count, 2);

    const row0 = idx.row(0);
    assert.equal(row0.headers.White, 'Carlsen, Magnus');  // front-coded/LEB128 name decode
    assert.equal(row0.headers.Black, 'Nakamura, Hikaru');
    assert.equal(row0.headers.Result, '1-0');
    assert.equal(row0.headers.Date, '2019.06.01');
    assert.equal(row0.headers.ECO, 'C65');
    assert.equal(row0.headers.WhiteElo, '2875');
    assert.deepEqual(row0.deleted, false);
    assert.equal(row0.plyCount, 10);                       // half-move count from the index
    assert.equal(idx.row(1).plyCount, 6);

    const g0 = decodeGame(sgOf(db, row0), { version });
    assert.equal(g0.baseFen, null);
    assert.deepEqual(g0.sanList, sanLine(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'Nf6', 'O-O', 'Nxe4', 'd4', 'Nd6']));
  });

  test(`v${version}: shares a name prefix, and skips a variation while keeping the main line`, () => {
    const db = buildDatabase(sampleGames(), version);
    const idx = parseScidIndex(db.si, db.sn, version);
    const row1 = idx.row(1);
    assert.equal(row1.headers.White, 'Carlsen, Henrik'); // shares "Carlsen, " with game 0 (prefix path)
    const g1 = decodeGame(sgOf(db, row1), { version });
    // The main line is kept; the (4... Nf3 c5) variation is parsed but discarded.
    assert.deepEqual(g1.sanList, sanLine(['d4', 'd5', 'c4', 'e6', 'Nc3', 'Nf6']));
    assert.deepEqual(g1.nags, [{ ply: 3, nag: 1 }]);
  });
}

// --- capture renumbering: the hardest bookkeeping ----------------------------
test('decodes correctly after captures renumber pieces (the swap algorithm)', () => {
  // A Scandinavian with an early queen capture, then both sides keep moving the
  // renumbered pieces — wrong swap handling would mis-decode a later move.
  const moves = ['e4', 'd5', 'exd5', 'Qxd5', 'Nc3', 'Qa5', 'd4', 'Nf6', 'Nf3', 'c6', 'Bc4', 'Bf5'];
  const db = buildDatabase([{ headers: { White: 'A', Black: 'B', Result: '*', Event: 'E', Site: 'S', Round: '1' }, record: encodeGameRecord({ moves }) }], 4);
  const idx = parseScidIndex(db.si, db.sn, 4);
  const g = decodeGame(sgOf(db, idx.row(0)), { version: 4 });
  assert.deepEqual(g.sanList, sanLine(moves));
});

// --- promotion from a FEN start ----------------------------------------------
test('decodes a promotion and a FEN start', () => {
  const baseFen = '7k/P7/8/8/8/8/8/7K w - - 0 1';
  const db = buildDatabase([{ headers: { White: 'A', Black: 'B', Result: '1-0', Event: 'E', Site: 'S', Round: '1' }, record: encodeGameRecord({ baseFen, moves: ['a8=Q+', 'Kh7'] }) }], 5);
  const idx = parseScidIndex(db.si, db.sn, 5);
  const row = idx.row(0);
  const g = decodeGame(sgOf(db, row), { version: 5 });
  assert.equal(g.baseFen, baseFen);
  assert.deepEqual(g.sanList, sanLine(['a8=Q+', 'Kh7'], baseFen));
});

// --- main-line comments (no variations) are mapped to their plies ------------
test('maps a main-line comment to its ply when the game has no variations', () => {
  const db = buildDatabase([{
    headers: { White: 'A', Black: 'B', Result: '*', Event: 'E', Site: 'S', Round: '1' },
    record: encodeGameRecord({ moves: ['e4', 'c5', 'Nf3'], comments: [{ afterPly: 2, text: 'The Sicilian.' }] }),
  }], 4);
  const idx = parseScidIndex(db.si, db.sn, 4);
  const g = decodeGame(sgOf(db, idx.row(0)), { version: 4 });
  assert.deepEqual(g.comments, [{ ply: 2, text: 'The Sicilian.' }]);
});

// --- deleted + variant flags, and damaged data -------------------------------
test('index exposes deleted and Chess960 flags; decodeGame skips a variant', () => {
  const games = [
    { headers: { White: 'A', Black: 'B', Result: '*', Event: 'E', Site: 'S', Round: '1' }, record: encodeGameRecord({ moves: ['e4'] }), deleted: true },
    { headers: { White: 'C', Black: 'D', Result: '*', Event: 'E', Site: 'S', Round: '2' }, record: encodeGameRecord({ moves: ['d4'] }), variant: true },
  ];
  const idx = parseScidIndex(...(() => { const db = buildDatabase(games, 5); return [db.si, db.sn, 5]; })());
  assert.equal(idx.row(0).deleted, true);
  assert.equal(idx.row(1).variant, true);
  assert.deepEqual(decodeGame(new Uint8Array([0]), { variant: true }), { skipped: 'chess960' });
});

test('a Chess960 FEN (Shredder castling letters) is skipped', () => {
  // Hand-built record: tags 0x00, flags 0x01 (custom start), FEN, 0x00, end 0x0F.
  const fen = 'nrkbbqrn/pppppppp/8/8/8/8/PPPPPPPP/NRKBBQRN w GBgb - 0 1';
  const bytes = [0x00, 0x01, ...new TextEncoder().encode(fen), 0x00, 0x0f];
  assert.deepEqual(decodeGame(Uint8Array.from(bytes), { version: 5 }), { skipped: 'chess960' });
});

test('a truncated / damaged record is skipped, never thrown', () => {
  // A move byte with no end-of-game marker → the reader runs off the end.
  assert.deepEqual(decodeGame(Uint8Array.of(0x00, 0x00, 0x9f), { version: 4 }), { skipped: 'damaged' });
  // A move byte for a piece that can't make it → illegal → damaged.
  assert.deepEqual(decodeGame(Uint8Array.of(0x00, 0x00, 0x90, 0x0f), { version: 4 }).skipped, 'damaged');
});

// --- name decoding edge cases ------------------------------------------------
test('UTF-8 names round-trip; invalid UTF-8 falls back to Latin-1', () => {
  const db = buildDatabase([{ headers: { White: 'Günther, Jörg', Black: 'Åkesson', Result: '*', Event: 'E', Site: 'S', Round: '1' }, record: encodeGameRecord({ moves: ['e4'] }) }], 5);
  const idx = parseScidIndex(db.si, db.sn, 5);
  assert.equal(idx.row(0).headers.White, 'Günther, Jörg');
  assert.equal(idx.row(0).headers.Black, 'Åkesson');

  // A raw Latin-1 byte (0xFC = 'ü') that is not valid UTF-8 → fallback decode.
  const rec = [((1 << 3) | 0), 0xfc];                         // LEB128 (len1,type0) + 0xFC
  const names = _internal.parseNames5(Uint8Array.from(rec));
  assert.equal(names.players[0], 'ü');
});
