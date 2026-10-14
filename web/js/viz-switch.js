import { icon } from './icons.js';

export function stepIndex(i, key, n) {
  if (key === 'ArrowRight' || key === 'ArrowDown') return (i + 1) % n;
  if (key === 'ArrowLeft' || key === 'ArrowUp') return (i - 1 + n) % n;
  if (key === 'Home') return 0;
  if (key === 'End') return n - 1;
  return i;
}

export function createModeSwitch({ root, modes, current, onSelect }) {
  let id = current;
  const buttons = new Map();
  const paint = () => {
    for (const [mid, b] of buttons) {
      const on = mid === id;
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
      b.classList.toggle('on', on);
    }
  };
  const choose = (mid) => {
    if (mid === id) return;
    id = mid;
    paint();
    onSelect(mid);
  };
  root.setAttribute('role', 'radiogroup');
  root.setAttribute('aria-label', 'Visualizer mode');
  root.replaceChildren();
  for (const m of modes) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'viz-radio';
    b.dataset.mode = m.id;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', m.label);
    b.title = m.label;
    const text = document.createElement('span');
    text.className = 'viz-radio-text';
    text.textContent = m.label;
    b.append(icon(m.icon, 18), text);
    b.addEventListener('click', () => choose(m.id));
    b.addEventListener('keydown', (e) => {
      if (!['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault();
      e.stopPropagation?.();
      const i = modes.findIndex((x) => x.id === id);
      const next = modes[stepIndex(i, e.key, modes.length)];
      choose(next.id);
      buttons.get(next.id).focus?.();
    });
    buttons.set(m.id, b);
    root.append(b);
  }
  paint();
  root.hidden = modes.length < 2;
  return {
    set(next) { id = next; paint(); },
    get current() { return id; },
  };
}
