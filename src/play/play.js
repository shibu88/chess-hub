// Play vs Stockfish. Layout and flow follow the earlier Chess vs Stockfish
// project: clocks around the board, an always-visible controls card, and
// New Game / Restart instead of a separate setup screen.
import { el, mount } from '../app/dom.js';
import { createBoard } from '../shared/board.js';
import { createClock } from '../shared/clock.js';
import { Engine, LEVELS, getLevel, ENGINE_VERSION } from '../shared/engine.js';
import {
  createGame, isValidFen, legalDests, isPromotion, kingSquare, tryMove, gameResult,
} from '../shared/rules.js';
import { requestPromotion } from './promotion.js';
import { engineDrawResponse } from './draw.js';
import { saveGame } from '../store/index.js';
import { setPendingReview } from '../analysis/handoff.js';
import { saveFile } from '../app/save-file.js';

const TIMES = [3, 5, 10, 15];
const DEFAULT = { levelId: 'intermediate', color: 'w', timeMin: 10 };
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const LOW_MS = 60000;

function fmtTime(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function renderPlay(view, { query } = { query: new URLSearchParams() }) {
  const fenParam = query && query.get('fen');
  const startFen = fenParam && isValidFen(fenParam) ? fenParam : START_FEN;
  const startSide = createGame(startFen).turn();

  // live game state
  let game = null, engine = null, clock = null, board = null;
  let playerColor = 'w', engineColor = 'b', level = getLevel(DEFAULT.levelId);
  let orientation = 'white', activeColor = null, gameOver = false;
  let currentOpts = null; // the options the running game started with (for Restart)

  // ---- controls ----
  const levelSel = el('select', { id: 'difficulty' }, LEVELS.map((l) => el('option', { value: l.id }, l.name)));
  levelSel.value = DEFAULT.levelId;
  const colorSel = el('select', { id: 'color' }, [el('option', { value: 'w' }, 'White'), el('option', { value: 'b' }, 'Black')]);
  colorSel.value = fenParam ? startSide : DEFAULT.color;
  const timeSel = el('select', { id: 'time' }, TIMES.map((t) => el('option', { value: String(t) }, `${t} min per player`)));
  timeSel.value = String(DEFAULT.timeMin);

  const newBtn = el('button', { type: 'button', class: 'primary', text: 'New Game' });
  const restartBtn = el('button', { type: 'button', text: 'Restart' });
  const controls = el('div', { class: 'controls' }, [
    el('label', {}, ['Difficulty', levelSel]),
    el('label', {}, ['Play as', colorSel]),
    el('label', {}, ['Time control', timeSel]),
    el('div', { class: 'buttons' }, [newBtn, restartBtn]),
    el('p', { class: 'hint', text: 'New Game uses the options above. Restart replays the current game from the start.' }),
  ]);

  // ---- board + clocks ----
  const boardWrap = el('div', { class: 'board-wrap' });
  const topName = el('span', { class: 'clock-name' });
  const topTime = el('span', { class: 'clock-time', role: 'timer' });
  const botName = el('span', { class: 'clock-name' });
  const botTime = el('span', { class: 'clock-time', role: 'timer' });
  const clockTop = el('div', { class: 'clock' }, [topName, topTime]);
  const clockBottom = el('div', { class: 'clock' }, [botName, botTime]);
  const boardArea = el('section', { class: 'board-area', 'aria-label': 'Game board' }, [clockTop, boardWrap, clockBottom]);

  // ---- panel widgets ----
  const statusEl = el('p', { class: 'status', role: 'status', 'aria-live': 'polite' });
  const thinkingEl = el('p', { class: 'thinking', hidden: 'hidden' }, [el('span', { class: 'spinner', 'aria-hidden': 'true' }), ' Computer is thinking…']);

  const drawBtn = el('button', { type: 'button', text: 'Offer draw' });
  const resignBtn = el('button', { type: 'button', class: 'danger', text: 'Resign' });
  const gameActions = el('div', { class: 'game-actions' }, [drawBtn, resignBtn]);

  const resignYes = el('button', { type: 'button', class: 'danger', text: 'Yes, resign' });
  const resignNo = el('button', { type: 'button', text: 'Cancel' });
  const resignConfirm = el('div', { class: 'resign-confirm', role: 'alertdialog', 'aria-label': 'Confirm resignation', hidden: 'hidden' }, [
    el('p', { text: 'Resign this game? Stockfish will be declared the winner.' }),
    el('div', { class: 'buttons' }, [resignYes, resignNo]),
  ]);

  const retryBtn = el('button', { type: 'button', text: 'Retry loading engine' });
  const engineError = el('div', { class: 'engine-error', role: 'alert', hidden: 'hidden' }, [
    el('p', { text: 'The engine had a problem.' }), retryBtn,
  ]);

  const saveBtn = el('button', { type: 'button', class: 'primary', text: 'Save to My games' });
  const downloadBtn = el('button', { type: 'button', text: 'Download PGN' });
  const analyzeBtn = el('button', { type: 'button', text: 'Analyze' });
  const saveStatus = el('span', { class: 'save-status', 'aria-live': 'polite' });
  const gameoverActions = el('div', { class: 'gameover-actions', hidden: 'hidden' }, [saveBtn, downloadBtn, analyzeBtn, saveStatus]);

  const historyEl = el('ol', { class: 'history', 'aria-label': 'Move history' });
  const historyPanel = el('details', { class: 'history-panel', open: 'open' }, [el('summary', { text: 'Move history' }), historyEl]);

  const panel = el('aside', { class: 'panel' }, [
    statusEl, thinkingEl, gameActions, resignConfirm, engineError, gameoverActions, controls, historyPanel,
  ]);

  mount(view, el('section', { class: 'play', 'aria-labelledby': 'play-h' }, [
    el('h1', { id: 'play-h', class: 'visually-hidden', text: 'Play vs Stockfish' }),
    el('div', { class: 'layout' }, [boardArea, panel]),
  ]));

  // ---- helpers ----
  function setStatus(text, kind) {
    statusEl.textContent = text;
    statusEl.classList.toggle('game-over', kind === 'over');
    statusEl.classList.toggle('check', kind === 'check');
  }

  function renderClocks(rem) {
    const r = rem || { w: clock?.getRemaining('w') ?? 0, b: clock?.getRemaining('b') ?? 0 };
    topName.textContent = level.name;
    botName.textContent = 'You';
    topTime.textContent = fmtTime(r[engineColor]);
    botTime.textContent = fmtTime(r[playerColor]);
    clockTop.classList.toggle('active', activeColor === engineColor);
    clockBottom.classList.toggle('active', activeColor === playerColor);
    clockTop.classList.toggle('low', r[engineColor] < LOW_MS);
    clockBottom.classList.toggle('low', r[playerColor] < LOW_MS);
  }

  function renderHistory() {
    const moves = game.history();
    const items = [];
    for (let i = 0; i < moves.length; i += 2) {
      items.push(el('li', {}, [el('span', { text: moves[i] }), el('span', { text: moves[i + 1] || '' })]));
    }
    historyEl.replaceChildren(...items);
    historyEl.scrollTop = historyEl.scrollHeight;
  }

  function refreshBoard(lastMove) {
    board.setPosition(game.fen());
    board.setLastMove(lastMove?.from, lastMove?.to);
    board.setCheck(game.isCheck() ? kingSquare(game, game.turn()) : null);
    renderHistory();
  }

  function showEngineError(retryAction) {
    engineError.hidden = false;
    thinkingEl.hidden = true;
    retryBtn.onclick = () => { engineError.hidden = true; retryAction(); };
  }

  // ---- turn flow ----
  function playerTurn() {
    if (gameOver) return;
    activeColor = playerColor;
    thinkingEl.hidden = true;
    board.setInteractive(true);
    clock.setTurn(playerColor);
    setStatus(game.isCheck() ? 'Your move — check!' : 'Your move.', game.isCheck() ? 'check' : null);
  }

  async function engineTurn() {
    if (gameOver) return;
    activeColor = engineColor;
    board.setInteractive(false);
    thinkingEl.hidden = false;
    clock.setTurn(engineColor);
    setStatus(`${level.name} to move.`);
    const cap = clock.engineBudget(engineColor);
    const movetime = Math.max(50, Math.min(level.movetime, cap || level.movetime));
    try {
      const res = await engine.bestMove(game.fen(), { movetime, depth: level.depth });
      if (gameOver) return;
      thinkingEl.hidden = true;
      if (!res.uci) { checkEnd(); return; }
      const mv = tryMove(game, { from: res.from, to: res.to, promotion: res.promotion });
      if (!mv) throw new Error(`Engine returned illegal move ${res.uci}`);
      refreshBoard({ from: res.from, to: res.to });
      if (!checkEnd()) playerTurn();
    } catch (err) {
      console.error('engine move failed', err);
      clock.setTurn(null);
      activeColor = null;
      setStatus('Engine problem.');
      showEngineError(() => engineTurn());
    }
  }

  async function onPlayerMove({ from, to, promotion }) {
    if (gameOver) return;
    const mv = tryMove(game, { from, to, promotion });
    if (!mv) return;
    board.setInteractive(false);
    refreshBoard({ from, to });
    if (!checkEnd()) engineTurn();
  }

  function checkEnd() {
    const res = gameResult(game);
    if (!res.over) return false;
    let resultText;
    if (res.result === '1/2-1/2') resultText = 'Draw';
    else {
      const winnerColor = res.result === '1-0' ? 'w' : 'b';
      resultText = winnerColor === playerColor ? 'You win' : `${level.name} wins`;
    }
    endGame(res.result, `by ${res.reason}`, resultText);
    return true;
  }

  function endGame(result, reasonText, resultText) {
    if (gameOver) return;
    gameOver = true;
    activeColor = null;
    clock.stop();
    board.setInteractive(false);
    thinkingEl.hidden = true;
    renderClocks();
    setStatus(`${resultText} ${reasonText}.`, 'over');
    game.header('Result', result);
    if (engine) { engine.terminate(); engine = null; }
    drawBtn.disabled = true;
    resignBtn.disabled = true;
    resignConfirm.hidden = true;
    gameoverActions.hidden = false;
    saveBtn.disabled = false;
    saveStatus.textContent = '';
    saveBtn.dataset.result = result;
  }

  function buildRecord(result) {
    return {
      pgn: game.pgn(),
      headers: { White: game.header().White, Black: game.header().Black, Result: result },
      source: 'play',
      result,
      engine: { version: ENGINE_VERSION, level: level.id },
      startFen: startFen === START_FEN ? null : startFen,
    };
  }

  function downloadPgn() {
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '').replace(/(\d{8})(\d{4})/, '$1-$2');
    // Goes through save-file.js: download link on web, Share sheet in the app.
    saveFile(`chesshub-${stamp}.pgn`, game.pgn(), 'application/x-chess-pgn');
  }

  // ---- buttons ----
  drawBtn.onclick = async () => {
    if (gameOver || game.turn() !== playerColor) return;
    drawBtn.disabled = true;
    setStatus('You offered a draw…');
    try {
      const resp = await engineDrawResponse(game, engine);
      if (gameOver) return;
      if (resp.accepted) endGame('1/2-1/2', 'by agreement', 'Draw');
      else { setStatus(`Draw declined (${resp.reason}). Your move.`); drawBtn.disabled = false; }
    } catch (err) {
      console.error('draw eval failed', err);
      setStatus('Could not check the draw offer. Your move.');
      drawBtn.disabled = false;
    }
  };

  resignBtn.onclick = () => { if (!gameOver) resignConfirm.hidden = false; };
  resignNo.onclick = () => { resignConfirm.hidden = true; };
  resignYes.onclick = () => {
    resignConfirm.hidden = true;
    if (gameOver) return;
    const result = playerColor === 'w' ? '0-1' : '1-0';
    endGame(result, 'by resignation', `${level.name} wins`);
  };

  saveBtn.onclick = async () => {
    saveBtn.disabled = true;
    saveStatus.textContent = 'Saving…';
    try { await saveGame(buildRecord(saveBtn.dataset.result)); saveStatus.textContent = 'Saved ✓'; }
    catch (err) { saveBtn.disabled = false; saveStatus.textContent = 'Could not save'; console.error('save failed', err); }
  };
  downloadBtn.onclick = () => downloadPgn();
  analyzeBtn.onclick = () => {
    const h = game.header();
    setPendingReview({
      source: 'play',
      baseFen: startFen === START_FEN ? null : startFen,
      moves: game.history().map((san) => ({ san })),
      headers: { White: h.White, Black: h.Black, Result: h.Result, Event: h.Event, Date: h.Date },
    });
    window.location.hash = '#/analysis';
  };

  newBtn.onclick = () => startGame({ levelId: levelSel.value, color: colorSel.value, timeMin: Number(timeSel.value) });
  restartBtn.onclick = () => { if (currentOpts) startGame(currentOpts); };

  function teardown() {
    if (engine) { engine.terminate(); engine = null; }
    if (clock) { clock.destroy(); clock = null; }
    if (board) { board.destroy(); board = null; }
  }

  // ---- start a game ----
  async function startGame(opts) {
    teardown();
    currentOpts = { ...opts };
    gameOver = false;
    level = getLevel(opts.levelId);
    playerColor = opts.color === 'b' ? 'b' : 'w';
    engineColor = playerColor === 'w' ? 'b' : 'w';
    orientation = playerColor === 'w' ? 'white' : 'black';
    const timeMin = Number(opts.timeMin) || DEFAULT.timeMin;

    gameoverActions.hidden = true;
    engineError.hidden = true;
    resignConfirm.hidden = true;
    drawBtn.disabled = false;
    resignBtn.disabled = false;

    game = createGame(startFen);
    game.header('Event', 'Chess Hub', 'Site', 'Chess Hub',
      'Date', new Date().toISOString().slice(0, 10).replace(/-/g, '.'),
      'White', playerColor === 'w' ? 'You' : `Stockfish (${level.name})`,
      'Black', playerColor === 'b' ? 'You' : `Stockfish (${level.name})`);

    board = createBoard(boardWrap, {
      orientation, playerColor,
      legalDests: (sq) => legalDests(game, sq),
      isPromotion: (from, to) => isPromotion(game, from, to),
      requestPromotion: (color) => requestPromotion(color, boardWrap),
      onMove: onPlayerMove,
    });

    clock = createClock({
      initialMs: timeMin * 60000,
      onTick: (rem) => renderClocks(rem),
      onFlag: (color) => {
        if (gameOver) return;
        const result = color === 'w' ? '0-1' : '1-0';
        const winnerColor = color === 'w' ? 'b' : 'w';
        endGame(result, 'on time', winnerColor === playerColor ? 'You win' : `${level.name} wins`);
      },
    });

    activeColor = null;
    refreshBoard(null);
    renderClocks();
    setStatus('Starting the engine…');

    engine = new Engine();
    try {
      await engine.start();
      await engine.setLevel(level);
      await engine.newGame();
    } catch (err) {
      console.error('engine start failed', err);
      setStatus('Engine problem.');
      showEngineError(() => startGame(currentOpts));
      return;
    }

    if (game.turn() === playerColor) playerTurn();
    else engineTurn();
  }

  startGame({ levelId: DEFAULT.levelId, color: colorSel.value, timeMin: DEFAULT.timeMin });

  return () => teardown();
}
