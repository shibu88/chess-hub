// Accessible DOM chessboard: 64 <button> squares. Supports tap-to-move,
// pointer drag, legal-move dots, last-move + check highlights, flip, and a
// promotion-picker hook. It renders a position and reports intended moves;
// the controller validates and calls setPosition with the new FEN.
import { SQUARES, FILES } from './rules.js';
import { createGame } from './rules.js';
import { glyph, pieceLabel } from './pieces.js';

const DRAG_THRESHOLD = 6; // px before a press becomes a drag

/**
 * @param {HTMLElement} container
 * @param {object} opts
 * @param {'white'|'black'} opts.orientation
 * @param {'w'|'b'|null} opts.playerColor  pieces this human may pick up; null = either colour
 * @param {(square:string)=>string[]} opts.legalDests
 * @param {(from:string,to:string)=>boolean} opts.isPromotion
 * @param {(color:'w'|'b')=>Promise<'q'|'r'|'b'|'n'|null>} opts.requestPromotion
 * @param {(move:{from:string,to:string,promotion?:string})=>void} opts.onMove
 */
export function createBoard(container, opts) {
  let orientation = opts.orientation || 'white';
  let interactive = false;
  let position = {};        // square -> { type, color }
  let selected = null;      // selected square or null
  let lastMove = null;      // { from, to } or null
  let checkSquare = null;
  let hintSquare = null;    // square highlighted by a puzzle Hint, or null

  const boardEl = document.createElement('div');
  boardEl.className = 'board';
  boardEl.setAttribute('role', 'grid');
  boardEl.setAttribute('aria-label', 'Chessboard');
  container.replaceChildren(boardEl);

  // SVG overlay for move arrows (Analysis). Maps an 8×8 grid onto the playing
  // area (inside the board's border, which CSS insets).
  const SVGNS = 'http://www.w3.org/2000/svg';
  const arrowSvg = document.createElementNS(SVGNS, 'svg');
  arrowSvg.setAttribute('class', 'board-arrows');
  arrowSvg.setAttribute('viewBox', '0 0 8 8');
  arrowSvg.setAttribute('preserveAspectRatio', 'none');
  arrowSvg.setAttribute('aria-hidden', 'true');
  container.append(arrowSvg);
  let arrows = [];

  // Can the human pick up this piece? null playerColor means either colour.
  const canPick = (piece) => !!piece && (opts.playerColor == null || piece.color === opts.playerColor);

  const cells = new Map(); // square -> button
  for (const sq of SQUARES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sq';
    btn.dataset.square = sq;
    const fileIdx = FILES.indexOf(sq[0]);
    const rankIdx = Number(sq[1]);
    btn.classList.add((fileIdx + rankIdx) % 2 === 0 ? 'dark' : 'light');
    cells.set(sq, btn);
    wireSquare(btn, sq);
  }

  layout();

  // ---- drag state ----
  let drag = null; // { square, startX, startY, moved, ghost }

  function wireSquare(btn, sq) {
    btn.addEventListener('click', () => {
      if (btn._suppressClick) { btn._suppressClick = false; return; }
      tap(sq);
    });
    btn.addEventListener('pointerdown', (e) => {
      if (!interactive || e.button != null && e.button !== 0) return;
      const piece = position[sq];
      if (!canPick(piece)) return;
      drag = { square: sq, startX: e.clientX, startY: e.clientY, moved: false, ghost: null, btn };
    });
  }

  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);

  function onPointerMove(e) {
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    if (!drag.moved) {
      drag.moved = true;
      select(drag.square);
      drag.ghost = makeGhost(position[drag.square]);
      drag.btn.classList.add('dragging');
    }
    moveGhost(drag.ghost, e.clientX, e.clientY);
  }

  function onPointerUp(e) {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (d.ghost) d.ghost.remove();
    d.btn.classList.remove('dragging');
    if (!d.moved) return; // was a tap; the click handler deals with it
    d.btn._suppressClick = true;
    const target = squareFromPoint(e.clientX, e.clientY);
    if (target && selected && opts.legalDests(selected).includes(target)) {
      doMove(selected, target);
    }
    // invalid drop: keep selection + dots
  }

  function tap(sq) {
    if (!interactive) return;
    if (selected && opts.legalDests(selected).includes(sq)) {
      doMove(selected, sq);
      return;
    }
    const piece = position[sq];
    if (canPick(piece) && opts.legalDests(sq).length) {
      select(sq);
    } else {
      deselect();
    }
  }

  async function doMove(from, to) {
    const movingColor = position[from]?.color || opts.playerColor;
    deselect();
    if (opts.isPromotion(from, to)) {
      const promotion = await opts.requestPromotion(movingColor);
      if (!promotion) return; // cancelled
      opts.onMove({ from, to, promotion });
    } else {
      opts.onMove({ from, to });
    }
  }

  function select(sq) {
    selected = sq;
    renderMarks();
  }
  function deselect() {
    selected = null;
    renderMarks();
  }

  function renderMarks() {
    const dests = selected ? new Set(opts.legalDests(selected)) : new Set();
    for (const [sq, btn] of cells) {
      btn.classList.toggle('selected', sq === selected);
      btn.classList.toggle('last', lastMove && (sq === lastMove.from || sq === lastMove.to));
      btn.classList.toggle('check', sq === checkSquare);
      btn.classList.toggle('hint', sq === hintSquare);
      const isDest = dests.has(sq);
      btn.classList.toggle('dest', isDest && !position[sq]);
      btn.classList.toggle('capture', isDest && !!position[sq]);
    }
  }

  function renderPieces() {
    for (const [sq, btn] of cells) {
      const piece = position[sq];
      const coord = sq;
      if (piece) {
        let span = btn.querySelector('.pc');
        if (!span) { span = document.createElement('span'); btn.append(span); } // keep .coord children
        span.className = 'pc ' + piece.color;
        span.textContent = glyph(piece.color, piece.type);
        btn.setAttribute('aria-label', `${coord}, ${pieceLabel(piece.color, piece.type)}`);
      } else {
        const span = btn.querySelector('.pc');
        if (span) span.remove();
        btn.setAttribute('aria-label', `${coord}, empty`);
      }
    }
  }

  function layout() {
    const order = orientation === 'white' ? SQUARES : [...SQUARES].reverse();
    boardEl.replaceChildren(...order.map((sq) => cells.get(sq)));
    addCoords(order);
  }

  // Print a file letter on the bottom-edge squares and a rank number on the
  // left-edge squares, matching the current orientation.
  function addCoords(order) {
    for (const btn of cells.values()) {
      const old = btn.querySelectorAll('.coord');
      old.forEach((c) => c.remove());
    }
    for (let i = 0; i < 64; i++) {
      const sq = order[i];
      const btn = cells.get(sq);
      const col = i % 8;
      const row = Math.floor(i / 8);
      if (row === 7) {
        const f = document.createElement('span');
        f.className = 'coord file';
        f.textContent = sq[0];
        btn.append(f);
      }
      if (col === 0) {
        const r = document.createElement('span');
        r.className = 'coord rank';
        r.textContent = sq[1];
        btn.append(r);
      }
    }
  }

  // Centre of a square in 0..8 grid coordinates for the current orientation.
  function squareCenter(sq) {
    const fileIdx = FILES.indexOf(sq[0]);
    const rankNum = Number(sq[1]);
    const col = orientation === 'white' ? fileIdx : 7 - fileIdx;
    const row = orientation === 'white' ? 8 - rankNum : rankNum - 1;
    return { x: col + 0.5, y: row + 0.5 };
  }

  function drawArrows() {
    while (arrowSvg.firstChild) arrowSvg.removeChild(arrowSvg.firstChild);
    for (const a of arrows) {
      if (!a || !a.from || !a.to) continue;
      const p1 = squareCenter(a.from);
      const p2 = squareCenter(a.to);
      const color = a.kind === 'played' ? '#f59e0b' : '#3b82f6'; // amber played, blue best
      const dx = p2.x - p1.x, dy = p2.y - p1.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len;
      const head = 0.34, tipBack = 0.08, halfW = 0.19, sw = 0.16;
      const tipX = p2.x - ux * tipBack, tipY = p2.y - uy * tipBack;
      const baseX = tipX - ux * head, baseY = tipY - uy * head;
      const shaft = svg('line', { x1: p1.x, y1: p1.y, x2: baseX, y2: baseY, stroke: color, 'stroke-width': sw, 'stroke-linecap': 'round', opacity: 0.9 });
      const pts = [[tipX, tipY], [baseX - uy * halfW, baseY + ux * halfW], [baseX + uy * halfW, baseY - ux * halfW]]
        .map((p) => `${p[0]},${p[1]}`).join(' ');
      const headEl = svg('polygon', { points: pts, fill: color, opacity: 0.9 });
      arrowSvg.append(shaft, headEl);
    }
  }
  function svg(tag, attrs) {
    const node = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
  }

  function squareFromPoint(x, y) {
    const el = document.elementFromPoint(x, y);
    const sqEl = el && el.closest('[data-square]');
    return sqEl ? sqEl.dataset.square : null;
  }

  function makeGhost(piece) {
    const g = document.createElement('div');
    g.className = 'drag-ghost ' + piece.color;
    g.textContent = glyph(piece.color, piece.type);
    document.body.append(g);
    return g;
  }
  function moveGhost(g, x, y) {
    if (!g) return;
    g.style.left = x + 'px';
    g.style.top = y + 'px';
  }

  return {
    setPosition(fen) {
      const b = createGame(fen).board();
      position = {};
      for (const row of b) for (const cell of row) if (cell) position[cell.square] = { type: cell.type, color: cell.color };
      selected = null;
      renderPieces();
      renderMarks();
    },
    setOrientation(o) { orientation = o; layout(); drawArrows(); },
    setInteractive(v) { interactive = !!v; if (!v) deselect(); },
    setLastMove(from, to) { lastMove = from && to ? { from, to } : null; renderMarks(); },
    setCheck(sq) { checkSquare = sq || null; renderMarks(); },
    setHint(sq) { hintSquare = sq || null; renderMarks(); },
    setArrows(list) { arrows = Array.isArray(list) ? list : []; drawArrows(); },
    destroy() {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      container.replaceChildren();
    },
  };
}
