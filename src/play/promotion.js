// Promotion picker shown as an overlay on the board. Resolves to
// 'q' | 'r' | 'b' | 'n', or null if cancelled.
import { el } from '../app/dom.js';
import { glyph, pieceName } from '../shared/pieces.js';

const CHOICES = ['q', 'r', 'b', 'n'];

/**
 * @param {'w'|'b'} color
 * @param {HTMLElement} host  the board-wrap (position: relative); the overlay covers it.
 */
export function requestPromotion(color, host) {
  return new Promise((resolve) => {
    const lastFocused = document.activeElement;
    let done = false;
    function finish(value) {
      if (done) return;
      done = true;
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      if (lastFocused && lastFocused.focus) lastFocused.focus();
      resolve(value);
    }

    const buttons = CHOICES.map((p) =>
      el('button', { type: 'button', 'aria-label': `Promote to ${pieceName(p)}`, on: { click: () => finish(p) } },
        [el('span', { class: 'pc ' + color, 'aria-hidden': 'true', text: glyph(color, p) })]));

    const overlay = el('div', { class: 'promotion', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Choose promotion piece' }, [
      el('p', { text: 'Promote to:' }),
      el('div', { class: 'promotion-choices' }, buttons),
      el('button', { type: 'button', class: 'promotion-cancel', text: 'Cancel', on: { click: () => finish(null) } }),
    ]);

    function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); finish(null); } }
    document.addEventListener('keydown', onKey, true);
    (host || document.body).append(overlay);
    buttons[0].focus();
  });
}
