import { el } from '../web/js/dom.js';
import { createConeAnimation } from '../web/js/cone-animation.js';

export const SHOW_TEXT = 'Show animation';
export const HIDE_TEXT = 'Hide animation';

const BUILDERS = { 'cone-animation': () => createConeAnimation({ frequency: 440, amplitude: 0.3 }) };

export const hasAnimation = (term) => !!BUILDERS[term.demo?.type];

export const pageLink = (term) => (term.demo?.page ? [el('a', { href: `#/${term.demo.page}` }, `${term.demo.label} page →`)] : []);

export function createDemoToggle(term, { id, onOpen } = {}) {
  let anim = null;
  const host = el('div', { class: 'gl-demo-host', id: `${id}-host`, hidden: true });
  const button = el('button', {
    type: 'button', class: 'btn outline small', 'aria-expanded': 'false', 'aria-controls': `${id}-host`,
    onclick: () => (anim ? close() : open()),
  }, SHOW_TEXT);
  const node = el('div', { class: 'gl-demo' }, button, host);

  function open() {
    if (anim) return;
    onOpen?.();
    anim = BUILDERS[term.demo.type]();
    host.replaceChildren(anim.node);
    host.hidden = false;
    button.textContent = HIDE_TEXT;
    button.setAttribute('aria-expanded', 'true');
  }

  function close() {
    if (!anim) return;
    anim.destroy();
    anim = null;
    host.replaceChildren();
    host.hidden = true;
    button.textContent = SHOW_TEXT;
    button.setAttribute('aria-expanded', 'false');
  }

  return { node, open, close, get isOpen() { return !!anim; } };
}
