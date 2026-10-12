import { el } from './dom.js';

let open = null;

export function closeMenu() {
  if (!open) return;
  open.btn.setAttribute('aria-expanded', 'false');
  open.node.remove();
  open = null;
}

export function openMenu(btn, items) {
  const again = open && open.btn === btn;
  closeMenu();
  if (again) return;
  const node = el('div', { class: 'menu', role: 'menu' }, items.map(({ label, disabled, danger, run }) => el('button', {
    class: `menu-item${danger ? ' danger' : ''}`, type: 'button', role: 'menuitem', disabled: !!disabled,
    onclick: () => { closeMenu(); run(); },
  }, label)));
  document.body.append(node);
  btn.setAttribute('aria-expanded', 'true');
  open = { node, btn };
  const r = btn.getBoundingClientRect();
  const h = node.offsetHeight;
  node.style.top = `${r.bottom + h + 8 > window.innerHeight ? Math.max(8, r.top - h - 4) : r.bottom + 4}px`;
  node.style.left = `${Math.max(8, Math.min(r.right - node.offsetWidth, window.innerWidth - node.offsetWidth - 8))}px`;
  const first = node.querySelector('button:not(:disabled)');
  if (first) first.focus();
}

export function initMenus() {
  document.addEventListener('click', (e) => {
    if (open && !open.node.contains(e.target) && !open.btn.contains(e.target)) closeMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && open) { const b = open.btn; closeMenu(); b.focus(); }
  });
  window.addEventListener('resize', closeMenu);
  window.addEventListener('scroll', closeMenu, true);
}
