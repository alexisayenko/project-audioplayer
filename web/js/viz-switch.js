import { icon } from './icons.js';

const WRAP = ['ArrowDown', 'ArrowUp', 'Home', 'End'];

export function stepIndex(i, key, n) {
  if (key === 'ArrowRight' || key === 'ArrowDown') return (i + 1) % n;
  if (key === 'ArrowLeft' || key === 'ArrowUp') return (i - 1 + n) % n;
  if (key === 'Home') return 0;
  if (key === 'End') return n - 1;
  return i;
}

export function modeOptions(modes, current) {
  return modes.map((m) => ({ id: m.id, label: m.label, icon: m.icon, selected: m.id === current }));
}

export function currentIndex(modes, current) {
  return Math.max(0, modes.findIndex((m) => m.id === current));
}

export function moveFocus(i, key, n) {
  if (!WRAP.includes(key) || n < 1) return i;
  return stepIndex(i, key, n);
}

export function opensUpward(rect, popupHeight, viewportHeight, gap = 8) {
  const below = viewportHeight - rect.bottom - gap;
  const above = rect.top - gap;
  return below < popupHeight && above > below;
}

export function createModeSwitch({ root, modes, current, onSelect, win = globalThis.window }) {
  let id = current;
  let note = '';
  let open = false;
  const options = new Map();
  const label = () => modes.find((m) => m.id === id)?.label ?? '';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'viz-dd-btn t-caption';
  button.setAttribute('aria-haspopup', 'listbox');
  button.setAttribute('aria-expanded', 'false');
  const list = document.createElement('div');
  list.className = 'viz-dd-list t-subhead';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Visualizer mode');
  list.hidden = true;

  const paintButton = () => {
    const m = modes.find((x) => x.id === id) ?? modes[0];
    const text = document.createElement('span');
    text.className = 'viz-dd-text';
    const full = note ? `${m.label} (${note})` : m.label;
    text.textContent = full;
    button.replaceChildren(icon(m.icon, 'action'), text, icon('chevron', 'inline'));
    button.setAttribute('aria-label', `Visualizer mode: ${full}`);
    button.title = `Visualizer mode: ${full}`;
    button.dataset.mode = m.id;
  };
  const paintOptions = () => {
    for (const [mid, o] of options) {
      const on = mid === id;
      o.setAttribute('aria-selected', String(on));
      o.classList.toggle('on', on);
    }
  };

  const ordered = () => modes.map((m) => options.get(m.id));
  const focusIndex = (i) => ordered()[i]?.focus?.();
  const focused = () => ordered().findIndex((o) => o === document.activeElement);

  const place = () => {
    const h = win?.innerHeight ?? 800;
    list.classList.remove('up');
    const ph = list.getBoundingClientRect?.().height || modes.length * 44 + 8;
    if (opensUpward(root.getBoundingClientRect(), ph, h)) list.classList.add('up');
  };
  const onDocPointer = (e) => { if (!root.contains(e.target)) close(false); };
  const close = (refocus) => {
    if (!open) return;
    open = false;
    list.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onDocPointer);
    if (refocus) button.focus?.();
  };
  const openList = () => {
    if (open) return;
    open = true;
    list.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    place();
    document.addEventListener('pointerdown', onDocPointer);
    focusIndex(currentIndex(modes, id));
  };
  const choose = (mid) => {
    close(true);
    if (mid === id) return;
    id = mid;
    paintButton();
    paintOptions();
    onSelect(mid);
  };

  for (const m of modes) {
    const o = document.createElement('div');
    o.className = 'viz-dd-opt';
    o.setAttribute('role', 'option');
    o.dataset.mode = m.id;
    o.tabIndex = -1;
    const text = document.createElement('span');
    text.className = 'viz-dd-opt-text';
    text.textContent = m.label;
    o.append(icon(m.icon, 'action'), text, icon('check', 'inline'));
    o.addEventListener('click', () => choose(m.id));
    options.set(m.id, o);
    list.append(o);
  }

  button.addEventListener('click', () => { if (open) close(true); else openList(); });
  button.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    e.stopPropagation?.();
    openList();
  });
  list.addEventListener('keydown', (e) => {
    const k = e.key;
    if (k === 'Escape') { e.preventDefault(); e.stopPropagation?.(); close(true); return; }
    if (k === 'Tab') { close(false); return; }
    if (k === 'Enter' || k === ' ') {
      e.preventDefault();
      e.stopPropagation?.();
      const i = focused();
      if (i >= 0) choose(modes[i].id);
      return;
    }
    if (!WRAP.includes(k)) return;
    e.preventDefault();
    e.stopPropagation?.();
    const i = focused();
    focusIndex(moveFocus(i < 0 ? currentIndex(modes, id) : i, k, modes.length));
  });

  root.replaceChildren(button, list);
  root.removeAttribute?.('role');
  root.removeAttribute?.('aria-label');
  paintButton();
  paintOptions();
  root.hidden = modes.length < 2;
  return {
    set(next, why = '') { id = next; note = why; paintButton(); paintOptions(); },
    setNote(why = '') { note = why; paintButton(); },
    close() { close(false); },
    get current() { return id; },
    get isOpen() { return open; },
  };
}
