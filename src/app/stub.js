// Placeholder screen for sections that arrive in a later phase.
import { el, mount } from './dom.js';

export function renderStub(view, title) {
  mount(
    view,
    el('section', { class: 'stub', 'aria-labelledby': 'stub-h' }, [
      el('h1', { id: 'stub-h', text: title }),
      el('p', { class: 'stub-msg', text: 'Coming in the next phase.' }),
      el('a', { class: 'btn', href: '#/' , text: '← Back to home' }),
    ])
  );
}
