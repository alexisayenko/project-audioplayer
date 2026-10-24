import { el } from './dom.js';

export function segmented(items, current, pick, attrs) {
  const btns = items.map(([key, text]) => el('button', {
    class: 'seg-btn', type: 'button', role: 'radio', 'aria-checked': 'false', onclick: () => pick(key),
  }, text));
  const group = el('div', {
    class: 'seg hm-seg', role: 'radiogroup', ...attrs,
    onkeydown: (ev) => {
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[ev.key];
      if (!step) return;
      ev.preventDefault();
      const i = Math.min(items.length - 1, Math.max(0, items.findIndex(([key]) => key === current()) + step));
      pick(items[i][0]);
      btns[i].focus();
    },
  }, ...btns);
  const paint = () => btns.forEach((b, i) => {
    const on = items[i][0] === current();
    b.classList.toggle('on', on);
    b.setAttribute('aria-checked', String(on));
    b.tabIndex = on ? 0 : -1;
  });
  return { group, paint };
}
