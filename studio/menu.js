import { icon } from '../web/js/icons.js';

export const MENU_KEY = 'studio.menu.collapsed';

export function loadMenuCollapsed(storage) {
  try { return storage.getItem(MENU_KEY) === '1'; } catch { return false; }
}

export function saveMenuCollapsed(storage, collapsed) {
  try { storage.setItem(MENU_KEY, collapsed ? '1' : '0'); return true; } catch { return false; }
}

const storageOf = () => {
  try { return globalThis.localStorage; } catch { return null; }
};

export function mountMenu(shell) {
  const toggle = document.getElementById('site-toggle');
  const open = document.getElementById('site-open');
  for (const b of [toggle, open]) b.append(icon('chevronLeft', 'action'));
  const apply = (collapsed) => {
    shell.classList.toggle('menu-collapsed', collapsed);
    toggle.setAttribute('aria-expanded', String(!collapsed));
    open.setAttribute('aria-expanded', String(!collapsed));
  };
  apply(loadMenuCollapsed(storageOf()));
  const flip = (collapsed) => {
    shell.classList.add('menu-anim');
    apply(collapsed);
    saveMenuCollapsed(storageOf(), collapsed);
    (collapsed ? open : toggle).focus();
  };
  toggle.addEventListener('click', () => flip(true));
  open.addEventListener('click', () => flip(false));
}
