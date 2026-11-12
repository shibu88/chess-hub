// Accessible confirm dialog. Returns a Promise<boolean>. No native confirm()
// (blocking dialogs are avoided) and no innerHTML with data.
import { el } from './dom.js';

/**
 * A dialog with any number of choices. Resolves to the chosen `value`, or null
 * if dismissed (Escape / backdrop). choices: [{ label, value, primary? }].
 */
export function choiceDialog({ title, message, choices }) {
  return new Promise((resolve) => {
    const lastFocused = document.activeElement;
    let done = false;
    function finish(v) {
      if (done) return;
      done = true;
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      if (lastFocused && lastFocused.focus) lastFocused.focus();
      resolve(v);
    }
    const buttons = choices.map((c) =>
      el('button', { type: 'button', class: c.primary ? 'btn' : 'btn-secondary', text: c.label, on: { click: () => finish(c.value) } }));
    const dialog = el('div', { class: 'confirm-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, [
      el('h2', { class: 'confirm-title', text: title }),
      message ? el('p', { class: 'confirm-msg', text: message }) : null,
      el('div', { class: 'confirm-actions' }, buttons),
    ]);
    const overlay = el('div', { class: 'overlay', on: { click: (e) => { if (e.target === overlay) finish(null); } } }, [dialog]);
    function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); finish(null); } }
    document.addEventListener('keydown', onKey, true);
    document.body.append(overlay);
    (buttons.find((_, i) => choices[i].primary) || buttons[0]).focus();
  });
}

export function confirmDialog({ title, message, confirmText = 'OK', cancelText = 'Cancel' }) {
  return new Promise((resolve) => {
    const lastFocused = document.activeElement;
    let done = false;
    function finish(v) {
      if (done) return;
      done = true;
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      if (lastFocused && lastFocused.focus) lastFocused.focus();
      resolve(v);
    }
    const confirmBtn = el('button', { type: 'button', class: 'btn', text: confirmText, on: { click: () => finish(true) } });
    const dialog = el('div', { class: 'confirm-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, [
      el('h2', { class: 'confirm-title', text: title }),
      message ? el('p', { class: 'confirm-msg', text: message }) : null,
      el('div', { class: 'confirm-actions' }, [
        el('button', { type: 'button', class: 'btn-secondary', text: cancelText, on: { click: () => finish(false) } }),
        confirmBtn,
      ]),
    ]);
    const overlay = el('div', { class: 'overlay', on: { click: (e) => { if (e.target === overlay) finish(false); } } }, [dialog]);
    function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); finish(false); } }
    document.addEventListener('keydown', onKey, true);
    document.body.append(overlay);
    confirmBtn.focus();
  });
}
