// Tiny hash router. Routes look like "#/play" with an optional query:
// "#/play?fen=...". Unknown routes fall back to home ("#/").

/** Parse the current location hash into { path, query }. */
export function parseHash() {
  const raw = window.location.hash.slice(1) || '/'; // drop the leading '#'
  const qIndex = raw.indexOf('?');
  const path = qIndex === -1 ? raw : raw.slice(0, qIndex);
  const query = new URLSearchParams(qIndex === -1 ? '' : raw.slice(qIndex + 1));
  return { path: path || '/', query };
}

/**
 * Create a router.
 * @param {Record<string, (ctx: {query: URLSearchParams}) => (void|Function)>} routes
 *   Map of path -> render function. A render function may return a cleanup
 *   function, called before the next view renders.
 * @param {() => void} [onChange] Called after every navigation (e.g. to update nav highlights).
 */
export function createRouter(routes, onChange) {
  let cleanup = null;

  function render() {
    const { path, query } = parseHash();
    const route = routes[path] || routes['/'];
    if (typeof cleanup === 'function') {
      try { cleanup(); } catch (err) { console.error('route cleanup failed', err); }
    }
    cleanup = route({ query }) || null;
    if (onChange) onChange(path);
  }

  window.addEventListener('hashchange', render);
  return {
    start() {
      if (!window.location.hash) window.location.replace('#/');
      render();
    },
  };
}
