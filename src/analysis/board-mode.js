// Analysis > Board: enter a game yourself. You move both colours (legal moves
// only); the panel lists the moves in SAN; you can step back through them and
// play a different move from an earlier point (with a confirm before it replaces
// the rest). A big ANALYZE button hands the whole game to Review (Stage C).
import { el } from '../app/dom.js';
import { createBoard } from '../shared/board.js';
import { createGame, isValidFen, legalDests, isPromotion, kingSquare, tryMove } from '../shared/rules.js';
import { requestPromotion } from '../play/promotion.js';
import { confirmDialog } from '../app/modal.js';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const todayPgnDate = () => new Date().toISOString().slice(0, 10).replace(/-/g, '.');

/**
 * @param {HTMLElement} container  where the screen mounts
 * @param {object} opts
 * @param {string}  [opts.fen]        starting position (from #/analysis?fen=…)
 * @param {(game:object)=>void} opts.onAnalyze  called with the game to review
 */
export function createBoardMode(container, opts = {}) {
  let baseFen = opts.fen && isValidFen(opts.fen) ? opts.fen : START_FEN;
  let moves = [];   // [{ san, from, to, fenAfter }]
  let ply = 0;      // half-moves shown from baseFen (0 = start, moves.length = end)
  let orientation = 'white';
  const details = { White: '', Black: '', Event: '', Date: todayPgnDate(), Result: '*' };

  // Restore a game handed back from Review (ANALYZE → ← Board).
  if (opts.game) {
    baseFen = opts.game.baseFen && isValidFen(opts.game.baseFen) ? opts.game.baseFen : START_FEN;
    const g0 = createGame(baseFen);
    for (const m of opts.game.moves || []) {
      const r = g0.move(m.san);
      moves.push({ san: r.san, from: r.from, to: r.to, fenAfter: g0.fen() });
    }
    ply = moves.length;
    if (opts.game.headers) Object.assign(details, opts.game.headers);
  }

  const fenAt = (p) => (p === 0 ? baseFen : moves[p - 1].fenAfter);
  const lastMoveAt = (p) => (p === 0 ? null : { from: moves[p - 1].from, to: moves[p - 1].to });

  // ---- panel widgets ----
  const analyzeBtn = el('button', { type: 'button', class: 'analyze-btn', text: 'ANALYZE' });
  const statusEl = el('p', { class: 'status', role: 'status', 'aria-live': 'polite' });

  const firstBtn = el('button', { type: 'button', class: 'nav-btn', text: '⏮', 'aria-label': 'First move' });
  const prevBtn = el('button', { type: 'button', class: 'nav-btn', text: '◀', 'aria-label': 'Previous move' });
  const nextBtn = el('button', { type: 'button', class: 'nav-btn', text: '▶', 'aria-label': 'Next move' });
  const lastBtn = el('button', { type: 'button', class: 'nav-btn', text: '⏭', 'aria-label': 'Last move' });
  const navRow = el('div', { class: 'nav-row' }, [firstBtn, prevBtn, nextBtn, lastBtn]);

  const movesEl = el('div', { class: 'am-moves', role: 'list', 'aria-label': 'Moves' });

  const undoBtn = el('button', { type: 'button', class: 'am-btn', text: 'Undo' });
  const flipBtn = el('button', { type: 'button', class: 'am-btn', text: 'Flip' });
  const newBtn = el('button', { type: 'button', class: 'am-btn', text: 'New game' });

  // Set position (paste a FEN)
  const fenInput = el('input', { type: 'text', class: 'am-input', placeholder: 'Paste a FEN…', 'aria-label': 'FEN' });
  const fenApply = el('button', { type: 'button', class: 'am-btn', text: 'Set' });
  const fenError = el('p', { class: 'am-error', 'aria-live': 'polite' });
  const setPanel = el('details', { class: 'am-foldout' }, [
    el('summary', { text: 'Set position' }),
    el('div', { class: 'am-foldbody' }, [el('div', { class: 'am-inline' }, [fenInput, fenApply]), fenError]),
  ]);

  // Game details
  const dWhite = detailInput('White', details.White);
  const dBlack = detailInput('Black', details.Black);
  const dEvent = detailInput('Event', details.Event);
  const dDate = detailInput('Date', details.Date);
  const dResult = el('select', { class: 'am-input' }, [
    el('option', { value: '*' }, 'Ongoing'),
    el('option', { value: '1-0' }, 'White won'),
    el('option', { value: '0-1' }, 'Black won'),
    el('option', { value: '1/2-1/2' }, 'Draw'),
  ]);
  dResult.value = details.Result;
  const detailsPanel = el('details', { class: 'am-foldout' }, [
    el('summary', { text: 'Game details' }),
    el('div', { class: 'am-foldbody am-details' }, [
      labelled('White', dWhite), labelled('Black', dBlack),
      labelled('Event', dEvent), labelled('Date', dDate),
      labelled('Result', dResult),
    ]),
  ]);

  const toolsRow = el('div', { class: 'am-tools' }, [undoBtn, flipBtn, newBtn]);

  const panel = el('aside', { class: 'panel am-panel' }, [
    analyzeBtn, statusEl, navRow, movesEl, toolsRow, setPanel, detailsPanel,
  ]);

  const boardWrap = el('div', { class: 'board-wrap' });
  const boardArea = el('section', { class: 'board-area', 'aria-label': 'Analysis board' }, [boardWrap]);

  container.replaceChildren(el('div', { class: 'am-layout' }, [boardArea, panel]));

  // ---- board ----
  const board = createBoard(boardWrap, {
    orientation,
    playerColor: null, // either colour
    legalDests: (sq) => legalDests(viewGame(), sq),
    isPromotion: (from, to) => isPromotion(viewGame(), from, to),
    requestPromotion: (color) => requestPromotion(color, boardWrap),
    onMove,
  });
  board.setInteractive(true);

  // A fresh game at the currently-viewed ply (for legality checks + the move).
  let _viewCache = { ply: -1, game: null };
  function viewGame() {
    if (_viewCache.ply !== ply) _viewCache = { ply, game: createGame(fenAt(ply)) };
    return _viewCache.game;
  }
  function invalidateView() { _viewCache.ply = -1; }

  async function onMove({ from, to, promotion }) {
    const temp = createGame(fenAt(ply));
    const mv = tryMove(temp, { from, to, promotion });
    if (!mv) return;
    const entry = { san: mv.san, from: mv.from, to: mv.to, fenAfter: temp.fen() };

    if (ply < moves.length && moves[ply].san === entry.san) {
      ply += 1; // same as the move already on the board — just step forward
      render();
      return;
    }
    if (ply < moves.length) {
      const ok = await confirmDialog({
        title: 'Replace the rest?',
        message: 'Playing a different move here deletes the moves after this point.',
        confirmText: 'Replace', cancelText: 'Keep',
      });
      if (!ok) { render(); return; } // redraw to undo the board's optimistic deselect
      moves = moves.slice(0, ply);
    }
    moves.push(entry);
    ply += 1;
    render();
  }

  function goTo(p) { ply = Math.max(0, Math.min(moves.length, p)); render(); }

  // ---- render ----
  function render() {
    invalidateView();
    const g = viewGame();
    board.setPosition(fenAt(ply));
    const lm = lastMoveAt(ply);
    board.setLastMove(lm?.from, lm?.to);
    board.setCheck(g.isCheck() ? kingSquare(g, g.turn()) : null);

    const toMove = g.turn() === 'w' ? 'White' : 'Black';
    const atEnd = ply === moves.length;
    statusEl.textContent = atEnd
      ? `${toMove} to move.`
      : `${toMove} to move — viewing move ${ply} of ${moves.length}. A move here replaces the rest.`;

    firstBtn.disabled = prevBtn.disabled = ply === 0;
    nextBtn.disabled = lastBtn.disabled = ply === moves.length;
    undoBtn.disabled = moves.length === 0;

    renderMoves();
  }

  function renderMoves() {
    const rows = [];
    for (let i = 0; i < moves.length; i += 2) {
      rows.push(el('div', { class: 'mv-row' }, [
        el('span', { class: 'mv-no', text: `${i / 2 + 1}.` }),
        moveCell(i),
        moveCell(i + 1),
      ]));
    }
    if (rows.length === 0) rows.push(el('p', { class: 'am-empty muted', text: 'No moves yet — play a move on the board.' }));
    movesEl.replaceChildren(...rows);
    const cur = movesEl.querySelector('.mv.current');
    if (cur) cur.scrollIntoView({ block: 'nearest' });
  }

  function moveCell(k) {
    if (k >= moves.length) return el('span', { class: 'mv empty' });
    return el('button', {
      type: 'button',
      class: 'mv' + (k + 1 === ply ? ' current' : ''),
      text: moves[k].san,
      'aria-current': k + 1 === ply ? 'true' : null,
      on: { click: () => goTo(k + 1) },
    });
  }

  // ---- tools ----
  undoBtn.onclick = () => { if (moves.length === 0) return; moves.pop(); if (ply > moves.length) ply = moves.length; render(); };
  flipBtn.onclick = () => { orientation = orientation === 'white' ? 'black' : 'white'; board.setOrientation(orientation); };
  newBtn.onclick = async () => {
    if (moves.length > 0) {
      const ok = await confirmDialog({ title: 'New game?', message: 'This clears the current moves.', confirmText: 'New game', cancelText: 'Cancel' });
      if (!ok) return;
    }
    baseFen = START_FEN; moves = []; ply = 0; render();
  };

  firstBtn.onclick = () => goTo(0);
  prevBtn.onclick = () => goTo(ply - 1);
  nextBtn.onclick = () => goTo(ply + 1);
  lastBtn.onclick = () => goTo(moves.length);

  fenApply.onclick = () => {
    const fen = fenInput.value.trim();
    if (!isValidFen(fen)) { fenError.textContent = 'That is not a valid FEN.'; return; }
    baseFen = fen; moves = []; ply = 0; fenError.textContent = ''; fenInput.value = ''; setPanel.open = false;
    render();
  };

  const bindDetail = (input, key) => { input.oninput = () => { details[key] = input.value; }; };
  bindDetail(dWhite, 'White'); bindDetail(dBlack, 'Black');
  bindDetail(dEvent, 'Event'); bindDetail(dDate, 'Date');
  dResult.onchange = () => { details.Result = dResult.value; };

  analyzeBtn.onclick = () => { if (typeof opts.onAnalyze === 'function') opts.onAnalyze(buildGame()); };

  // Build the review hand-off: PGN (with headers + SetUp/FEN if needed) and the move list.
  function buildGame() {
    const g = createGame(baseFen);
    for (const [k, v] of Object.entries(details)) if (v) g.header(k, v);
    for (const m of moves) g.move(m.san);
    return {
      source: 'board',
      baseFen: baseFen === START_FEN ? null : baseFen,
      pgn: g.pgn(),
      headers: { ...details },
      moves: moves.map((m) => ({ san: m.san, from: m.from, to: m.to })),
    };
  }

  render();

  return {
    destroy() { board.destroy(); container.replaceChildren(); },
  };
}

function detailInput(name, value) {
  return el('input', { type: 'text', class: 'am-input', value, 'aria-label': name });
}
function labelled(text, control) {
  return el('label', { class: 'am-field' }, [el('span', { class: 'am-field-label', text }), control]);
}
