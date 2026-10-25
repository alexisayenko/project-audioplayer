import { el } from './dom.js';

export const INFO_GAP = 8;
export const INFO_EDGE = 16;
export const INFO_MAX_W = 320;
export const INFO_DELAY_MS = 150;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function placePopover({ anchor, size, viewport, gap = INFO_GAP, edge = INFO_EDGE }) {
  const maxLeft = Math.max(edge, viewport.w - size.w - edge);
  const center = (anchor.left + anchor.right) / 2;
  const left = clamp(center - size.w / 2, edge, maxLeft);
  const below = anchor.bottom + gap;
  const above = anchor.top - gap - size.h;
  const fitsBelow = below + size.h + edge <= viewport.h;
  const flip = !fitsBelow && above >= edge;
  const top = flip ? above : below;
  const arrow = clamp(center - left, 12, Math.max(12, size.w - 12));
  return { left, top, placement: flip ? 'above' : 'below', arrow };
}

let current = null;
let seq = 0;
let wired = false;

export function closeInfo() {
  if (!current) return;
  const { btn, node } = current;
  clearTimeout(current.timer);
  btn.setAttribute('aria-expanded', 'false');
  btn.removeAttribute('aria-describedby');
  node.remove();
  current = null;
}

export const openInfo = () => current;

function show(btn, text, mode) {
  closeInfo();
  const id = `info-pop-${++seq}`;
  const arrow = el('span', { class: 'info-pop-arrow', 'aria-hidden': 'true' });
  const node = el('div', { class: 'info-pop', id, role: 'tooltip' }, text, arrow);
  node.style.maxWidth = `${Math.min(INFO_MAX_W, window.innerWidth - 2 * INFO_EDGE)}px`;
  node.style.visibility = 'hidden';
  document.body.append(node);
  const r = btn.getBoundingClientRect();
  const size = { w: node.offsetWidth, h: node.offsetHeight };
  const at = placePopover({ anchor: r, size, viewport: { w: window.innerWidth, h: window.innerHeight } });
  node.style.left = `${at.left}px`;
  node.style.top = `${at.top}px`;
  node.style.setProperty('--arrow-x', `${at.arrow}px`);
  node.dataset.placement = at.placement;
  node.style.visibility = '';
  btn.setAttribute('aria-expanded', 'true');
  btn.setAttribute('aria-describedby', id);
  current = { btn, node, mode, timer: 0 };
}

function wire() {
  if (wired) return;
  wired = true;
  document.addEventListener('pointerdown', (e) => {
    if (current && !current.node.contains(e.target) && !current.btn.contains(e.target)) closeInfo();
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && current) closeInfo();
  }, true);
  window.addEventListener('scroll', () => closeInfo(), true);
  window.addEventListener('resize', () => closeInfo());
}

const keyboardFocus = (btn) => {
  try { return btn.matches(':focus-visible'); } catch { return false; }
};

export function attachInfo(btn, text) {
  wire();
  let hoverTimer = 0;
  const own = () => current?.btn === btn;
  btn.setAttribute('aria-expanded', 'false');
  btn.addEventListener('click', () => {
    clearTimeout(hoverTimer);
    if (own() && current.mode === 'click') closeInfo();
    else if (own()) current.mode = 'click';
    else show(btn, text, 'click');
  });
  btn.addEventListener('pointerenter', (e) => {
    if (e.pointerType !== 'mouse') return;
    clearTimeout(hoverTimer);
    if (!own()) hoverTimer = setTimeout(() => { if (!own()) show(btn, text, 'hover'); }, INFO_DELAY_MS);
  });
  btn.addEventListener('pointerleave', () => {
    clearTimeout(hoverTimer);
    if (own() && current.mode === 'hover') closeInfo();
  });
  btn.addEventListener('focus', () => {
    if (!own() && keyboardFocus(btn)) show(btn, text, 'focus');
  });
  btn.addEventListener('blur', () => {
    clearTimeout(hoverTimer);
    if (own()) closeInfo();
  });
  return () => {
    clearTimeout(hoverTimer);
    if (own()) closeInfo();
  };
}
