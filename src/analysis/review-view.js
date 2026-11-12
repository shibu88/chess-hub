// Analysis > Review. Runs Stockfish over a whole game (via engine-analysis.js),
// then shows an eval bar + graph, a labelled move list, a summary card, the
// opening name, and — for the selected move — the move played (highlighted), the
// best move (a blue arrow) and the top two engine lines with a click-through
// "best line" stepper. Keys: ←/→ step, Home/End jump.
import { el } from '../app/dom.js';
import { createBoard } from '../shared/board.js';
import { createGame, kingSquare, tryMove } from '../shared/rules.js';
import { Engine } from '../shared/engine.js';
import { loadOpenings } from './openings.js';
import { analyseGame, getDepth, DEPTHS } from './engine-analysis.js';
import { LABELS } from './review.js';
import { saveGame } from '../store/index.js';
import { reviewToRecord, downloadPgn, downloadJson } from './pgn-export.js';
import { isNative } from '../app/platform.js';
import { keepScreenOn, allowScreenSleep } from '../app/native.js';

const LABEL_STYLE = {
  Brilliant: { c: '#1bb5a6', tag: '!!', desc: 'a strong sacrifice' },
  Great: { c: '#3b82f6', tag: '!', desc: 'the only good move' },
  Best: { c: '#4c9f78', tag: '', desc: 'the engine’s top move' },
  Excellent: { c: '#79b84f', tag: '', desc: 'almost as good as the best' },
  Good: { c: '#9aa33f', tag: '', desc: 'a solid move' },
  Book: { c: '#a77b4f', tag: '', desc: 'a known opening move' },
  Inaccuracy: { c: '#e0a800', tag: '?!', desc: 'a slightly weak move' },
  Miss: { c: '#e07b39', tag: '×', desc: 'missed the opponent’s mistake' },
  Mistake: { c: '#e5733b', tag: '?', desc: 'loses some advantage' },
  Blunder: { c: '#e5534b', tag: '??', desc: 'a serious error' },
};
const SVGNS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs, kids = []) => {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  for (const c of kids) n.append(c);
  return n;
};
const uciMove = (uci) => ({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length > 4 ? uci[4] : undefined });

function fmtEval(cp) {
  if (cp >= 1000) return '+10+';
  if (cp <= -1000) return '−10+';
  const v = (Math.abs(cp) / 100).toFixed(1);
  return (cp >= 0 ? '+' : '−') + v;
}

/**
 * @param {HTMLElement} container
 * @param {object} opts
 * @param {object} opts.game       the Board/Upload hand-off (baseFen, moves, pgn, headers)
 * @param {string} [opts.depthId]  'fast' | 'standard' | 'deep'
 * @param {()=>void} opts.onBack
 * @param {(review:object)=>void} [opts.onReady]  called with the finished review (for Save, Stage E)
 */
export function createReviewView(container, opts = {}) {
  const game = opts.game;
  // Default to Fast in the app (phone CPUs) and on narrow screens; Standard on
  // a desktop browser. An explicit opts.depthId always wins.
  const smallOrApp = isNative() || (window.matchMedia && window.matchMedia('(max-width: 760px)').matches);
  let depthId = opts.depthId || (smallOrApp ? 'fast' : 'standard');
  let review = null;
  let sel = 0;             // selected move index (0..N-1)
  let lineStep = null;     // "<lineNo>:<k>" while stepping a line of the selected move
  let destroyed = false;
  let cancelRequested = false;
  let engine = null;
  let savedId = opts.savedId || undefined; // set once saved (re-save updates)

  // ---- skeleton ----
  const backBtn = el('button', { type: 'button', class: 'am-btn', text: '← Board' });
  const depthSel = el('select', { class: 'am-input depth-sel' }, DEPTHS.map((d) => el('option', { value: d.id }, `${d.name} (${(d.nodes / 1000)}k)`)));
  depthSel.value = depthId;
  const reBtn = el('button', { type: 'button', class: 'am-btn', text: 'Re-analyze' });
  const head = el('div', { class: 'review-head' }, [backBtn, depthSel, reBtn]);

  const saveBtn = el('button', { type: 'button', class: 'am-btn', text: 'Save' });
  const dlPgnBtn = el('button', { type: 'button', class: 'am-btn', text: 'Download PGN' });
  const dlJsonBtn = el('button', { type: 'button', class: 'am-btn', text: 'Download JSON' });
  const saveStatus = el('span', { class: 'save-status', 'aria-live': 'polite' });
  const reviewActions = el('div', { class: 'review-actions', hidden: 'hidden' }, [saveBtn, dlPgnBtn, dlJsonBtn, saveStatus]);

  const progressBar = el('div', { class: 'pbar' }, [el('div', { class: 'pbar-fill' })]);
  const progressText = el('p', { class: 'pmsg', role: 'status', 'aria-live': 'polite' });
  const cancelBtn = el('button', { type: 'button', class: 'am-btn', text: 'Cancel' });
  const progress = el('div', { class: 'review-progress' }, [progressText, progressBar, cancelBtn]);

  const summary = el('div', { class: 'summary-card', hidden: 'hidden' });
  const openingEl = el('p', { class: 'opening-name', hidden: 'hidden' });
  const graphWrap = el('div', { class: 'eval-graph', hidden: 'hidden' });
  const detail = el('div', { class: 'move-detail', hidden: 'hidden' });

  const firstBtn = el('button', { type: 'button', class: 'nav-btn', text: '⏮', 'aria-label': 'First move' });
  const prevBtn = el('button', { type: 'button', class: 'nav-btn', text: '◀', 'aria-label': 'Previous move' });
  const nextBtn = el('button', { type: 'button', class: 'nav-btn', text: '▶', 'aria-label': 'Next move' });
  const lastBtn = el('button', { type: 'button', class: 'nav-btn', text: '⏭', 'aria-label': 'Last move' });
  const navRow = el('div', { class: 'nav-row', hidden: 'hidden' }, [firstBtn, prevBtn, nextBtn, lastBtn]);
  const movesEl = el('div', { class: 'am-moves review-moves', role: 'list', 'aria-label': 'Moves', hidden: 'hidden' });

  const panel = el('aside', { class: 'panel review-panel' }, [head, progress, reviewActions, summary, openingEl, graphWrap, detail, navRow, movesEl]);

  const evalFill = el('div', { class: 'eval-fill' });
  const evalNum = el('span', { class: 'eval-num' });
  const evalBar = el('div', { class: 'eval-bar', 'aria-hidden': 'true' }, [evalFill, evalNum]);
  const boardWrap = el('div', { class: 'board-wrap' });
  const boardArea = el('section', { class: 'board-area review-board', 'aria-label': 'Review board' }, [
    el('div', { class: 'eval-wrap' }, [evalBar, boardWrap]),
  ]);

  container.replaceChildren(el('div', { class: 'review-layout' }, [boardArea, panel]));

  const board = createBoard(boardWrap, {
    orientation: 'white',
    playerColor: null,
    legalDests: () => [],       // review board is not for making moves
    isPromotion: () => false,
    requestPromotion: async () => null,
    onMove: () => {},
  });
  board.setInteractive(false);

  // ---- run the analysis ----
  async function run() {
    cancelRequested = false;
    showAnalysing();
    keepScreenOn(); // native-only; keep the phone awake through the review
    try {
      if (!engine) { engine = new Engine(); await engine.start(); }
      await engine.newGame();
      await loadOpenings().catch(() => {}); // Book label is optional
      const depth = getDepth(depthId);
      const result = await analyseGame(engine, game, {
        nodes: depth.nodes,
        onProgress: (done, total) => {
          const pct = total ? Math.round((done / total) * 100) : 0;
          progressBar.firstChild.style.width = `${pct}%`;
          const moveNo = Math.min(done, result0Total(total));
          progressText.textContent = `Analyzing… move ${moveNo} of ${result0Total(total)}`;
        },
        isCancelled: () => destroyed || cancelRequested,
      });
      if (destroyed) return;
      if (!result) { onBack(); return; } // cancelled
      review = result;
      sel = 0;
      if (typeof opts.onReady === 'function') opts.onReady(review);
      renderReview();
    } catch (err) {
      console.error('analysis failed', err);
      progressText.textContent = 'The engine had a problem. Go back and try again.';
      progressBar.hidden = true;
    } finally {
      allowScreenSleep(); // let the phone sleep again however the review ended
    }
  }
  const result0Total = (total) => Math.max(0, total - 1); // moves = positions − 1

  function showAnalysing() {
    progress.hidden = false;
    progressBar.hidden = false;
    progressBar.firstChild.style.width = '0%';
    for (const n of [reviewActions, summary, openingEl, graphWrap, detail, navRow, movesEl]) n.hidden = true;
  }

  // ---- render the finished review ----
  function renderReview() {
    progress.hidden = true;
    for (const n of [reviewActions, summary, graphWrap, detail, navRow, movesEl]) n.hidden = false;
    saveStatus.textContent = savedId ? 'Saved ✓' : '';
    renderSummary();
    renderOpening();
    renderGraph();
    renderMoves();
    selectMove(sel);
  }

  function renderSummary() {
    const a = review.accuracy;
    const acc = (v) => (v == null ? '—' : v.toFixed(1));
    const counts = review.labelCounts;
    const chip = (label, side) => {
      const n = counts[side][label];
      if (!n) return null;
      const st = LABEL_STYLE[label];
      return el('span', { class: 'lc-chip', title: `${label}: ${n}` }, [
        el('span', { class: 'lc-dot', dataset: { label } }), ` ${n}`,
      ]);
    };
    summary.replaceChildren(
      el('div', { class: 'acc-row' }, [
        el('div', { class: 'acc-box' }, [el('span', { class: 'acc-name', text: 'White' }), el('span', { class: 'acc-val', text: acc(a.white) })]),
        el('div', { class: 'acc-box' }, [el('span', { class: 'acc-name', text: 'Black' }), el('span', { class: 'acc-val', text: acc(a.black) })]),
      ]),
      el('p', { class: 'acc-sub muted', text: 'Accuracy' }),
      el('div', { class: 'lc-grid' }, LABELS.flatMap((label) => {
        const w = chip(label, 'w'); const b = chip(label, 'b');
        return [w, b].filter(Boolean);
      })),
      legend(),
    );
  }

  // A foldout explaining what each colour / symbol means.
  function legend() {
    return el('details', { class: 'legend' }, [
      el('summary', { text: 'What do the colours mean?' }),
      el('div', { class: 'legend-list' }, LABELS.map((label) => {
        const st = LABEL_STYLE[label];
        return el('div', { class: 'legend-row' }, [
          el('span', { class: 'lc-dot', dataset: { label } }),
          el('span', { class: 'legend-name' }, [`${label}`, st.tag ? el('span', { class: 'legend-tag', text: ` ${st.tag}` }) : null]),
          el('span', { class: 'legend-desc muted', text: st.desc }),
        ]);
      })),
    ]);
  }

  function renderOpening() {
    if (review.opening) {
      openingEl.hidden = false;
      openingEl.textContent = `Opening: ${review.opening.name} (${review.opening.eco})`;
    } else {
      openingEl.hidden = true;
    }
  }

  function renderGraph() {
    const W = 300, H = 90;
    const n = review.moves.length;
    graphWrap.replaceChildren();
    if (n === 0) return;
    const x = (i) => (n === 1 ? W / 2 : (i / (n - 1)) * W);
    const y = (win) => (1 - win / 100) * H;
    const pts = review.moves.map((m, i) => `${x(i)},${y(m.whiteWinAfter)}`).join(' ');
    const kids = [
      svg('rect', { x: 0, y: 0, width: W, height: H / 2, fill: 'rgba(0,0,0,0.25)' }),
      svg('rect', { x: 0, y: H / 2, width: W, height: H / 2, fill: 'rgba(255,255,255,0.10)' }),
      svg('line', { x1: 0, y1: H / 2, x2: W, y2: H / 2, stroke: 'var(--border)', 'stroke-width': 1 }),
      svg('polyline', { points: pts, fill: 'none', stroke: '#8ab4f8', 'stroke-width': 1.5 }),
    ];
    review.moves.forEach((m, i) => {
      const dot = svg('circle', { cx: x(i), cy: y(m.whiteWinAfter), r: i === sel ? 4 : 2.6, fill: LABEL_STYLE[m.label].c, class: 'graph-dot', 'data-i': i });
      dot.style.cursor = 'pointer';
      dot.addEventListener('click', () => selectMove(i));
      kids.push(dot);
    });
    const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'graph-svg', preserveAspectRatio: 'none' }, kids);
    graphWrap.append(s);
  }

  function renderMoves() {
    const rows = [];
    const m = review.moves;
    for (let i = 0; i < m.length; i += 2) {
      rows.push(el('div', { class: 'mv-row' }, [
        el('span', { class: 'mv-no', text: `${i / 2 + 1}.` }),
        moveCell(i), moveCell(i + 1),
      ]));
    }
    movesEl.replaceChildren(...rows);
  }

  function moveCell(i) {
    const m = review.moves[i];
    if (!m) return el('span', { class: 'mv empty' });
    const st = LABEL_STYLE[m.label];
    return el('button', {
      type: 'button', class: 'mv' + (i === sel ? ' current' : ''),
      'aria-current': i === sel ? 'true' : null,
      on: { click: () => selectMove(i) },
    }, [
      el('span', { class: 'mv-dot', dataset: { label: m.label } }),
      ` ${m.san}${st.tag}`,
    ]);
  }

  function selectMove(i) {
    sel = Math.max(0, Math.min(review.moves.length - 1, i));
    lineStep = null;
    const m = review.moves[sel];
    board.setPosition(review.positions[sel + 1]); // position AFTER the move
    board.setLastMove(m.playedUci.slice(0, 2), m.playedUci.slice(2, 4));
    const g = createGame(review.positions[sel + 1]);
    board.setCheck(g.isCheck() ? kingSquare(g, g.turn()) : null);
    board.setArrows(m.bestUci && m.bestUci !== m.playedUci ? [{ from: m.bestUci.slice(0, 2), to: m.bestUci.slice(2, 4), kind: 'best' }] : []);
    setEvalBar(m.whiteWinAfter, m.scoreWhiteCp);
    firstBtn.disabled = prevBtn.disabled = sel === 0;
    nextBtn.disabled = lastBtn.disabled = sel === review.moves.length - 1;
    renderDetail();
    // refresh current markers in list + graph
    for (const btn of movesEl.querySelectorAll('.mv')) btn.classList.remove('current');
    const cells = movesEl.querySelectorAll('.mv');
    if (cells[sel]) { cells[sel].classList.add('current'); cells[sel].scrollIntoView({ block: 'nearest' }); }
    renderGraph();
  }

  function setEvalBar(whiteWin, cp) {
    evalFill.style.height = `${Math.max(0, Math.min(100, whiteWin))}%`;
    evalNum.textContent = fmtEval(cp);
    evalNum.classList.toggle('neg', cp < 0);
  }

  function renderDetail() {
    const m = review.moves[sel];
    const st = LABEL_STYLE[m.label];
    const header = el('div', { class: 'md-head' }, [
      el('span', { class: 'md-label', dataset: { label: m.label } , text: m.label }),
      el('span', { class: 'md-san', text: `${m.moverColor === 'w' ? 'White' : 'Black'} played ${m.san}` }),
    ]);
    const bestLine = (m.bestSan && m.bestSan !== m.san)
      ? el('p', { class: 'md-best muted', text: `Best was ${m.bestSan}.` })
      : el('p', { class: 'md-best muted', text: 'This was the engine’s top move.' });

    const lines = el('div', { class: 'md-lines' });
    if (m.pv1San.length) lines.append(pvLine('1', m.pv1San, m.pv1Uci));
    if (m.pv2San.length) lines.append(pvLine('2', m.pv2San, m.pv2Uci || []));
    detail.replaceChildren(header, bestLine, lines);
  }

  // A clickable principal variation: clicking the k-th move shows the board after
  // playing that line up to there (the "play best line" stepper).
  function pvLine(n, sanArr, uciArr) {
    const toks = sanArr.map((san, k) => el('button', {
      type: 'button', class: 'pv-move' + (lineStep === `${n}:${k}` ? ' on' : ''),
      text: san, on: { click: () => stepLine(n, uciArr, k) },
    }));
    return el('div', { class: 'pv-line' }, [el('span', { class: 'pv-tag', text: `Line ${n}:` }), ...toks]);
  }

  function stepLine(n, uciArr, k) {
    const g = createGame(review.positions[sel]); // the decision position
    let last = null;
    for (let i = 0; i <= k; i += 1) {
      const mv = uciArr[i] && tryMove(g, uciMove(uciArr[i]));
      if (!mv) break;
      last = mv;
    }
    lineStep = `${n}:${k}`;
    board.setPosition(g.fen());
    board.setArrows([]);
    if (last) board.setLastMove(last.from, last.to);
    board.setCheck(g.isCheck() ? kingSquare(g, g.turn()) : null);
    renderDetail();
  }

  function onBack() { if (typeof opts.onBack === 'function') opts.onBack(); }

  // ---- buttons + keys ----
  backBtn.onclick = () => onBack();
  cancelBtn.onclick = () => { cancelRequested = true; };
  reBtn.onclick = () => { depthId = depthSel.value; run(); };
  saveBtn.onclick = async () => {
    saveBtn.disabled = true;
    saveStatus.textContent = 'Saving…';
    try {
      savedId = await saveGame(reviewToRecord(review, savedId));
      saveStatus.textContent = 'Saved ✓';
    } catch (err) {
      console.error('save failed', err);
      saveStatus.textContent = 'Could not save';
    } finally {
      saveBtn.disabled = false;
    }
  };
  dlPgnBtn.onclick = () => downloadPgn(reviewToRecord(review, savedId), true);
  dlJsonBtn.onclick = () => downloadJson(reviewToRecord(review, savedId));
  firstBtn.onclick = () => selectMove(0);
  prevBtn.onclick = () => selectMove(sel - 1);
  nextBtn.onclick = () => selectMove(sel + 1);
  lastBtn.onclick = () => selectMove(review.moves.length - 1);

  function onKey(e) {
    if (!review) return;
    if (e.key === 'ArrowRight') { selectMove(sel + 1); e.preventDefault(); }
    else if (e.key === 'ArrowLeft') { selectMove(sel - 1); e.preventDefault(); }
    else if (e.key === 'Home') { selectMove(0); e.preventDefault(); }
    else if (e.key === 'End') { selectMove(review.moves.length - 1); e.preventDefault(); }
  }
  document.addEventListener('keydown', onKey);

  run();

  return {
    destroy() {
      destroyed = true;
      document.removeEventListener('keydown', onKey);
      if (engine) { try { engine.terminate(); } catch { /* ignore */ } engine = null; }
      board.destroy();
      container.replaceChildren();
    },
  };
}
