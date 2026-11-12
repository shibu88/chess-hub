// About page: what the app does, credits & licences, and the source link.
import { el, mount } from './dom.js';

const REPO_URL = 'https://github.com/shibu88/chess-hub';

function creditRow(children) { return el('li', { class: 'credit' }, children); }
function link(href, text) { return el('a', { href, target: '_blank', rel: 'noopener noreferrer', text }); }

export function renderAbout(view) {
  mount(
    view,
    el('section', { class: 'about', 'aria-labelledby': 'about-h' }, [
      el('h1', { id: 'about-h', text: 'About Chess Hub' }),
      el('p', {
        text: 'Chess Hub lets you analyse games, train with puzzles and play against the ' +
          'Stockfish engine — all in your browser, with an Android app to follow. Everything ' +
          'works as a guest; sign in to sync your saved games, training progress and settings ' +
          'across devices.',
      }),

      el('h2', { text: 'Credits & licences' }),
      el('ul', { class: 'credits' }, [
        creditRow([
          el('strong', { text: 'Stockfish 19' }), ' — the chess engine, ',
          link('https://github.com/official-stockfish/Stockfish', 'official source'),
          ', licensed ', link('https://www.gnu.org/licenses/gpl-3.0.html', 'GPL-3.0'),
          '. Full licence: ', link('/engine/Copying.txt', 'Copying.txt'), '.',
        ]),
        creditRow([
          el('strong', { text: 'chess.js' }), ' — rules, SAN, FEN and PGN, ',
          link('https://github.com/jhlywa/chess.js', 'source'), ' (BSD-2-Clause).',
        ]),
        creditRow([
          el('strong', { text: 'Lichess' }), ' — puzzles from the ',
          link('https://database.lichess.org/#puzzles', 'Lichess puzzle database'),
          ' and opening names from ', link('https://github.com/lichess-org/chess-openings', 'chess-openings'),
          ', both released under CC0.',
        ]),
        creditRow([
          el('strong', { text: 'cbh2pgn' }), ' — our ChessBase (.cbh) move decoder is ported from ',
          link('https://github.com/asdfjkl/cbh2pgn', 'cbh2pgn'),
          ' by Dominik Klein (MIT).',
        ]),
        creditRow([
          'Also uses the Firebase SDK (Apache-2.0), Capacitor and its plugins (MIT), ' +
          'idb (ISC) and fflate (MIT). ',
          'See ', link(REPO_URL + '/blob/main/THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES.md'),
          ' for full details.',
        ]),
      ]),

      el('h2', { text: 'Source code' }),
      el('p', {}, [
        'Chess Hub is open source under GPL-3.0 (required because it ships Stockfish). ',
        link(REPO_URL, 'View the source on GitHub'), '.',
      ]),

      el('a', { class: 'btn', href: '#/', text: '← Back to home' }),
    ])
  );
}
