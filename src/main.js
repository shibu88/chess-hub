import './styles.css';
import { createRouter } from './app/router.js';
import { renderHome } from './app/home.js';
import { renderAbout } from './app/about.js';
import { renderAnalysis } from './analysis/analysis.js';
import { renderPlay } from './play/play.js';
import { renderTraining } from './training/training.js';
import { initAccount } from './auth/account.js';
import { initNativeShell } from './app/native.js';

const view = document.getElementById('view');

const routes = {
  '/': () => renderHome(view),
  '/analysis': (ctx) => renderAnalysis(view, ctx),
  '/training': () => renderTraining(view),
  '/play': (ctx) => renderPlay(view, ctx),
  '/about': () => renderAbout(view),
};

// Highlight the active bottom tab and move keyboard focus to the view on change.
function onRouteChange(path) {
  // Tag the body with the route so CSS can theme per page (dark everywhere,
  // light only on Play).
  document.body.dataset.route = path;
  for (const a of document.querySelectorAll('.tabbar a')) {
    const active = '#' + path === a.getAttribute('href');
    a.classList.toggle('active', active);
    if (active) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  view.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

initAccount();
initNativeShell(); // no-op on the web; sets up the app shell inside Android
createRouter(routes, onRouteChange).start();
