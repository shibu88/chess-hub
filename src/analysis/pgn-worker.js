// Parses uploaded PGN text and PGN files inside ZIPs, off the main thread, and
// also finds a Scid or ChessBase database packed inside a ZIP. The main thread
// posts { files: File[], texts: string[] }; this worker streams progress, posts a
// `scid-set` / `chessbase-set` for each complete database it unpacks from a ZIP
// (the main thread lists/decodes it through the normal path), and posts one final
// `result` with the PGN games. Cancel is done by the main thread calling terminate().
import { unzipSync, strFromU8 } from 'fflate';
import { parseAllGames } from './pgn-parse.js';
import { classifyFiles } from './fileset.js';

// A ZIP must be decompressed to be read, so a database member inside one is held
// in memory. Bound it so a hostile/huge entry fails clearly instead of hanging.
const SIZE_CAP = 256 * 1024 * 1024;

self.onmessage = async (e) => {
  const { files = [], texts = [] } = e.data || {};
  const games = [];
  const errors = [];
  const tick = () => self.postMessage({ type: 'progress', games: games.length });

  const absorb = (text, source) => {
    const res = parseAllGames(text, { onProgress: tick });
    for (const g of res.games) { g.source = source; games.push(g); }
    for (const er of res.errors) errors.push({ ...er, source });
    tick();
  };

  const isDbSet = (g) => (g.kind === 'scid4' || g.kind === 'scid5' || g.kind === 'chessbase') && g.status === 'ready';

  // Pull PGN games and Scid/ChessBase sets out of one ZIP. Two passes over the
  // archive: first read the directory (filter returns false → nothing is
  // decompressed) and classify the names; then decompress only the usable entries.
  const handleZip = async (file, name) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const dir = [];
    try {
      unzipSync(bytes, { filter: (f) => { if (!/\/$/.test(f.name)) dir.push(f.name); return false; } });
    } catch { errors.push({ source: name, message: `${name}: not a valid ZIP` }); return; }

    const report = classifyFiles(dir);
    const wanted = new Set();
    for (const g of report.groups) {
      if (g.kind === 'pgn' || isDbSet(g)) for (const n of g.files) wanted.add(n);
    }

    const oversize = new Set();
    let out = {};
    if (wanted.size) {
      try {
        out = unzipSync(bytes, {
          filter: (f) => {
            if (!wanted.has(f.name)) return false;
            if (f.originalSize > SIZE_CAP) { oversize.add(f.name); return false; }
            return true;
          },
        });
      } catch { errors.push({ source: name, message: `${name}: could not be unpacked` }); return; }
    }

    let produced = 0;   // readable things (PGN / Scid / ChessBase set) found
    let noted = 0;      // actionable notes raised (incomplete set)
    const pick = (g, ext) => out[g.files.find((n) => n.toLowerCase().endsWith(ext))];
    const tooBig = (g) => g.files.some((n) => wanted.has(n) && (oversize.has(n) || !out[n]));
    for (const g of report.groups) {
      if (g.kind === 'pgn') {
        const b = out[g.files[0]];
        if (b) { absorb(strFromU8(b), `${name} › ${g.files[0]}`); produced += 1; }
      } else if (isDbSet(g) && tooBig(g)) {
        errors.push({ source: name, message: `${name}: “${g.label}” is too large to read from a ZIP — unzip it first.` });
        noted += 1;
      } else if (isDbSet(g) && (g.kind === 'scid4' || g.kind === 'scid5')) {
        const version = g.kind === 'scid5' ? 5 : 4;
        const si = pick(g, version === 5 ? '.si5' : '.si4');
        const sn = pick(g, version === 5 ? '.sn5' : '.sn4');
        const sg = pick(g, version === 5 ? '.sg5' : '.sg4');
        self.postMessage({ type: 'scid-set', version, base: `${name} › ${g.label}`, si, sn, sg }, [si.buffer, sn.buffer, sg.buffer]);
        produced += 1;
      } else if (isDbSet(g) && g.kind === 'chessbase') {
        const cbh = pick(g, '.cbh'); const cbg = pick(g, '.cbg'); const cbp = pick(g, '.cbp'); const cbt = pick(g, '.cbt');
        self.postMessage({ type: 'chessbase-set', base: `${name} › ${g.label}`, cbh, cbg, cbp, cbt }, [cbh.buffer, cbg.buffer, cbp.buffer, cbt.buffer]);
        produced += 1;
      } else if (g.status === 'incomplete') {
        errors.push({ source: name, message: `${name}: ${g.message}` });
        noted += 1;
      }
    }
    if (!produced && !noted) errors.push({ source: name, message: `${name}: no PGN, Scid or ChessBase database inside` });
  };

  try {
    for (const text of texts) absorb(text, 'pasted');

    for (const file of files) {
      const name = file.name || 'file';
      if (/\.zip$/i.test(name)) await handleZip(file, name);
      else absorb(await file.text(), name);
    }
    self.postMessage({ type: 'result', games, errors });
  } catch (err) {
    self.postMessage({ type: 'error', message: err && err.message ? err.message : String(err) });
  }
};
