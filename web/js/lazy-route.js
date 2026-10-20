import { el } from './dom.js';

export function lazyRoute(load, exportName) {
  return (root) => {
    let dispose = null;
    let gone = false;
    const attempt = () => {
      root.replaceChildren(el('p', { class: 'muted t-subhead state', role: 'status' }, 'Loading...'));
      load().then((mod) => {
        if (gone) return;
        root.replaceChildren();
        dispose = mod[exportName](root) || null;
      }, () => {
        if (gone) return;
        root.replaceChildren(el('div', { class: 'state card' },
          el('p', { class: 'msg error', role: 'alert' }, 'This page could not be loaded. Check the connection and try again.'),
          el('button', { class: 'btn', type: 'button', onclick: attempt }, 'Retry')));
      });
    };
    attempt();
    return () => { gone = true; if (typeof dispose === 'function') dispose(); };
  };
}
