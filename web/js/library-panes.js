import { el } from './dom.js';
import { loadUi } from './lazy-ui.js';

export function lazyPane(pane, { module, mount, noun, clear = false, isGone }) {
  let unmount = null;
  let loading = false;
  function show() {
    if (unmount || loading) return;
    loading = true;
    pane.replaceChildren(el('p', { class: 'muted t-subhead state', role: 'status' }, `Loading ${noun}...`));
    loadUi(module).then((m) => {
      loading = false;
      if (isGone()) return;
      if (clear) pane.replaceChildren();
      unmount = m[mount](pane);
    }, () => {
      loading = false;
      if (isGone()) return;
      pane.replaceChildren(el('div', { class: 'state card' },
        el('p', { class: 'msg error', role: 'alert' }, `${noun[0].toUpperCase()}${noun.slice(1)} could not be loaded. Check the connection and try again.`),
        el('button', { class: 'btn', type: 'button', onclick: show }, 'Retry')));
    });
  }
  return { show, dispose: () => unmount?.() };
}
