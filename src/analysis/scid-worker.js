// Reads Scid databases off the main thread, two ways:
//   { type:'list', ... }   → read the index + names, build the game list.
//   { type:'decode', ... } → slice ONE game's .sg bytes and decode its main line.
// Only the index (.si) and names (.sn) are read whole; a game's move bytes are
// read lazily with File.slice (CLAUDE.md: never load a whole .sg into memory).
// The main thread terminates the worker when done — no cancel message needed.
import { parseScidIndex, decodeGame } from '../importers/scid.js';

const BATCH = 5000; // stream a batch of rows every N so a million-game index never
                    // builds one giant array or clones it in a single postMessage.

async function doList({ version, si, sn }) {
  const siBytes = new Uint8Array(await si.arrayBuffer());
  const snBytes = new Uint8Array(await sn.arrayBuffer());
  const idx = parseScidIndex(siBytes, snBytes, version);
  let buffer = [];
  let total = 0;
  const flush = () => {
    if (!buffer.length) return;
    total += buffer.length;
    self.postMessage({ type: 'rows', games: buffer, version });
    buffer = [];                                 // hand the batch off; don't keep a growing array
  };
  for (let i = 0; i < idx.count; i += 1) {
    const row = idx.row(i);
    if (!row || row.deleted) continue;           // hide deleted games (Scid's default)
    buffer.push({
      source: 'upload',
      headers: row.headers,
      baseFen: null,
      plyCount: row.plyCount,
      _scidOffset: row.sgOffset,
      _scidLength: row.sgLength,
      _scidVariant: row.variant,
    });
    if (buffer.length >= BATCH) flush();
  }
  flush();
  self.postMessage({ type: 'list-done', version, total });
}

async function doDecode({ version, variant, sg, offset, length }) {
  const slice = sg.slice(offset, offset + length);
  const bytes = new Uint8Array(await slice.arrayBuffer());
  const result = decodeGame(bytes, { version, variant });
  self.postMessage({ type: 'decoded', ...result });
}

self.onmessage = async (e) => {
  const msg = e.data || {};
  try {
    if (msg.type === 'list') await doList(msg);
    else if (msg.type === 'decode') await doDecode(msg);
    else self.postMessage({ type: 'error', message: `unknown request: ${msg.type}` });
  } catch (err) {
    self.postMessage({ type: 'error', message: err && err.message ? err.message : String(err) });
  }
};
