// The puzzle board + controls, shared by the path and endless Training modes.
// It owns one shared board (src/shared/board.js), loads puzzles into it with
// setPuzzle(), animates the opponent's first move, checks the solver's moves
// against src/training/puzzle.js, and reports each finished puzzle via onDone.
import { el } from '../app/dom.js';
import { createBoard } from '../shared/board.js';
import { createGame, legalDests as ruleDests, isPromotion as ruleIsPromo, kingSquare, tryMove } from '../shared/rules.js';
import { requestPromotion } from '../play/promotion.js';
import { createPuzzleSolver, parseUci } from './puzzle.js';
import { setPendingReview } from '../analysis/handoff.js';

const FIRST_MOVE_MS = 600; // pause before the opponent's move so it reads as a move
const REPLY_MS = 400;      // pause before the app plays its reply
const SOLUTION_STEP_MS = 550;

// Readable labels for the Lichess theme tokens we're likely to show.
const THEME_LABELS = {
  mateIn1: 'Mate in 1', mateIn2: 'Mate in 2', mateIn3: 'Mate in 3', mateIn4: 'Mate in 4',
  mate: 'Mate', fork: 'Fork', pin: 'Pin', skewer: 'Skewer', discoveredAttack: 'Discovered attack',
  hangingPiece: 'Hanging piece', endgame: 'Endgame', opening: 'Opening', middlegame: 'Middlegame',
  sacrifice: 'Sacrifice', deflection: 'Deflection', doubleCheck: 'Double check', backRankMate: 'Back-rank mate',
  advancedPawn: 'Advanced pawn', promotion: 'Promotion', crushing: 'Crushing', advantage: 'Advantage',
  short: 'Short', long: 'Long', oneMove: 'One move', quietMove: 'Quiet move', trappedPiece: 'Trapped piece',
  attraction: 'Attraction', clearance: 'Clearance', interference: 'Interference', zugzwang: 'Zugzwang',
  defensiveMove: 'Defensive move', capturingDefender: 'Remove the defender', kingsideAttack: 'Kingside attack',
  queensideAttack: 'Queenside attack', exposedKing: 'Exposed king', intermezzo: 'Zwischenzug',
};
function themeLabel(token) {
  return THEME_LABELS[token] || token.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase());
}

/**
 * @param {HTMLElement} container
 * @param {object} opts
 * @param {(result:{solved:boolean, firstTry:boolean, puzzle:object})=>void} [opts.onDone]
 * @param {()=>void} [opts.onNext]  called when the user presses Next
 */
export function createPuzzleBoard(container, opts = {}) {
  let solver = null;
  let puzzle = null;
  let uiGame = null;        // chess.js at the current interactive position
  let usedHelp = false;
  let wrongCount = 0;
  let done = false;
  let hintLevel = 0;        // 0 none, 1 highlight the piece, 2+ also draw the move arrow
  const timers = new Set();

  const timer = (fn, ms) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); return id; };
  const clearTimers = () => { for (const id of timers) clearTimeout(id); timers.clear(); };

  // ---- DOM ----
  const boardWrap = el('div', { class: 'board-wrap' });
  const boardArea = el('section', { class: 'board-area', 'aria-label': 'Puzzle board' }, [boardWrap]);

  const statusEl = el('p', { class: 'status', role: 'status', 'aria-live': 'polite' });
  const hintBtn = el('button', { type: 'button', text: 'Hint' });
  const undoBtn = el('button', { type: 'button', text: 'Undo' });
  const solutionBtn = el('button', { type: 'button', text: 'Show solution' });
  // Skip (go to a new puzzle without solving, not counted) only when the mode
  // offers it — the path's fixed 10-puzzle set doesn't.
  const skipBtn = typeof opts.onSkip === 'function' ? el('button', { type: 'button', text: 'Skip' }) : null;
  const nextBtn = el('button', { type: 'button', class: 'primary', text: 'Next' });
  const analyzeBtn = el('button', { type: 'button', text: 'Analyze' });
  const controls = el('div', { class: 'puzzle-controls' },
    [hintBtn, undoBtn, solutionBtn, skipBtn, nextBtn, analyzeBtn].filter(Boolean));

  const resultTitle = el('p', { class: 'puzzle-result-title' });
  const resultMeta = el('p', { class: 'puzzle-result-meta' });
  const resultThemes = el('div', { class: 'puzzle-themes' });
  const resultCard = el('div', { class: 'puzzle-result', hidden: 'hidden' }, [resultTitle, resultMeta, resultThemes]);

  const panel = el('aside', { class: 'puzzle-panel' }, [statusEl, controls, resultCard]);
  container.replaceChildren(el('div', { class: 'puzzle-layout' }, [boardArea, panel]));

  // ---- the shared board (created once, reused for every puzzle) ----
  const board = createBoard(boardWrap, {
    orientation: 'white',
    playerColor: null, // the solver may be White or Black; only legal moves register anyway
    legalDests: (sq) => (uiGame ? ruleDests(uiGame, sq) : []),
    isPromotion: (from, to) => (uiGame ? ruleIsPromo(uiGame, from, to) : false),
    requestPromotion: (color) => requestPromotion(color, boardWrap),
    onMove: (mv) => onUserMove(mv),
  });

  function sideName() { return solver.solverColor === 'w' ? 'White' : 'Black'; }
  function setStatus(text) { statusEl.textContent = text; }

  // The puzzle's objective, spelled out from its themes (e.g. "Mate in 2").
  function taskLabel() {
    const tokens = typeof puzzle.themes === 'string' ? puzzle.themes.split(/\s+/) : (puzzle.themes || []);
    const mate = tokens.find((t) => /^mateIn\d+$/.test(t));
    if (mate) return 'Mate in ' + mate.slice(6);
    if (tokens.includes('mate')) return 'find the checkmate';
    if (tokens.includes('crushing')) return 'find the winning move';
    return 'find the best move';
  }
  function yourMoveStatus() { return `${sideName()} to play — ${taskLabel()}.`; }

  // Clear the hint highlight + move arrow for a fresh decision.
  function clearHelp() { hintLevel = 0; board.setHint(null); board.setArrows([]); }
  // Undo is offered only when a completed solver move can be taken back; Skip
  // is offered until the puzzle is finished.
  function syncButtons() {
    undoBtn.disabled = !(solver && !done && solver.canUndo());
    if (skipBtn) skipBtn.disabled = done;
  }

  function refreshCheck() {
    const g = createGame(solver.currentFen());
    board.setCheck(g.isCheck() ? kingSquare(g, g.turn()) : null);
  }

  function flashWrong(from, to) {
    for (const sq of [from, to]) {
      const cell = boardWrap.querySelector(`.sq[data-square="${sq}"]`);
      if (!cell) continue;
      cell.classList.remove('flash-wrong');
      void cell.offsetWidth; // restart the animation
      cell.classList.add('flash-wrong');
      timer(() => cell.classList.remove('flash-wrong'), 500);
    }
  }

  // ---- load a puzzle ----
  function setPuzzle(p) {
    clearTimers();
    puzzle = p;
    solver = createPuzzleSolver(p);
    uiGame = null;
    usedHelp = false;
    wrongCount = 0;
    done = false;

    resultCard.hidden = true;
    hintBtn.disabled = false;
    solutionBtn.disabled = false;
    nextBtn.disabled = true;
    undoBtn.disabled = true;
    if (skipBtn) skipBtn.disabled = false;
    board.setOrientation(solver.orientation);
    clearHelp();
    board.setInteractive(false);
    board.setPosition(solver.currentFen());
    board.setLastMove(null);
    board.setCheck(null);
    setStatus(`${solver.solverColor === 'w' ? 'Black' : 'White'} to move — watch…`);

    timer(() => {
      const fm = solver.firstMove();
      board.setPosition(solver.currentFen());
      if (fm) board.setLastMove(fm.from, fm.to);
      refreshCheck();
      if (solver.done) { finish(solver.solved); return; }
      uiGame = createGame(solver.currentFen());
      board.setInteractive(true);
      syncButtons();
      setStatus(yourMoveStatus());
    }, FIRST_MOVE_MS);
  }

  // ---- a solver move ----
  function onUserMove(move) {
    if (done || !solver || solver.status !== 'solving') return;
    const res = solver.tryUser(move);
    if (res.status === 'wrong') {
      wrongCount += 1;
      flashWrong(move.from, move.to);
      setStatus('Not the move — try again.');
      return;
    }
    if (res.status === 'continue') {
      board.setInteractive(false);
      board.setPosition(res.userFen);
      board.setLastMove(res.userMove.from, res.userMove.to);
      refreshCheck();
      setStatus('Good — keep going.');
      clearHelp();
      timer(() => {
        board.setPosition(res.replyFen);
        board.setLastMove(res.replyMove.from, res.replyMove.to);
        refreshCheck();
        uiGame = createGame(res.replyFen);
        board.setInteractive(true);
        syncButtons();
        setStatus(yourMoveStatus());
      }, REPLY_MS);
      return;
    }
    if (res.status === 'solved') {
      board.setInteractive(false);
      board.setPosition(res.userFen);
      board.setLastMove(res.userMove.from, res.userMove.to);
      refreshCheck();
      finish(true);
    }
  }

  // ---- finish a puzzle (solved or failed) ----
  function finish(solved) {
    done = true;
    uiGame = null;
    board.setInteractive(false);
    clearHelp();
    syncButtons();
    const firstTry = solved && wrongCount === 0 && !usedHelp;

    resultTitle.textContent = solved ? (firstTry ? 'Solved — first try ⭐' : 'Solved ✓') : 'Solution shown';
    resultTitle.classList.toggle('ok', solved);
    resultTitle.classList.toggle('miss', !solved);
    resultMeta.textContent = `Rating ${puzzle.rating}`;
    const tokens = (typeof puzzle.themes === 'string' ? puzzle.themes.split(/\s+/) : (puzzle.themes || [])).filter(Boolean);
    resultThemes.replaceChildren(...tokens.map((t) => el('span', { class: 'chip', text: themeLabel(t) })));
    resultCard.hidden = false;
    setStatus(solved ? 'Puzzle solved.' : 'Here is the solution.');

    hintBtn.disabled = true;
    solutionBtn.disabled = true;
    nextBtn.disabled = false;
    nextBtn.focus();
    if (opts.onDone) opts.onDone({ solved, firstTry, puzzle });
  }

  // ---- buttons ----
  // First tap highlights the piece to move; a second tap draws the move arrow.
  hintBtn.onclick = () => {
    if (done || !solver || solver.status !== 'solving') return;
    usedHelp = true;
    hintLevel += 1;
    board.setHint(solver.hintSquare());
    if (hintLevel >= 2) {
      const uci = solver.expectedUci();
      if (uci) board.setArrows([{ from: uci.slice(0, 2), to: uci.slice(2, 4), kind: 'best' }]);
      setStatus('Hint: the arrow shows the move to play.');
    } else {
      setStatus('Hint: move the highlighted piece. Tap Hint again to see the move.');
    }
  };

  undoBtn.onclick = () => {
    if (!solver) return;
    const res = solver.undo();
    if (!res) return;
    clearHelp();
    board.setPosition(res.fen);
    board.setLastMove(res.from, res.to);
    refreshCheck();
    uiGame = createGame(res.fen);
    board.setInteractive(true);
    syncButtons();
    setStatus('Took it back. ' + yourMoveStatus());
  };

  solutionBtn.onclick = () => {
    if (done || !solver) return;
    usedHelp = true;
    board.setInteractive(false);
    clearHelp();
    undoBtn.disabled = true;
    clearTimers();
    const steps = solver.revealSolution();
    setStatus('Showing the solution…');
    let i = 0;
    const playStep = () => {
      if (i >= steps.length) { finish(false); return; }
      const s = steps[i];
      board.setPosition(s.fen);
      board.setLastMove(s.from, s.to);
      refreshCheck();
      i += 1;
      timer(playStep, SOLUTION_STEP_MS);
    };
    playStep();
  };

  nextBtn.onclick = () => { if (opts.onNext) opts.onNext(); };

  if (skipBtn) {
    skipBtn.onclick = () => { if (!done && puzzle && opts.onSkip) opts.onSkip(puzzle); };
  }

  // Analyze: hand the puzzle's full solution line (from its starting position)
  // to the Analysis Review, so the engine labels every move — rather than just
  // dropping a static position on the board with nothing to analyze.
  analyzeBtn.onclick = () => {
    if (!puzzle) return;
    const uciList = Array.isArray(puzzle.moves) ? puzzle.moves : String(puzzle.moves).trim().split(/\s+/);
    const g = createGame(puzzle.fen);
    const moves = [];
    for (const uci of uciList) {
      const mv = tryMove(g, parseUci(uci));
      if (!mv) break;
      moves.push({ san: mv.san });
    }
    setPendingReview({
      source: 'board',
      baseFen: puzzle.fen,
      moves,
      headers: { White: 'Puzzle', Black: 'Puzzle', Event: 'Training puzzle', Date: '', Result: '*' },
    });
    window.location.hash = '#/analysis';
  };

  return {
    setPuzzle,
    destroy() {
      clearTimers();
      board.destroy();
      container.replaceChildren();
    },
  };
}
