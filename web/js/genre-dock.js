import { el } from './dom.js';
import { icon } from './icons.js';
import { loadUi } from './lazy-ui.js';

export const DOCK_KEY = 'electrophone.genresDock';
export const DOCK_SHEET_KEY = 'electrophone.genresDockSheet';
export const DOCK_EMPTY = 'Click a genre on the map to see its details.';
export const DOCK_COLLAPSE = 'Collapse genre info';
export const DOCK_EXPAND = 'Show genre info';
export const DOCK_TITLE = 'Genre info';

const keyFor = (narrow) => (narrow ? DOCK_SHEET_KEY : DOCK_KEY);

export function loadDockCollapsed(storage, narrow = false) {
  try {
    const v = storage?.getItem(keyFor(narrow));
    if (v === '1') return true;
    if (v === '0') return false;
  } catch { /* storage unavailable */ }
  return narrow;
}

export function saveDockCollapsed(storage, narrow, on) {
  try { storage?.setItem(keyFor(narrow), on ? '1' : '0'); } catch { /* storage unavailable */ }
}

export function createGenreDock({ storage = null, narrow = () => false, onNavigate, onMap, onChange, onExpand, renderInfo, dotFor } = {}) {
  let collapsed = loadDockCollapsed(storage, narrow());
  let name = null;
  let label = '';
  let painted = null;
  let info = null;
  let creating = null;
  let navigating = false;
  let destroyed = false;
  const stack = [];

  const title = el('h2', { class: 'gmr-dock-title t-headline' }, DOCK_TITLE);
  const back = el('button', { class: 'gmr-dock-btn gmr-dock-back', type: 'button', title: 'Back', 'aria-label': 'Back', hidden: true, onclick: () => goBack() }, icon('chevronLeft', 'nav'));
  const dot = el('span', { class: 'gmr-dock-dot', 'aria-hidden': 'true', hidden: true });
  const toggle = el('button', { class: 'gmr-dock-btn gmr-dock-toggle', type: 'button', 'aria-controls': 'gmr-dock-body', 'aria-expanded': 'true', onclick: () => setCollapsed(!collapsed, { save: true }) });
  const empty = el('p', { class: 'gmr-dock-empty muted t-body' }, DOCK_EMPTY);
  const infoBox = el('div', { class: 'gmr-dock-info', hidden: true });
  const body = el('div', { class: 'gmr-dock-body genre-card', id: 'gmr-dock-body' }, empty, infoBox);
  const head = el('div', { class: 'gmr-dock-head' }, el('span', { class: 'gmr-dock-grab', 'aria-hidden': 'true' }), back, dot, title, toggle);
  const node = el('aside', { class: 'gmr-dock', 'aria-label': 'Genre info' }, head, body);
  head.addEventListener('click', (e) => {
    const hit = e.target;
    if (collapsed && head.contains(hit) && !hit.closest?.('button')) setCollapsed(false, { save: true });
  });

  function sync() {
    const sheet = narrow();
    const text = collapsed ? DOCK_EXPAND : DOCK_COLLAPSE;
    node.classList.toggle('collapsed', collapsed);
    body.hidden = collapsed;
    back.hidden = collapsed || !stack.length;
    title.textContent = collapsed && label ? label : DOCK_TITLE;
    dot.hidden = !(collapsed && name);
    dot.className = `gmr-dock-dot ${name && dotFor ? dotFor(name) : ''}`.trim();
    toggle.title = text;
    toggle.setAttribute('aria-label', collapsed && label ? `${text}: ${label} is selected` : text);
    toggle.setAttribute('aria-expanded', String(!collapsed));
    const glyph = sheet ? (collapsed ? 'chevronUp' : 'chevron') : (collapsed ? 'chevron' : 'chevronUp');
    toggle.replaceChildren(icon(glyph, 'nav'));
  }

  function ensureInfo() {
    if (info) return Promise.resolve(info);
    if (renderInfo) {
      info = renderInfo(name, { container: infoBox, titleId: 'gmr-dock-title', onNavigate: navigate, onMap });
      painted = name;
      return Promise.resolve(info);
    }
    creating ||= loadUi('genreCard').then((mod) => {
      if (!info && !destroyed) {
        info = mod.renderGenreInfo(name, { container: infoBox, titleId: 'gmr-dock-title', onNavigate: navigate, onMap });
        painted = name;
      }
      return info;
    }).catch(() => { creating = null; return null; });
    return creating;
  }

  function paint() {
    const has = !!name;
    empty.hidden = has;
    infoBox.hidden = !has;
    if (!has || collapsed || (info && painted === name)) return Promise.resolve();
    return ensureInfo().then((i) => {
      if (i && !destroyed && !collapsed && name && painted !== name) {
        i.show(name);
        painted = name;
      }
    });
  }

  function viaHost(target) {
    navigating = true;
    try { onNavigate?.(target); } finally { navigating = false; }
  }

  function navigate(next) {
    const from = name;
    stack.push(from);
    viaHost(next);
    if (name === from) stack.pop();
    sync();
    return paint().then(() => info?.focusTitle());
  }

  function goBack() {
    if (!stack.length) return Promise.resolve();
    const prev = stack.pop();
    viaHost(prev);
    sync();
    return paint().then(() => info?.focusTitle());
  }

  function show(next, nextLabel = '') {
    if (!navigating && (next || null) !== name) stack.length = 0;
    name = next || null;
    label = name ? nextLabel || name : '';
    sync();
    return paint();
  }

  function glide(from) {
    const reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    if (typeof node.animate !== 'function' || reduced || !from?.width) return;
    const to = node.getBoundingClientRect();
    if (!to.width || (to.width === from.width && to.height === from.height)) return;
    const css = globalThis.getComputedStyle?.(globalThis.document.documentElement);
    const ms = parseFloat(css?.getPropertyValue('--dur-base')) || 0;
    if (!ms) return;
    node.animate(
      [{ width: `${from.width}px`, height: `${from.height}px` }, { width: `${to.width}px`, height: `${to.height}px` }],
      { duration: ms, easing: css.getPropertyValue('--ease-io').trim() || 'ease' },
    );
  }

  function setCollapsed(on, { save = false } = {}) {
    const from = on === collapsed ? null : node.getBoundingClientRect?.();
    collapsed = on;
    if (save) saveDockCollapsed(storage, narrow(), on);
    sync();
    if (from) glide(from);
    if (!on) onExpand?.();
    onChange?.(on);
    return paint();
  }

  const onResize = () => sync();
  globalThis.addEventListener?.('resize', onResize);
  sync();
  onChange?.(collapsed);

  return {
    node,
    show,
    setCollapsed,
    isCollapsed: () => collapsed,
    current: () => name,
    destroy() {
      destroyed = true;
      globalThis.removeEventListener?.('resize', onResize);
      info?.destroy();
    },
  };
}
