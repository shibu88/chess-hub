// Analysis screen. Three sub-tabs — Upload | Board | My games — mount into one
// content area; the screen owns which is active and tears the old one down on
// switch. Board is live now (Stage B); Upload and My games arrive in later
// stages. Reads #/analysis?fen=… to seed the Board.
import { el, mount } from '../app/dom.js';
import { createBoardMode } from './board-mode.js';
import { createReviewView } from './review-view.js';
import { createUpload } from './upload.js';
import { createMyGames } from './mygames.js';
import { takePendingReview } from './handoff.js';

const TABS = [
  { id: 'upload', label: 'Upload' },
  { id: 'board', label: 'Board' },
  { id: 'mygames', label: 'My games' },
];

export function renderAnalysis(view, ctx = {}) {
  const query = ctx.query || new URLSearchParams();
  const fenParam = query.get('fen');

  let current = null; // the active sub-view, if it has a teardown
  const clearCurrent = () => { if (current && current.destroy) current.destroy(); current = null; };

  const content = el('div', { class: 'analysis-content' });
  const tabBtns = new Map();
  const nav = el('div', { class: 'subtabs', role: 'tablist', 'aria-label': 'Analysis sections' },
    TABS.map((t) => {
      const btn = el('button', {
        type: 'button', class: 'subtab', role: 'tab', text: t.label,
        on: { click: () => activate(t.id) },
      });
      tabBtns.set(t.id, btn);
      return btn;
    }));

  mount(view, el('section', { class: 'analysis', 'aria-labelledby': 'analysis-h' }, [
    el('h1', { id: 'analysis-h', class: 'visually-hidden', text: 'Analysis' }),
    nav,
    content,
  ]));

  function setActiveTab(id) {
    for (const [tabId, btn] of tabBtns) {
      const active = tabId === id;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    }
  }

  function activate(id) {
    clearCurrent();
    setActiveTab(id);
    content.replaceChildren();
    if (id === 'board') mountBoard(null);
    else if (id === 'upload') mountUpload(null);
    else mountMyGames();
  }

  // The Board tab: a fresh board (seeded by ?fen=), or one restored from a game
  // the user came back to from Review.
  function mountBoard(seed) {
    clearCurrent();
    setActiveTab('board');
    content.replaceChildren();
    current = createBoardMode(content, { fen: seed ? undefined : fenParam, game: seed || undefined, onAnalyze });
  }

  // The Upload tab: a fresh dropzone, or one restored with a parsed list.
  function mountUpload(state) {
    clearCurrent();
    setActiveTab('upload');
    content.replaceChildren();
    current = createUpload(content, { onOpenGame, initialGames: state && state.games });
  }

  function mountMyGames() {
    clearCurrent();
    setActiveTab('mygames');
    content.replaceChildren();
    current = createMyGames(content, { onOpenGame: onOpenSaved });
  }

  // ANALYZE from the Board → run the Review on the same game; "← Board" returns
  // to the board with the game intact.
  function onAnalyze(gameData) {
    if (!gameData.moves.length) return;
    openReview(gameData, () => mountBoard(gameData));
  }

  // Open an uploaded game → Review; back returns to the upload list intact.
  function onOpenGame(handoff, uploadState) {
    openReview(handoff, () => mountUpload(uploadState));
  }

  // Open a saved game from My games → Review; back returns to My games.
  function onOpenSaved(handoff) {
    openReview(handoff, () => mountMyGames());
  }

  function openReview(gameData, onBack) {
    clearCurrent();
    content.replaceChildren();
    current = createReviewView(content, { game: gameData, onBack, savedId: gameData.savedId });
  }

  // A game handed off from Play's "Analyze" button opens straight into Review.
  const pending = takePendingReview();
  if (pending && pending.moves && pending.moves.length) {
    setActiveTab('board');
    openReview(pending, () => mountBoard(pending));
  } else {
    activate('board'); // Board is the working sub-tab by default (and seeded by ?fen=)
  }

  return () => clearCurrent();
}
