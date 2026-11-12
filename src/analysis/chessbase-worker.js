// Reads ChessBase databases off the main thread, two ways:
//   { type:'list', cbh, cbp, cbt } → read the index + entity files, stream the list.
//   { type:'decode', cbg, offset } → slice ONE game's .cbg record and decode it.
// Only the index (.cbh) + entity files (.cbp/.cbt) are read whole; a game's move
// bytes are read lazily with Blob/File.slice (CLAUDE.md: never load a whole .cbg).
// A game's length isn't in the index, so decode reads the record's 4-byte header
// first, then slices exactly that many bytes. The main thread terminates the worker.
import { parseCbhIndex, decodeGame, gameRecordLength } from '../importers/chessbase.js';

const BATCH = 5000; // stream rows in batches so a huge DB never clones one giant array

async function doList({ cbh, cbp, cbt }) {
  const cbhBytes = new Uint8Array(await cbh.arrayBuffer());
  const cbpBytes = new Uint8Array(await cbp.arrayBuffer());
  const cbtBytes = new Uint8Array(await cbt.arrayBuffer());
  const idx = parseCbhIndex(cbhBytes, cbpBytes, cbtBytes);
  let buffer = [];
  let total = 0;
  const flush = () => {
    if (!buffer.length) return;
    total += buffer.length;
    self.postMessage({ type: 'rows', games: buffer });
    buffer = [];
  };
  for (let i = 0; i < idx.count; i += 1) {
    const row = idx.row(i);
    if (!row || row.deleted || row.isText) continue;   // hide deleted + guiding-text records
    buffer.push({
      source: 'upload',
      headers: row.headers,
      baseFen: null,
      _cbOffset: row.sgOffset,
      _cbVariant: row.variant,
    });
    if (buffer.length >= BATCH) flush();
  }
  flush();
  self.postMessage({ type: 'list-done', total });
}

async function doDecode({ cbg, offset }) {
  const head = new Uint8Array(await cbg.slice(offset, offset + 4).arrayBuffer());
  const len = gameRecordLength(head);
  if (!len) { self.postMessage({ type: 'decoded', skipped: 'damaged' }); return; }
  const bytes = new Uint8Array(await cbg.slice(offset, offset + len).arrayBuffer());
  self.postMessage({ type: 'decoded', ...decodeGame(bytes) });
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
