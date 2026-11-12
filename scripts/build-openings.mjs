// Build public/openings.json from the Lichess chess-openings TSVs (a–e, CC0).
//
//   node scripts/build-openings.mjs
//
// For each of a.tsv … e.tsv it uses data-raw/openings/<x>.tsv if present, else
// downloads it from GitHub. It replays every opening's PGN through chess.js and
// writes an EPD → { eco, name } map. Commit public/openings.json (never the TSVs).
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTsv, buildMap } from './openings-build-lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOCAL_DIR = join(ROOT, 'data-raw', 'openings');
const OUT = join(ROOT, 'public', 'openings.json');
const FILES = ['a', 'b', 'c', 'd', 'e'];
const BASE = 'https://raw.githubusercontent.com/lichess-org/chess-openings/master';

async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}

async function sourceText(letter) {
  const local = join(LOCAL_DIR, `${letter}.tsv`);
  if (await exists(local)) {
    console.log(`  ${letter}.tsv  (local)`);
    return readFile(local, 'utf8');
  }
  const url = `${BASE}/${letter}.tsv`;
  console.log(`  ${letter}.tsv  (download ${url})`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed for ${letter}.tsv: HTTP ${res.status}`);
  return res.text();
}

async function main() {
  console.log('Building openings from Lichess chess-openings TSVs:');
  const allRows = [];
  for (const letter of FILES) {
    const text = await sourceText(letter);
    const rows = parseTsv(text);
    console.log(`    ${rows.length} rows`);
    allRows.push(...rows);
  }

  const { map, kept, skipped } = buildMap(allRows);
  const json = JSON.stringify(map);
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, json);

  const sizeKb = (Buffer.byteLength(json) / 1024).toFixed(1);
  console.log('');
  console.log(`Positions:    ${kept} kept, ${skipped} skipped`);
  console.log(`Wrote:        public/openings.json (${sizeKb} KB)`);
  if (Buffer.byteLength(json) > 1.5 * 1024 * 1024) {
    console.warn('WARNING: openings.json is over 1.5 MB.');
  }
}

main().catch((err) => {
  console.error('');
  console.error(`build-openings failed: ${err.message}`);
  console.error('Tip: drop a.tsv … e.tsv into data-raw/openings/ to build offline,');
  console.error('or check your network connection, then re-run.');
  process.exit(1);
});
