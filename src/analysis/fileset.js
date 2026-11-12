// Group the files a user picks into recognisable database "sets" and say what
// we can do with each. We read PGN, ZIP, Scid 4/5 and ChessBase; a complete set
// is 'ready', an incomplete one names its missing companion file. The ChessBase
// archive formats (.cbv/.cbz/.cbone/2CBH) stay unsupported (export to PGN).
// Pure + no DOM, so it's unit-tested directly.
//
// Sets (CLAUDE.md "File readers"):
//   PGN        .pgn
//   Scid 4     .si4 .sg4 .sn4
//   Scid 5     .si5 .sg5 .sn5
//   ChessBase  .cbh .cbg .cbp .cbt  (+ optional .cba .cbc .cbs)
//   ZIP        .zip  (may hold any of the above)

const SCID4 = ['si4', 'sg4', 'sn4'];
const SCID5 = ['si5', 'sg5', 'sn5'];
const CB_REQ = ['cbh', 'cbg', 'cbp', 'cbt'];
const CB_OPT = ['cba', 'cbc', 'cbs'];
const UNSUPPORTED = ['cbv', 'cbz', 'cbone', '2cbh'];

function splitName(name) {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return { base: name, ext: '' };
  return { base: name.slice(0, dot), ext: name.slice(dot + 1).toLowerCase() };
}

const listAnd = (arr) => arr.join(', ');

/**
 * @param {string[]} names  the picked file names
 * @returns {{ groups: Array<{kind,status,label,files,missing?,message}> }}
 *   status: 'ready' (pgn/zip/complete scid or chessbase) | 'incomplete' (set missing a file) | 'unsupported' (archive/unknown)
 */
export function classifyFiles(names) {
  const groups = [];
  const scid4 = new Map(); // base -> Set(ext)
  const scid5 = new Map();
  const cb = new Map();
  const add = (map, base, ext) => { if (!map.has(base)) map.set(base, new Set()); map.get(base).add(ext); };

  for (const name of names) {
    const { base, ext } = splitName(name);
    if (ext === 'pgn') groups.push({ kind: 'pgn', status: 'ready', label: name, files: [name] });
    else if (ext === 'zip') groups.push({ kind: 'zip', status: 'ready', label: name, files: [name] });
    else if (SCID4.includes(ext)) add(scid4, base, ext);
    else if (SCID5.includes(ext)) add(scid5, base, ext);
    else if (CB_REQ.includes(ext) || CB_OPT.includes(ext)) add(cb, base, ext);
    else if (UNSUPPORTED.includes(ext)) {
      groups.push({ kind: ext, status: 'unsupported', label: name, files: [name], message: `${name} can’t be read. Please export it to PGN and upload that.` });
    } else {
      groups.push({ kind: 'unknown', status: 'unsupported', label: name, files: [name], message: `${name} is not a format we can read. Please upload a PGN or ZIP.` });
    }
  }

  const scidGroup = (map, req, name) => {
    for (const [base, exts] of map) {
      const present = req.filter((e) => exts.has(e));
      const missing = req.filter((e) => !exts.has(e)).map((e) => `${base}.${e}`);
      const files = present.map((e) => `${base}.${e}`);
      // A complete set is ready to read; an incomplete one names what's missing.
      const status = missing.length ? 'incomplete' : 'ready';
      const message = missing.length
        ? `${name} set “${base}” is incomplete — missing ${listAnd(missing)}.`
        : undefined;
      groups.push({ kind: name === 'Scid 4' ? 'scid4' : 'scid5', status, label: base, files, missing, message });
    }
  };
  scidGroup(scid4, SCID4, 'Scid 4');
  scidGroup(scid5, SCID5, 'Scid 5');

  // ChessBase: the four base files (.cbh .cbg .cbp .cbt) are required; .cba/.cbc/
  // .cbs are optional extras we include when present. All four → ready; otherwise
  // incomplete, naming the missing required file(s).
  for (const [base, exts] of cb) {
    const present = [...CB_REQ, ...CB_OPT].filter((e) => exts.has(e));
    const missing = CB_REQ.filter((e) => !exts.has(e)).map((e) => `${base}.${e}`);
    const files = present.map((e) => `${base}.${e}`);
    const status = missing.length ? 'incomplete' : 'ready';
    const message = missing.length
      ? `ChessBase set “${base}” is incomplete — missing ${listAnd(missing)}.`
      : undefined;
    groups.push({ kind: 'chessbase', status, label: base, files, missing, message });
  }

  return { groups };
}

/** True if any group can be parsed now (PGN or ZIP). */
export function hasReady(report) {
  return report.groups.some((g) => g.status === 'ready');
}
