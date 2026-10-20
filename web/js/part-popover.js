import { el } from './dom.js';
import { MENU_EDGE, MENU_GAP } from './constants.js';

let open = null;
let seq = 0;

export function closePartPopover({ refocus = false } = {}) {
  if (!open) return;
  const { btn, node } = open;
  btn.setAttribute('aria-expanded', 'false');
  btn.removeAttribute('aria-controls');
  node.remove();
  open = null;
  if (refocus && btn.isConnected) btn.focus();
}

export const openPartPopover = () => open;

function place(btn, node, host) {
  const r = btn.getBoundingClientRect();
  const h = host.getBoundingClientRect();
  const maxW = window.innerWidth - 2 * MENU_EDGE;
  node.style.maxWidth = `${maxW}px`;
  const left = Math.max(MENU_EDGE, Math.min(r.left, window.innerWidth - node.offsetWidth - MENU_EDGE));
  const below = r.bottom + MENU_GAP;
  const flip = below + node.offsetHeight + MENU_EDGE > window.innerHeight && r.top - node.offsetHeight - MENU_GAP >= MENU_EDGE;
  const top = flip ? r.top - node.offsetHeight - MENU_GAP : below;
  node.style.left = `${left - h.left + (host.scrollLeft || 0) - (host.clientLeft || 0)}px`;
  node.style.top = `${top - h.top + (host.scrollTop || 0) - (host.clientTop || 0)}px`;
}

function rowNode({ label, value }) {
  const body = Array.isArray(value)
    ? el('span', { class: 'tp-pills' }, value.map((g) => el('span', { class: 'tag ns t-caption' }, g)))
    : el('span', { class: 'tp-val' }, value);
  return el('div', { class: 'tp-row' }, el('span', { class: 'tp-label muted t-caption' }, label), body);
}

export function togglePartPopover(btn, { heading, rows, filter }) {
  const again = open && open.btn === btn;
  closePartPopover();
  if (again) return null;
  const id = `tp-pop-${++seq}`;
  const host = btn.closest('dialog') || document.body;
  const filterBtn = filter ? el('button', { type: 'button', class: 'tp-link', onclick: () => { closePartPopover(); filter.run(); } }, 'Filter library by this artist') : null;
  const node = el('div', { class: 'tp-pop', id, role: 'dialog', 'aria-labelledby': `${id}-h`, tabindex: '-1' },
    el('p', { class: 'tp-head t-subhead', id: `${id}-h` }, heading),
    rows.length ? rows.map(rowNode) : el('p', { class: 'tp-empty muted t-caption' }, 'No details yet'),
    filterBtn);
  host.append(node);
  btn.setAttribute('aria-expanded', 'true');
  btn.setAttribute('aria-controls', id);
  open = { btn, node };
  place(btn, node, host);
  return node;
}

let wired = false;
export function initPartPopovers() {
  if (wired) return;
  wired = true;
  document.addEventListener('click', (e) => {
    if (open && !open.node.contains(e.target) && !open.btn.contains(e.target)) closePartPopover();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !open) return;
    e.preventDefault();
    e.stopPropagation();
    closePartPopover({ refocus: true });
  }, true);
  window.addEventListener('resize', () => closePartPopover());
}
