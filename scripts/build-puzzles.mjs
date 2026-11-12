// Build public/puzzles/level-0.json … level-11.json + index.json from the
// Lichess puzzle database (data-raw/lichess_db_puzzle.csv.zst, CC0).
//
//   node scripts/build-puzzles.mjs
//
// Streams the .zst line by line (the file is ~300 MB compressed; never loaded
// whole), buckets puzzles into 12 levels by rating, keeps good ones (relaxing
// the quality bar per level only if it's short), and picks a fixed number per
// level spread across themes with a fixed seed. Commit public/puzzles/* — never
// the raw file (it's in .gitignore).
import { openSync, readSync, closeSync, statSync } from 'node:fs';
import { writeFile, mkdir, rm, stat } from 'node:fs/promises';
import zlib from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  headerIndex, parseRow, toRecord, topThemes, createCollector, LEVEL_BANDS,
} from './puzzles-build-lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'data-raw', 'lichess_db_puzzle.csv.zst');
const OUT_DIR = join(ROOT, 'public', 'puzzles');
const PER_LEVEL = 500;
const SEED = 20240601;
const SIZE_WARN = 1.5 * 1024 * 1024;

const ZSTD_MAGIC = 0xfd2fb528;            // little-endian uint32 of 28 b5 2f fd
const SKIP_LO = 0x184d2a50;               // skippable-frame magic range (…50–…5f)
const SKIP_HI = 0x184d2a5f;

/**
 * This Lichess .zst is a sequence of chunks, each a 12-byte zstd *skippable
 * frame* (magic 0x184D2A50, whose 4-byte payload is the following data frame's
 * compressed size) directly before a standalone zstd data frame. Node's built-in
 * zstd throws "ZSTD_error_prefix_unknown" on a skippable frame, so instead of
 * streaming the whole file we walk it frame by frame and decompress each data
 * frame on its own. `onChunk(buffer)` receives each decompressed block in order.
 */
function forEachDataFrame(path, onChunk) {
  const fd = openSync(path, 'r');
  try {
    const size = statSync(path).size;
    const hdr = Buffer.alloc(12);
    let off = 0;
    let frames = 0;
    while (off + 8 <= size) {
      readSync(fd, hdr, 0, 12, off);
      const magic = hdr.readUInt32LE(0);
      let dataAt;
      let dataLen;
      if (magic >= SKIP_LO && magic <= SKIP_HI) {
        const skipSize = hdr.readUInt32LE(4);     // always 4 here
        dataLen = hdr.readUInt32LE(8);            // payload = next data-frame size
        dataAt = off + 8 + skipSize;
        off = dataAt + dataLen;
      } else if (magic === ZSTD_MAGIC) {
        // Fallback: a bare data frame to the end (no size prefix available).
        dataAt = off;
        dataLen = size - off;
        off = size;
      } else {
        throw new Error(`unexpected frame magic 0x${magic.toString(16)} at byte ${off}`);
      }
      const comp = Buffer.alloc(dataLen);
      readSync(fd, comp, 0, dataLen, dataAt);
      onChunk(zlib.zstdDecompressSync(comp));
      frames += 1;
    }
    return frames;
  } finally {
    closeSync(fd);
  }
}

async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}

async function main() {
  if (typeof zlib.createZstdDecompress !== 'function') {
    console.error('This Node build has no zstd support (zlib.createZstdDecompress is missing).');
    console.error('Upgrade to Node 22.15+ / 23.8+ (24 recommended), then re-run.');
    process.exit(1);
  }
  if (!(await exists(SRC))) {
    console.error(`Missing ${SRC}`);
    console.error('Download lichess_db_puzzle.csv.zst from https://database.lichess.org/#puzzles');
    console.error('into data-raw/ (it stays out of git), then re-run.');
    process.exit(1);
  }

  console.log('Building puzzles from the Lichess puzzle database:');

  const collector = createCollector({ perLevel: PER_LEVEL, seed: SEED });
  let idx = null;
  let lineNo = 0;
  let leftover = '';

  const processLine = (line) => {
    lineNo += 1;
    if (lineNo === 1) { idx = headerIndex(line); return; }
    if (!line) return;
    const row = parseRow(line, idx);
    if (row) collector.add(row);
    if (lineNo % 500000 === 0) process.stdout.write(`\r  read ${lineNo.toLocaleString()} rows…`);
  };

  const frames = forEachDataFrame(SRC, (buf) => {
    // A CSV row can straddle a frame boundary, so carry the partial last line.
    const text = leftover + buf.toString('utf8');
    const lines = text.split('\n');
    leftover = lines.pop();
    for (const line of lines) processLine(line.endsWith('\r') ? line.slice(0, -1) : line);
  });
  if (leftover) processLine(leftover.endsWith('\r') ? leftover.slice(0, -1) : leftover);
  process.stdout.write(`\r  read ${(lineNo - 1).toLocaleString()} rows total (${frames} frames)     \n`);

  const { levels } = collector.finalize();

  // Write the per-level files + index.json.
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });
  const index = [];
  let totalBytes = 0;
  console.log('');
  console.log('  Lv  rating        picked  tier  (of available)');
  for (const lv of levels) {
    const records = lv.rows.map(toRecord);
    const json = JSON.stringify(records);
    await writeFile(join(OUT_DIR, `level-${lv.level}.json`), json);
    totalBytes += Buffer.byteLength(json);
    const chips = topThemes(lv.rows);
    index.push({ level: lv.level, min: lv.min, max: lv.max, count: records.length, topThemes: chips });
    const range = lv.max == null ? `${lv.min}+` : `${lv.min}–${lv.max}`;
    console.log(
      `  ${String(lv.level).padStart(2)}  ${range.padEnd(12)}  ${String(records.length).padStart(5)}` +
      `   T${lv.tier}   (${lv.available.toLocaleString()})`,
    );
  }
  const indexJson = JSON.stringify(index);
  await writeFile(join(OUT_DIR, 'index.json'), indexJson);
  totalBytes += Buffer.byteLength(indexJson);

  const total = levels.reduce((s, lv) => s + lv.rows.length, 0);
  const sizeMb = (totalBytes / 1024 / 1024).toFixed(2);
  console.log('');
  console.log(`  ${LEVEL_BANDS.length} levels, ${total.toLocaleString()} puzzles, ${sizeMb} MB total.`);
  console.log(`  Wrote public/puzzles/level-0..${LEVEL_BANDS.length - 1}.json + index.json`);
  if (totalBytes > SIZE_WARN) {
    console.warn(`  WARNING: total is over 1.5 MB — consider trimming themes or lowering PER_LEVEL.`);
  }
  const short = levels.filter((lv) => lv.rows.length < PER_LEVEL);
  if (short.length) {
    console.warn(`  NOTE: ${short.length} level(s) had fewer than ${PER_LEVEL} puzzles even relaxed: ` +
      short.map((lv) => `Lv${lv.level} (${lv.rows.length})`).join(', '));
  }
}

main().catch((err) => {
  console.error('');
  console.error(`build-puzzles failed: ${err.message}`);
  process.exit(1);
});
