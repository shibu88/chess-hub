// The Training screen: a home with two cards — "Start your training" (a guided
// path that unlocks levels) and "Chess training" (endless practice from any
// level, filtered by theme). Both run puzzles through src/training/puzzle-board.js
// and track progress through src/training/progress.js (+ training-store.js).
import { el, mount } from '../app/dom.js';
import { createPuzzleBoard } from './puzzle-board.js';
import { loadIndex, loadLevel, pickVaried, buildVariedSet, solverColor } from './selection.js';
import { loadProgress, getCurrent, applyRemote, persist, persistNow } from './training-store.js';
import {
  solvedCount, startSet, recordSetOutcome, completeSet, recordAttempt, pushSeen, SET_SIZE, PASS_THRESHOLD,
} from './progress.js';

const rangeLabel = (e) => (e.max == null ? `${e.min}+` : `${e.min}–${e.max}`);

export function renderTraining(view) {
  let destroyed = false;
  let board = null;
  let indexData = null;
  let navToken = 0;   // bumped on each view switch to drop stale async loads
  let onHome = false; // true while the home view is showing (for live refresh)

  const content = el('div', { class: 'training-content' });
  mount(view, el('section', { class: 'training', 'aria-labelledby': 'training-h' }, [
    el('h1', { id: 'training-h', class: 'visually-hidden', text: 'Training' }),
    content,
  ]));

  const progress = () => getCurrent();

  // Live sync: when the signed-in account's progress changes on another device,
  // fold it in and refresh the home counts (don't disturb an active puzzle).
  function onProgressChanged(e) {
    if (destroyed || !getCurrent()) return;
    applyRemote(e.detail && e.detail.progress);
    if (onHome && indexData) renderHome();
  }
  window.addEventListener('chesshub:progress-changed', onProgressChanged);
  // Flush any pending save when the page is hidden/closed/reloaded (the router
  // cleanup only runs on in-app navigation, not a hard reload).
  const onPageHide = () => { persistNow(); };
  window.addEventListener('pagehide', onPageHide);

  function clearBoard() { if (board) { board.destroy(); board = null; } }
  function setContent(node) { clearBoard(); content.replaceChildren(node); }
  const backBtn = (onClick) => el('button', { class: 'link-btn train-back', text: '← Training home', on: { click: onClick } });

  // ---- bootstrap ----
  setContent(el('p', { class: 'muted', text: 'Loading training…' }));
  Promise.all([loadIndex(), loadProgress()]).then(([idx]) => {
    if (destroyed) return;
    indexData = idx;
    renderHome();
  }).catch((err) => {
    if (!destroyed) setContent(el('p', { class: 'training-error', role: 'alert', text: 'Could not load puzzles. ' + err.message }));
  });

  // ---- HOME ----
  function renderHome() {
    navToken += 1;
    onHome = true;
    const p = progress();
    const pathCard = el('div', { class: 'train-card' }, [
      el('h2', { text: 'Start your training' }),
      el('p', { class: 'muted', text: 'A guided path. Solve 8 of 10 puzzles first try to unlock the next level.' }),
      el('p', { class: 'train-stat' }, [
        'Current level: ', el('strong', { text: 'Lv ' + p.pathLevel }),
        '   ·   Levels passed: ', el('strong', { text: String(p.levelsPassed) }),
      ]),
      el('p', { class: 'muted', text: p.set ? `Set in progress: ${p.set.index}/${SET_SIZE}` : 'Each set is 10 puzzles.' }),
      el('button', { class: 'primary big-btn', text: p.set ? 'Continue' : 'Start training', on: { click: startPath } }),
    ]);

    const grid = el('div', { class: 'level-grid' }, indexData.map((entry) =>
      el('button', { class: 'level-card', on: { click: () => startEndless(entry.level) } }, [
        el('span', { class: 'level-no', text: 'Lv ' + entry.level }),
        el('span', { class: 'level-range', text: rangeLabel(entry) }),
        el('span', { class: 'level-solved', text: solvedCount(p, entry.level) + ' solved' }),
      ])));

    const endlessCard = el('div', { class: 'train-card' }, [
      el('h2', { text: 'Chess training' }),
      el('p', { class: 'muted', text: 'Endless puzzles from any level. Pick a level, then filter by theme.' }),
      grid,
    ]);

    setContent(el('div', { class: 'train-home' }, [pathCard, endlessCard]));
  }

  // ---- PATH ----
  async function startPath() {
    const token = (navToken += 1);
    onHome = false;
    setContent(el('p', { class: 'muted', text: 'Loading level…' }));
    const p = progress();
    const level = p.set ? p.set.level : p.pathLevel;
    let pool;
    try { pool = await loadLevel(level); } catch (err) {
      if (token === navToken && !destroyed) setContent(el('p', { class: 'training-error', role: 'alert', text: 'Could not load level ' + level + '. ' + err.message }));
      return;
    }
    if (destroyed || token !== navToken) return;

    const byId = new Map(pool.map((r) => [r.id, r]));
    let records = p.set ? p.set.ids.map((id) => byId.get(id)) : null;
    if (!p.set || p.set.index >= p.set.ids.length || records.some((r) => !r)) {
      const chosen = buildVariedSet(pool, { count: SET_SIZE, exclude: new Set(p.seenIds) });
      startSet(p, level, chosen.map((r) => r.id));
      records = chosen;
      persist();
    }
    runPath(level, records);
  }

  function runPath(level, records) {
    const p = progress();
    const total = records.length;
    let servedOrdinal = 0; // 1-based number of the puzzle currently on the board
    const heading = el('p', { class: 'train-progress' });
    const host = el('div', { class: 'puzzle-host' });
    const header = el('div', { class: 'train-mode-head' }, [
      backBtn(() => { persist(); renderHome(); }),
      el('h2', { text: `Path · Level ${level}` }),
      heading,
    ]);
    setContent(el('div', { class: 'train-mode' }, [header, host]));

    board = createPuzzleBoard(host, {
      onDone: ({ solved, firstTry, puzzle }) => {
        recordSetOutcome(p, firstTry);
        recordAttempt(p, { level, id: puzzle.id, solved });
        persist();
        updateHeading();
      },
      onNext: () => {
        if (p.set && p.set.index < total) serve();
        else finishSet();
      },
    });

    function updateHeading() {
      heading.textContent = `Puzzle ${servedOrdinal} of ${total}  ·  ${p.set ? p.set.score : 0} first-try`;
    }
    function serve() {
      servedOrdinal = p.set.index + 1;
      board.setPuzzle(records[p.set.index]);
      updateHeading();
    }

    function finishSet() {
      const out = completeSet(p);
      persistNow(); // an unlock is worth an immediate, non-debounced save
      const title = out.passed
        ? `Set passed — ${out.score}/${total} first try! Level ${out.unlockedLevel} unlocked.`
        : `${out.score}/${total} first try — you need ${PASS_THRESHOLD} to pass.`;
      const primary = el('button', { class: 'primary big-btn', text: out.passed ? `Continue to Lv ${out.unlockedLevel}` : 'Try again', on: { click: startPath } });
      setContent(el('div', { class: 'train-mode' }, [
        el('div', { class: 'train-summary' }, [
          el('h2', { text: out.passed ? 'Nice work!' : 'Keep practising' }),
          el('p', { class: out.passed ? 'train-pass' : 'train-fail', text: title }),
          el('div', { class: 'train-summary-actions' }, [primary, backBtn(renderHome)]),
        ]),
      ]));
    }

    serve();
  }

  // ---- ENDLESS ----
  async function startEndless(level) {
    const token = (navToken += 1);
    onHome = false;
    setContent(el('p', { class: 'muted', text: 'Loading level…' }));
    const entry = indexData.find((e) => e.level === level) || { level, min: 0, max: null, topThemes: [] };
    let pool;
    try { pool = await loadLevel(level); } catch (err) {
      if (token === navToken && !destroyed) setContent(el('p', { class: 'training-error', role: 'alert', text: 'Could not load level ' + level + '. ' + err.message }));
      return;
    }
    if (destroyed || token !== navToken) return;

    const p = progress();
    const solvedEl = el('span', { class: 'train-solved' });
    const host = el('div', { class: 'puzzle-host' });
    const header = el('div', { class: 'train-mode-head' }, [
      backBtn(() => { persist(); renderHome(); }),
      el('h2', { text: `Level ${level} · ${rangeLabel(entry)}` }),
      solvedEl,
    ]);
    setContent(el('div', { class: 'train-mode' }, [header, host]));

    function updateSolved() { solvedEl.textContent = `${solvedCount(p, level)} solved at this level`; }

    const recent = []; // recent solver colours, to avoid long same-colour runs

    board = createPuzzleBoard(host, {
      onDone: ({ solved, puzzle }) => { recordAttempt(p, { level, id: puzzle.id, solved }); persist(); updateSolved(); },
      onNext: serve,
      onSkip: (puzzle) => { pushSeen(p, puzzle.id); persist(); serve(); }, // skip without counting it
    });

    function serve() {
      const pick = pickVaried(pool, { exclude: new Set(p.seenIds), recent });
      if (!pick) { host.replaceChildren(el('p', { class: 'muted', text: 'No puzzles available at this level.' })); return; }
      recent.push(solverColor(pick));
      if (recent.length > 2) recent.shift();
      board.setPuzzle(pick);
    }

    updateSolved();
    serve();
  }

  return () => {
    destroyed = true;
    window.removeEventListener('chesshub:progress-changed', onProgressChanged);
    window.removeEventListener('pagehide', onPageHide);
    clearBoard();
    persistNow();
  };
}
