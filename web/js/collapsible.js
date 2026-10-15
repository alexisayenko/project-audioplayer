import { el } from './dom.js';

export const PANEL_NARROW_PX = 480;
export const PANEL_KEYS = { stats: 'ap2.panel.stats', genres: 'ap2.panel.genres', genreInfo: 'ap2.panel.genreInfo', links: 'ap2.panel.links' };

export function loadCollapsed(storage, key, width) {
  try {
    const v = storage?.getItem(key);
    if (v === '1') return true;
    if (v === '0') return false;
  } catch { /* storage unavailable */ }
  return Number.isFinite(width) && width < PANEL_NARROW_PX;
}

export function saveCollapsed(storage, key, collapsed) {
  try { storage?.setItem(key, collapsed ? '1' : '0'); return true; } catch { return false; }
}

export const toggleCollapsed = (v) => !v;

export function createCollapsible({ id, content, collapsed = false, onToggle }) {
  const root = el('div', { class: 'cl' }, el('div', { class: 'cl-clip', id }, el('div', { class: 'cl-in' }, content)));
  const button = el('button', { class: 'cl-btn', type: 'button', 'aria-controls': id }, el('span', { class: 'cl-chev', 'aria-hidden': 'true' }, '▾'));
  const set = (v) => {
    root.classList.toggle('collapsed', v);
    button.classList.toggle('collapsed', v);
    button.setAttribute('aria-expanded', String(!v));
    const label = v ? 'Expand panel' : 'Collapse panel';
    button.setAttribute('aria-label', label);
    button.title = label;
  };
  set(collapsed);
  button.addEventListener('click', () => {
    const v = toggleCollapsed(root.classList.contains('collapsed'));
    set(v);
    onToggle?.(v);
  });
  return { root, button, set, isCollapsed: () => root.classList.contains('collapsed') };
}
