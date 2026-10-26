import { el } from './dom.js';
import { icon } from './icons.js';
import { defaultStorage, loadExpanded, saveExpanded, navNameOfHash, resolveExpanded } from './sidebar-state.js';

export const HELP_ROUTES = ['theory', 'about', 'features'];
const GLYPHS = { theory: 'theory', about: 'info', features: 'features' };
export const isHelpRoute = (name) => HELP_ROUTES.includes(name);

export function helpMode(width, collapsed) {
  if (width < 480) return 'sheet';
  if (width < 720 || collapsed) return 'flyout';
  return 'inline';
}

export const LIBRARY_ROUTES = ['library', 'library/albums', 'library/drafts'];
export const isLibraryRoute = (name) => LIBRARY_ROUTES.includes(name);
const LIB_GLYPHS = { library: 'library', 'library/albums': 'albums', 'library/drafts': 'pencil' };

const HELP_CFG = { id: 'help', group: 'nav-help', toggle: 'help-toggle', sub: 'help-sub', sheet: 'help-sheet', title: 'Help', glyphs: GLYPHS, owns: isHelpRoute };
const LIBRARY_CFG = { id: 'library', group: 'nav-library', toggle: 'library-toggle', sub: 'library-sub', sheet: 'library-sheet', title: 'Library', glyphs: LIB_GLYPHS, owns: isLibraryRoute };

export const initHelpNav = (doc = document, win = window, opts = {}) => initNavGroup(HELP_CFG, doc, win, opts);
export const initLibraryNav = (doc = document, win = window, opts = {}) => initNavGroup(LIBRARY_CFG, doc, win, opts);

export function initNavGroup(cfg, doc = document, win = window, opts = {}) {
  const group = doc.getElementById(cfg.group);
  const toggle = doc.getElementById(cfg.toggle);
  const sub = doc.getElementById(cfg.sub);
  const sheet = doc.getElementById(cfg.sheet);
  if (!group || !toggle || !sub) return null;
  const storage = opts.storage === undefined ? defaultStorage() : opts.storage;
  let first = true;
  let current = '';
  const mode = () => helpMode(win.innerWidth, doc.body.classList.contains('side-collapsed'));
  let open = resolveExpanded({
    ownsActive: cfg.owns(navNameOfHash(opts.hash ?? win.location?.hash)),
    remembered: loadExpanded(storage)[cfg.id],
    inline: mode() === 'inline',
  });

  const links = () => [...sub.querySelectorAll('a')];

  function buildSheet() {
    if (!sheet) return;
    sheet.replaceChildren(
      el('span', { class: 'grab', 'aria-hidden': 'true' }),
      el('div', { class: 'sheet-head' }, el('h2', { id: `${cfg.sheet}-title`, class: 't-title' }, cfg.title)),
      el('ul', { class: 'sheet-list' }, ...links().map((a) => {
        const route = a.dataset.route;
        const name = a.querySelector('.nav-label')?.childNodes[0]?.textContent ?? a.querySelector('.nav-label')?.textContent ?? '';
        const iconName = cfg.glyphs[route];
        const link = el('a', { class: 'sheet-link', href: a.getAttribute('href'), 'data-route': route }, iconName ? icon(iconName) : null, el('span', {}, name));
        if (route === current) link.setAttribute('aria-current', 'page');
        link.addEventListener('click', () => sheet.close());
        return el('li', {}, link);
      })));
  }

  function render() {
    const m = mode();
    group.dataset.mode = m;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-controls', m === 'sheet' ? cfg.sheet : cfg.sub);
    sub.hidden = !(open && m !== 'sheet');
  }

  function place() {
    const r = toggle.getBoundingClientRect();
    sub.style.setProperty('--fly-x', `${r.right}px`);
    sub.style.setProperty('--fly-y', `${r.top}px`);
  }

  function setOpen(next) {
    const m = mode();
    if (next && m === 'flyout') place();
    if (next && m === 'sheet' && sheet) {
      buildSheet();
      if (!sheet.open) sheet.showModal();
    }
    if (!next && sheet?.open) sheet.close();
    open = next;
    render();
  }

  toggle.addEventListener('click', (e) => {
    setOpen(!open);
    if (mode() === 'inline') saveExpanded(storage, cfg.id, open);
    if (open && mode() === 'flyout' && e.detail === 0) links()[0]?.focus();
  });
  sheet?.addEventListener('close', () => { open = false; render(); });
  sheet?.addEventListener('click', (e) => { if (e.target === sheet) sheet.close(); });
  doc.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && open && mode() === 'flyout') { setOpen(false); toggle.focus(); }
  });
  doc.addEventListener('click', (e) => {
    if (open && mode() === 'flyout' && !group.contains(e.target)) setOpen(false);
  });
  group.addEventListener('focusout', (e) => {
    if (open && mode() === 'flyout' && e.relatedTarget && !group.contains(e.relatedTarget)) setOpen(false);
  });
  win.addEventListener('resize', () => { if (group.dataset.mode !== mode()) setOpen(false); });

  render();
  return {
    mark(name) {
      toggle.classList.toggle('active', cfg.owns(name));
    },
    sync(name) {
      current = name;
      const owned = cfg.owns(name);
      toggle.classList.toggle('active', owned);
      if (owned && mode() === 'inline') setOpen(true);
      else if (open && mode() !== 'inline') setOpen(false);
      first = false;
    },
    refresh() {
      if (first) {
        if (mode() !== 'inline') open = false;
        render();
        return;
      }
      setOpen(false);
    },
  };
}
