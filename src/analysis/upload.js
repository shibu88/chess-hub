// Analysis > Upload. Drop a file, choose files, or paste PGN. We group the
// picked files (PGN/ZIP read now; Scid/ChessBase detected but "coming later"),
// parse PGN in a Web Worker with progress + Cancel, then show a searchable,
// paginated game list. Clicking a game opens it in Review.
import { el } from '../app/dom.js';
import { classifyFiles, hasReady } from './fileset.js';
import { isNative } from '../app/platform.js';

const PAGE = 50;
const fullMoves = (ply) => Math.ceil(ply / 2);

/**
 * @param {HTMLElement} container
 * @param {object} opts
 * @param {(handoff:object, state:object)=>void} opts.onOpenGame
 * @param {Array} [opts.initialGames]  restore a previously-parsed list
 */
export function createUpload(container, opts = {}) {
  let games = opts.initialGames ? opts.initialGames.slice() : [];
  let filtered = games;
  let page = 0;
  const workers = new Set(); // in-flight listing workers (PGN/ZIP + Scid)
  let decodeWorker = null;    // the short-lived worker that decodes one opened Scid game

  // ---- drop zone + inputs ----
  // In the Android app we don't set `accept`: Android's picker hides files with
  // extensions it doesn't recognise (.si4/.sg4/.cbh…), which would make a Scid or
  // ChessBase set impossible to pick. We allow everything and classify by name
  // after picking (fileset.js). The web keeps the filtered picker.
  const nativeApp = isNative();
  const fileAttrs = { type: 'file', multiple: 'multiple', class: 'visually-hidden' };
  if (!nativeApp) fileAttrs.accept = '.pgn,.zip,.si4,.sg4,.sn4,.si5,.sg5,.sn5,.cbh,.cbg,.cbp,.cbt,.cba,.cbc,.cbs';
  const fileInput = el('input', fileAttrs);
  const chooseBtn = el('button', { type: 'button', class: 'btn', text: 'Choose files' });
  const dropMain = nativeApp
    ? 'Choose a .pgn, .zip, or a Scid / ChessBase database'
    : 'Drop a .pgn, .zip, or a Scid / ChessBase database here';
  const dropzone = el('div', { class: 'dropzone', role: 'button', tabindex: '0', 'aria-label': 'Choose a PGN, ZIP, Scid or ChessBase database' }, [
    el('p', { class: 'dz-main', text: dropMain }),
    el('p', { class: 'dz-sub muted', text: 'Scid (.si4 .sg4 .sn4 / .si5 .sg5 .sn5) or ChessBase (.cbh .cbg .cbp .cbt) — pick all its files together · or' }),
    chooseBtn, fileInput,
  ]);

  const pasteArea = el('textarea', { class: 'paste-area', rows: '5', placeholder: 'Paste PGN text here…', 'aria-label': 'Paste PGN' });
  const pasteBtn = el('button', { type: 'button', class: 'btn-secondary', text: 'Parse pasted PGN' });
  const paste = el('details', { class: 'paste-fold' }, [
    el('summary', { text: 'Paste PGN' }),
    el('div', { class: 'paste-body' }, [pasteArea, pasteBtn]),
  ]);

  const statusEl = el('div', { class: 'upload-status', 'aria-live': 'polite' });

  const progText = el('p', { class: 'pmsg', text: 'Reading…' });
  const progCancel = el('button', { type: 'button', class: 'am-btn', text: 'Cancel' });
  const progress = el('div', { class: 'upload-progress', hidden: 'hidden' }, [progText, el('div', { class: 'pbar' }, [el('div', { class: 'pbar-fill busy' })]), progCancel]);

  // ---- list ----
  const searchInput = el('input', { type: 'search', class: 'am-input', placeholder: 'Search player or event…', 'aria-label': 'Search games' });
  const countEl = el('span', { class: 'list-count muted' });
  const listHead = el('div', { class: 'list-head' }, [searchInput, countEl]);
  const rowsEl = el('div', { class: 'game-rows', role: 'list' });
  const prevBtn = el('button', { type: 'button', class: 'am-btn', text: 'Prev' });
  const nextBtn = el('button', { type: 'button', class: 'am-btn', text: 'Next' });
  const pageLabel = el('span', { class: 'page-label' });
  const pager = el('div', { class: 'pager' }, [prevBtn, pageLabel, nextBtn]);
  const list = el('div', { class: 'game-list', hidden: 'hidden' }, [listHead, rowsEl, pager]);

  container.replaceChildren(el('div', { class: 'upload' }, [dropzone, paste, statusEl, progress, list]));

  // ---- parsing ----
  function handleFiles(fileList) {
    const files = [...fileList];
    if (!files.length) return;
    stopWorker();                                   // cancel any prior listing
    const report = classifyFiles(files.map((f) => f.name));
    showReport(report);

    const pgnZip = files.filter((f) => /\.(pgn|zip)$/i.test(f.name));
    if (pgnZip.length) startWorker({ files: pgnZip });

    // Each complete Scid / ChessBase set gets its own listing worker.
    const byName = new Map(files.map((f) => [f.name, f]));
    for (const g of report.groups) {
      if (g.status !== 'ready') continue;
      const pick = (ext) => byName.get(g.files.find((n) => n.toLowerCase().endsWith(ext)));
      if (g.kind === 'scid4' || g.kind === 'scid5') {
        const version = g.kind === 'scid5' ? 5 : 4;
        const si = pick(version === 5 ? '.si5' : '.si4');
        const sn = pick(version === 5 ? '.sn5' : '.sn4');
        const sg = pick(version === 5 ? '.sg5' : '.sg4');
        if (si && sn && sg) startScidWorker({ version, si, sn, sg, label: g.label });
      } else if (g.kind === 'chessbase') {
        const cbh = pick('.cbh'); const cbg = pick('.cbg'); const cbp = pick('.cbp'); const cbt = pick('.cbt');
        if (cbh && cbg && cbp && cbt) startChessbaseWorker({ cbh, cbg, cbp, cbt, label: g.label });
      }
    }
  }

  function showReport(report) {
    statusEl.replaceChildren(...report.groups
      .filter((g) => g.status !== 'ready')
      .map((g) => el('p', { class: `upload-msg ${g.status}`, text: g.message })));
  }

  // One worker finished (or failed): drop it and hide the strip once none remain.
  function finishWorker(w) {
    workers.delete(w);
    w.terminate();
    if (!workers.size) progress.hidden = true;
  }

  function startWorker(payload) {
    progress.hidden = false;
    progText.textContent = 'Reading…';
    const w = new Worker(new URL('./pgn-worker.js', import.meta.url), { type: 'module' });
    workers.add(w);
    w.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === 'progress') progText.textContent = `Reading… ${msg.games} games`;
      else if (msg.type === 'scid-set') {
        // A Scid/ChessBase set was found inside a ZIP: its bytes are in memory, so
        // wrap each in a Blob (which supports .slice()/.arrayBuffer() like a File)
        // and reuse the normal listing/decoding path.
        const blob = (u8) => new Blob([u8]);
        startScidWorker({ version: msg.version, si: blob(msg.si), sn: blob(msg.sn), sg: blob(msg.sg), label: msg.base });
      } else if (msg.type === 'chessbase-set') {
        const blob = (u8) => new Blob([u8]);
        startChessbaseWorker({ cbh: blob(msg.cbh), cbg: blob(msg.cbg), cbp: blob(msg.cbp), cbt: blob(msg.cbt), label: msg.base });
      } else if (msg.type === 'result') { onParsed(msg.games, msg.errors); finishWorker(w); }
      else if (msg.type === 'error') { appendError(msg.message); finishWorker(w); }
    };
    w.onerror = () => { appendError('The file reader crashed.'); finishWorker(w); };
    w.postMessage(payload);
  }

  // List a Scid set: the worker reads the index + names and streams back rows.
  // We tag each row with what the decoder needs so opening it later is lazy.
  function startScidWorker({ version, si, sn, sg, label }) {
    progress.hidden = false;
    progText.textContent = 'Reading…';
    const w = new Worker(new URL('./scid-worker.js', import.meta.url), { type: 'module' });
    workers.add(w);
    w.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === 'rows') {
        // Tag each row with what the decoder needs, then append without re-cloning
        // the whole list. The worker streams these in batches so a huge DB never
        // freezes the tab.
        for (const row of msg.games) {
          row._scid = { version: msg.version, variant: row._scidVariant, sg, offset: row._scidOffset, length: row._scidLength };
        }
        appendRows(msg.games);
        progText.textContent = `Reading… ${games.length} games`;
      } else if (msg.type === 'list-done') {
        if (games.length === 0) appendMessage('No games were found.');
        else applyFilter(searchInput.value);           // final render, honouring any search
        finishWorker(w);
      } else if (msg.type === 'error') { appendError(`${label}: ${msg.message}`); finishWorker(w); }
    };
    w.onerror = () => { appendError(`${label}: the Scid reader crashed.`); finishWorker(w); };
    w.postMessage({ type: 'list', version, si, sn });
  }

  // List a ChessBase set: the worker reads the index + entity files and streams
  // rows; each row is tagged with the .cbg file + offset so opening it is lazy.
  function startChessbaseWorker({ cbh, cbg, cbp, cbt, label }) {
    progress.hidden = false;
    progText.textContent = 'Reading…';
    const w = new Worker(new URL('./chessbase-worker.js', import.meta.url), { type: 'module' });
    workers.add(w);
    w.onmessage = (e) => {
      const msg = e.data;
      if (msg.type === 'rows') {
        for (const row of msg.games) {
          row._cb = { cbg, offset: row._cbOffset, variant: row._cbVariant };
        }
        appendRows(msg.games);
        progText.textContent = `Reading… ${games.length} games`;
      } else if (msg.type === 'list-done') {
        if (games.length === 0) appendMessage('No games were found.');
        else applyFilter(searchInput.value);
        finishWorker(w);
      } else if (msg.type === 'error') { appendError(`${label}: ${msg.message}`); finishWorker(w); }
    };
    w.onerror = () => { appendError(`${label}: the ChessBase reader crashed.`); finishWorker(w); };
    w.postMessage({ type: 'list', cbh, cbp, cbt });
  }

  function stopWorker() {
    for (const w of workers) w.terminate();
    workers.clear();
    if (decodeWorker) { decodeWorker.terminate(); decodeWorker = null; }
    progress.hidden = true;
  }

  progCancel.onclick = () => { stopWorker(); appendMessage('Reading cancelled.'); };

  function onParsed(newGames, errors) {
    for (const g of newGames) games.push(g);       // push, not concat — no O(n²) regrowth
    if (errors && errors.length) appendMessage(`${errors.length} game${errors.length === 1 ? '' : 's'} could not be read and were skipped.`);
    if (games.length === 0) { appendMessage('No games were found.'); return; }
    page = 0; searchInput.value = '';
    applyFilter('');
  }

  // Append a streamed batch of Scid rows and paint the first page as it fills,
  // throttled to a macrotask so a million rows don't trigger a render per batch.
  let renderPending = false;
  function appendRows(batch) {
    const first = games.length === 0;
    for (const g of batch) games.push(g);
    if (first) { page = 0; applyFilter(''); return; }   // show the list on the first batch
    if (renderPending) return;
    renderPending = true;
    setTimeout(() => {
      renderPending = false;
      // Only live-update while the user is on page 1 with no search — don't yank
      // them back a page or clobber a mid-stream search.
      if (page === 0 && !searchInput.value.trim()) { filtered = games; renderList(); }
    }, 0);
  }

  function appendMessage(text) { statusEl.append(el('p', { class: 'upload-msg', text })); }
  function appendError(text) { statusEl.append(el('p', { class: 'upload-msg unsupported', text })); }

  // ---- list rendering ----
  function applyFilter(q) {
    const s = q.trim().toLowerCase();
    filtered = !s ? games : games.filter((g) => {
      const h = g.headers;
      return [h.White, h.Black, h.Event].some((v) => v && v.toLowerCase().includes(s));
    });
    page = 0;
    renderList();
  }

  function renderList() {
    list.hidden = false;
    const total = filtered.length;
    const pages = Math.max(1, Math.ceil(total / PAGE));
    page = Math.min(page, pages - 1);
    countEl.textContent = `${total} game${total === 1 ? '' : 's'}`;
    pageLabel.textContent = `Page ${page + 1} of ${pages}`;
    prevBtn.disabled = page === 0;
    nextBtn.disabled = page >= pages - 1;

    const slice = filtered.slice(page * PAGE, page * PAGE + PAGE);
    rowsEl.replaceChildren(...slice.map((g) => gameRow(g)));
  }

  function gameRow(g) {
    const h = g.headers;
    const title = `${h.White || '?'} – ${h.Black || '?'}`;
    const movesMeta = Number.isFinite(g.plyCount) ? `${fullMoves(g.plyCount)} moves` : null;
    const meta = [h.Result, h.Date, h.Event, h.ECO, movesMeta].filter(Boolean).join(' · ');
    return el('button', {
      type: 'button', class: 'game-row', 'aria-label': `Open ${h.White || '?'} versus ${h.Black || '?'}`,
      on: { click: () => openGame(g) },
    }, [
      el('span', { class: 'gr-title', text: title }),
      el('span', { class: 'gr-meta muted', text: meta }),
    ]);
  }

  // PGN rows carry their SAN already; Scid and ChessBase rows decode one game on
  // demand (the worker slices just that game's move bytes), surfacing a note if it
  // can't be read.
  async function openGame(g) {
    // Worker URLs must be literal `new URL('./…', import.meta.url)` so Vite bundles
    // the worker chunk; build the right one per source, then share the decode flow.
    let worker = null;
    let payload = null;
    if (g._scid) {
      worker = new Worker(new URL('./scid-worker.js', import.meta.url), { type: 'module' });
      payload = { type: 'decode', version: g._scid.version, variant: g._scid.variant, sg: g._scid.sg, offset: g._scid.offset, length: g._scid.length };
    } else if (g._cb) {
      worker = new Worker(new URL('./chessbase-worker.js', import.meta.url), { type: 'module' });
      payload = { type: 'decode', cbg: g._cb.cbg, offset: g._cb.offset };
    } else { handOff(g); return; }

    progress.hidden = false;
    progText.textContent = 'Opening game…';
    let decoded;
    try { decoded = await decodeInWorker(worker, payload); } catch { decoded = { skipped: 'damaged' }; }
    progress.hidden = true;
    if (decoded.skipped) {
      appendMessage(decoded.skipped === 'chess960'
        ? 'This game is a chess variant and can’t be analysed.'
        : 'This game couldn’t be read and was skipped.');
      return;
    }
    handOff({ baseFen: decoded.baseFen, sanList: decoded.sanList, headers: g.headers });
  }

  function handOff(g) {
    const handoff = {
      source: 'upload',
      baseFen: g.baseFen || null,
      moves: g.sanList.map((san) => ({ san })),
      headers: { ...g.headers },
    };
    if (typeof opts.onOpenGame === 'function') opts.onOpenGame(handoff, { games });
  }

  // Drive one decode in the given fresh worker (Scid or ChessBase); resolves to
  // { sanList, baseFen } or { skipped }.
  function decodeInWorker(w, payload) {
    return new Promise((resolve, reject) => {
      if (decodeWorker) decodeWorker.terminate();
      decodeWorker = w;
      const clear = () => { w.terminate(); if (decodeWorker === w) decodeWorker = null; };
      w.onmessage = (e) => {
        const msg = e.data;
        if (msg.type === 'decoded') { clear(); const { type, ...rest } = msg; resolve(rest); }
        else if (msg.type === 'error') { clear(); reject(new Error(msg.message)); }
      };
      w.onerror = () => { clear(); reject(new Error('decode crashed')); };
      w.postMessage(payload);
    });
  }

  // ---- events ----
  chooseBtn.onclick = () => fileInput.click();
  fileInput.onchange = () => handleFiles(fileInput.files);
  dropzone.onclick = (e) => { if (e.target === dropzone || e.target.classList.contains('dz-main') || e.target.classList.contains('dz-sub')) fileInput.click(); };
  dropzone.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } };
  dropzone.ondragover = (e) => { e.preventDefault(); dropzone.classList.add('over'); };
  dropzone.ondragleave = () => dropzone.classList.remove('over');
  dropzone.ondrop = (e) => { e.preventDefault(); dropzone.classList.remove('over'); handleFiles(e.dataTransfer.files); };
  pasteBtn.onclick = () => { const t = pasteArea.value.trim(); if (t) { stopWorker(); statusEl.replaceChildren(); startWorker({ texts: [t] }); } };
  // Debounce search so filtering a large in-memory list doesn't lag per keystroke.
  let searchTimer = null;
  searchInput.oninput = () => {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => applyFilter(searchInput.value), 180);
  };
  prevBtn.onclick = () => { if (page > 0) { page -= 1; renderList(); } };
  nextBtn.onclick = () => { page += 1; renderList(); };

  if (games.length) applyFilter('');

  return {
    destroy() { stopWorker(); container.replaceChildren(); },
  };
}
