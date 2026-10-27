import { el } from './dom.js';
import { loadUi } from './lazy-ui.js';

export function lazyPane(pane, { module, mount, noun, clear = false, isGone, freshMs = 0, now = Date.now }) {
  let unmount = null;
  let loading = false;
  let mountedAt = 0;
  function show() {
    if (unmount) {
      if (freshMs > 0 && now() - mountedAt > freshMs) {
        mountedAt = now();
        unmount.refresh?.();
      }
      return;
    }
    if (loading) return;
    loading = true;
    pane.replaceChildren(el('p', { class: 'muted t-subhead state', role: 'status' }, `Loading ${noun}...`));
    loadUi(module).then((m) => {
      loading = false;
      if (isGone()) return;
      if (clear) pane.replaceChildren();
      mountedAt = now();
      unmount = m[mount](pane);
    }, () => {
      loading = false;
      if (isGone()) return;
      pane.replaceChildren(el('div', { class: 'state card' },
        el('p', { class: 'msg error', role: 'alert' }, `${noun[0].toUpperCase()}${noun.slice(1)} could not be loaded. Check the connection and try again.`),
        el('button', { class: 'btn', type: 'button', onclick: show }, 'Retry')));
    });
  }
  const dispose = () => { unmount?.(); unmount = null; };
  return { show, dispose, remount: () => { dispose(); show(); } };
}
