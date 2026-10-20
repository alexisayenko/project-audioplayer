import { el } from './dom.js';
import { icon } from './icons.js';
import { fmtClock } from './loop-engine.js';

export function initLoopChip(host, loop) {
  if (!host) return null;
  const paint = (s) => {
    host.hidden = !s.active;
    if (!s.active) { host.replaceChildren(); return; }
    host.replaceChildren(
      el('span', { class: 'loop-text' }, 'Loop A-B ', el('span', { class: 't-time' }, `${fmtClock(s.start)} - ${fmtClock(s.end)}`)),
      el('button', { class: 'loop-off', type: 'button', 'aria-label': 'Turn loop off', title: 'Turn loop off', onclick: () => loop.setOn(false) }, icon('clear', 'action')));
  };
  paint(loop.get());
  return loop.onChange(paint);
}
