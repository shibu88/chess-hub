// Analysis > My games. Lists saved games (guest IndexedDB or the signed-in
// account), filtered by source. Open re-opens a game in Review; rename, delete
// (with a confirm) and per-game / bulk download are here too.
import { el } from '../app/dom.js';
import { listGames, saveGame, deleteGame } from '../store/index.js';
import { confirmDialog } from '../app/modal.js';
import { createGame } from '../shared/rules.js';
import { downloadPgn, downloadJson } from './pgn-export.js';

const SOURCES = [
  { id: 'all', label: 'All' },
  { id: 'play', label: 'Play' },
  { id: 'board', label: 'Board' },
  { id: 'upload', label: 'Upload' },
];
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : '');

export function createMyGames(container, opts = {}) {
  let games = [];
  let filter = 'all';

  const chips = el('div', { class: 'mg-filters' }, SOURCES.map((s) => el('button', {
    type: 'button', class: 'mg-chip' + (s.id === 'all' ? ' active' : ''), text: s.label, dataset: { src: s.id },
    on: { click: () => { filter = s.id; syncChips(); render(); } },
  })));
  const dlAllBtn = el('button', { type: 'button', class: 'am-btn', text: 'Download all (PGN)' });
  const head = el('div', { class: 'mg-head' }, [chips, dlAllBtn]);
  const listEl = el('div', { class: 'mg-list' });

  container.replaceChildren(el('div', { class: 'mygames' }, [head, listEl]));

  function syncChips() {
    for (const c of chips.children) c.classList.toggle('active', c.dataset.src === filter);
  }

  const onChanged = (e) => { games = (e.detail && e.detail.games) || games; render(); };
  window.addEventListener('chesshub:games-changed', onChanged);

  async function load() {
    games = await listGames();
    render();
  }

  function filtered() {
    return filter === 'all' ? games : games.filter((g) => (g.source || 'board') === filter);
  }

  function render() {
    const list = filtered();
    dlAllBtn.disabled = list.length === 0;
    if (list.length === 0) {
      listEl.replaceChildren(el('p', { class: 'stub-msg', text: games.length ? 'No games for this filter.' : 'No saved games yet. Analyze a game and press Save.' }));
      return;
    }
    listEl.replaceChildren(...list.map(item));
  }

  function item(rec) {
    const title = rec.title || `${rec.players?.white || rec.headers?.White || '?'} – ${rec.players?.black || rec.headers?.Black || '?'}`;
    const date = rec.headers?.Date || (rec.createdAt ? new Date(rec.createdAt).toISOString().slice(0, 10) : '');
    const acc = rec.review?.accuracy;
    const accText = acc && acc.white != null ? `W ${Math.round(acc.white)} / B ${Math.round(acc.black)}` : null;
    const meta = [cap(rec.source || 'board'), date, rec.result, accText ? `Accuracy ${accText}` : null].filter(Boolean).join(' · ');

    const openBtn = el('button', { type: 'button', class: 'mg-open', on: { click: () => openGame(rec) } }, [
      el('span', { class: 'mg-badge', dataset: { src: rec.source || 'board' }, text: cap(rec.source || 'board') }),
      el('span', { class: 'mg-title', text: title }),
      el('span', { class: 'mg-meta muted', text: meta }),
    ]);
    const actions = el('div', { class: 'mg-actions' }, [
      el('button', { type: 'button', class: 'mg-act', text: 'Rename', on: { click: () => rename(rec, wrap) } }),
      el('button', { type: 'button', class: 'mg-act', text: 'PGN', on: { click: () => downloadPgn(rec, true) } }),
      el('button', { type: 'button', class: 'mg-act', text: 'JSON', on: { click: () => downloadJson(rec) } }),
      el('button', { type: 'button', class: 'mg-act danger', text: 'Delete', on: { click: () => remove(rec) } }),
    ]);
    const wrap = el('div', { class: 'mg-item' }, [openBtn, actions]);
    return wrap;
  }

  function rename(rec, wrap) {
    const input = el('input', { type: 'text', class: 'am-input', value: rec.title || '', placeholder: 'Game name', 'aria-label': 'Game name' });
    const saveBtn = el('button', { type: 'button', class: 'am-btn', text: 'Save' });
    const cancelBtn = el('button', { type: 'button', class: 'am-btn', text: 'Cancel' });
    const form = el('div', { class: 'mg-rename' }, [input, saveBtn, cancelBtn]);
    wrap.replaceChildren(form);
    input.focus();
    cancelBtn.onclick = () => render();
    saveBtn.onclick = async () => {
      saveBtn.disabled = true;
      const next = { ...rec, title: input.value.trim() };
      try { await saveGame(next); } catch (err) { console.error('rename failed', err); }
      await load();
    };
  }

  async function remove(rec) {
    const ok = await confirmDialog({ title: 'Delete game?', message: 'This removes the saved game and its analysis.', confirmText: 'Delete', cancelText: 'Cancel' });
    if (!ok) return;
    try { await deleteGame(rec.id); } catch (err) { console.error('delete failed', err); }
    await load();
  }

  // Rebuild the Review hand-off from a stored record.
  function openGame(rec) {
    let moves;
    let baseFen = rec.review?.baseFen || rec.startFen || null;
    if (rec.review?.moves?.length) {
      moves = rec.review.moves.map((m) => ({ san: m.san }));
    } else {
      const g = createGame();
      try { g.loadPgn(rec.pgn || ''); } catch { /* ignore */ }
      moves = g.history().map((san) => ({ san }));
      if (!baseFen && g.header && g.header().FEN) baseFen = g.header().FEN;
    }
    const handoff = { source: rec.source || 'board', baseFen, moves, headers: rec.headers || {}, savedId: rec.id };
    if (typeof opts.onOpenGame === 'function') opts.onOpenGame(handoff, {});
  }

  dlAllBtn.onclick = () => { const list = filtered(); if (list.length) downloadPgn(list, true); };

  load();

  return {
    destroy() { window.removeEventListener('chesshub:games-changed', onChanged); container.replaceChildren(); },
  };
}
