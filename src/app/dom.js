// Minimal DOM helpers so we never build UI from strings with dynamic data.

/**
 * Create an element.
 * @param {string} tag
 * @param {object} [attrs] attributes; `class`, `text`, `html` (static only), `on` ({event:fn}), data-*.
 * @param {(Node|string)[]} [children]
 */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value; // callers pass only static literals
    else if (key === 'on') for (const [ev, fn] of Object.entries(value)) node.addEventListener(ev, fn);
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child == null) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

/** Replace all children of `parent` with `nodes`. */
export function mount(parent, ...nodes) {
  parent.replaceChildren(...nodes);
}
