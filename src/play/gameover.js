// Game-over panel: result + reason, Save to My games, Download PGN, New game.
import { el } from '../app/dom.js';

/**
 * @param {HTMLElement} host  container to render into (cleared first)
 * @param {object} o
 * @param {string} o.resultText   e.g. "You win" / "Stockfish wins" / "Draw"
 * @param {string} o.reasonText   e.g. "by checkmate"
 * @param {()=>Promise<any>} o.onSave
 * @param {()=>void} o.onDownload
 * @param {()=>void} o.onNewGame
 */
export function showGameOver(host, { resultText, reasonText, onSave, onDownload, onNewGame }) {
  const saveBtn = el('button', { type: 'button', class: 'btn', text: 'Save to My games' });
  const saveStatus = el('span', { class: 'save-status', 'aria-live': 'polite' });

  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    saveStatus.textContent = 'Saving…';
    try {
      await onSave();
      saveStatus.textContent = 'Saved ✓';
    } catch (err) {
      saveBtn.disabled = false;
      saveStatus.textContent = 'Could not save';
      console.error('save failed', err);
    }
  });

  const panel = el('div', { class: 'gameover', role: 'status', 'aria-live': 'polite' }, [
    el('h2', { class: 'gameover-title', text: resultText }),
    el('p', { class: 'gameover-reason', text: reasonText }),
    el('div', { class: 'gameover-actions' }, [
      saveBtn,
      el('button', { type: 'button', class: 'btn-secondary', text: 'Download PGN', on: { click: onDownload } }),
      el('button', { type: 'button', class: 'btn-secondary', text: 'New game', on: { click: onNewGame } }),
    ]),
    saveStatus,
  ]);
  host.replaceChildren(panel);
}
