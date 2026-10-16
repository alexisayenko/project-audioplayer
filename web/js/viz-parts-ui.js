import { ROWS, toggleParts } from './viz-parts.js';

const ROW_LABELS = { freq: 'Frequency', behav: 'Behaviour' };

export function createPartsToggles({ root, state, onChange, onRefuse }) {
  let cur = state;
  const pills = new Map();
  const group = document.createElement('div');
  group.className = 'viz-parts-rows';
  group.id = `${root.id}-rows`;
  const paint = () => {
    for (const [key, b] of pills) {
      const [row, id] = key.split('.');
      b.setAttribute('aria-pressed', String(!!cur[row][id]));
      b.classList.toggle('on', !!cur[row][id]);
    }
  };
  root.classList.add('viz-parts', 't-caption');
  root.setAttribute('role', 'group');
  root.setAttribute('aria-label', 'Visualizer parts');
  root.replaceChildren(group);
  for (const row of Object.keys(ROWS)) {
    const line = document.createElement('div');
    line.className = 'viz-parts-line';
    const label = document.createElement('span');
    label.className = 'viz-parts-label t-micro';
    label.textContent = ROW_LABELS[row];
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
    line.append(label, el);
    group.append(line);
  }
  paint();
  return {
    set(next) { cur = next; paint(); },
    get state() { return cur; },
    pills,
  };
}
