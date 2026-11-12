// Home page: three big cards linking to the main sections.
import { el, mount } from './dom.js';

const CARDS = [
  { tab: 'analysis', href: '#/analysis', icon: '📈', title: 'Analysis', blurb: 'Review games move by move with the engine.' },
  { tab: 'training', href: '#/training', icon: '🧩', title: 'Training', blurb: 'Solve puzzles graded by rating.' },
  { tab: 'play', href: '#/play', icon: '♟️', title: 'Play', blurb: 'Play against Stockfish at seven levels.' },
];

export function renderHome(view) {
  const cards = CARDS.map((c) =>
    el('a', { class: 'card', href: c.href, 'data-card': c.tab }, [
      el('span', { class: 'card-ico', 'aria-hidden': 'true', text: c.icon }),
      el('span', { class: 'card-title', text: c.title }),
      el('span', { class: 'card-blurb', text: c.blurb }),
    ])
  );
  mount(
    view,
    el('section', { class: 'home', 'aria-labelledby': 'home-h' }, [
      el('h1', { id: 'home-h', class: 'home-title', text: 'Chess Hub' }),
      el('p', { class: 'home-sub', text: 'Analyse, train and play — in your browser.' }),
      el('div', { class: 'card-grid' }, cards),
    ])
  );
}
