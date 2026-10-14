import { ROWS, toggleParts } from './viz-parts.js';

const ROW_LABELS = { freq: 'Frequency parts', behav: 'Behaviour parts' };

export function createPartsToggles({ root, state, onChange, onRefuse }) {
  let cur = state;
  let open = false;
  const pills = new Map();
  const group = document.createElement('div');
  group.className = 'viz-parts-rows';
  group.id = `${root.id}-rows`;
  const opener = document.createElement('button');
  opener.type = 'button';
  opener.className = 'viz-parts-open';
  opener.textContent = 'Parts';
  opener.setAttribute('aria-expanded', 'false');
  opener.setAttribute('aria-controls', group.id);
  opener.title = 'Show or hide musical parts';
  const paint = () => {
    for (const [key, b] of pills) {
      const [row, id] = key.split('.');
      b.setAttribute('aria-pressed', String(!!cur[row][id]));
      b.classList.toggle('on', !!cur[row][id]);
    }
    root.classList.toggle('open', open);
    opener.setAttribute('aria-expanded', String(open));
  };
  root.classList.add('viz-parts');
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', 'Visualizer parts');
  root.replaceChildren(opener, group);
  for (const row of Object.keys(ROWS)) {
    const el = document.createElement('div');
    el.className = 'viz-parts-row';
    el.setAttribute('role', 'group');
    el.setAttribute('aria-label', ROW_LABELS[row]);
    for (const part of ROWS[row]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'viz-part';
      b.dataset.row = row;
      b.dataset.part = part.id;
      b.textContent = part.label;
      b.title = part.title;
      b.addEventListener('click', () => {
        const r = toggleParts(cur, row, part.id);
        if (r.refused) { onRefuse?.(row, part); return; }
        if (!r.changed) return;
        cur = r.state;
        paint();
        onChange(cur);
      });
      pills.set(`${row}.${part.id}`, b);
      el.append(b);
    }
    group.append(el);
  }
  opener.addEventListener('click', () => { open = !open; paint(); });
  paint();
  return {
    set(next) { cur = next; paint(); },
    get state() { return cur; },
    pills,
  };
}
