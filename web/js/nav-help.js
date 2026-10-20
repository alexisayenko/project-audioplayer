import { el } from './dom.js';
import { icon } from './icons.js';

export const HELP_ROUTES = ['theory', 'about', 'features'];
const GLYPHS = { theory: 'theory', about: 'info', features: 'features' };
export const isHelpRoute = (name) => HELP_ROUTES.includes(name);

export function helpMode(width, collapsed) {
  if (width < 480) return 'sheet';
  if (width < 720 || collapsed) return 'flyout';
  return 'inline';
}

export function initHelpNav(doc = document, win = window) {
  const group = doc.getElementById('nav-help');
  const toggle = doc.getElementById('help-toggle');
  const sub = doc.getElementById('help-sub');
  const sheet = doc.getElementById('help-sheet');
  if (!group || !toggle || !sub) return null;
  let open = false;
  let first = true;
  let current = '';
  const mode = () => helpMode(win.innerWidth, doc.body.classList.contains('side-collapsed'));

  const links = () => [...sub.querySelectorAll('a')];

  function buildSheet() {
    if (!sheet) return;
    sheet.replaceChildren(
      el('span', { class: 'grab', 'aria-hidden': 'true' }),
      el('div', { class: 'sheet-head' }, el('h2', { id: 'help-sheet-title', class: 't-title' }, 'Help')),
      el('ul', { class: 'sheet-list' }, ...links().map((a) => {
        const route = a.dataset.route;
        const name = a.querySelector('.nav-label')?.textContent ?? '';
        const iconName = GLYPHS[route];
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
    toggle.setAttribute('aria-controls', m === 'sheet' ? 'help-sheet' : 'help-sub');
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
    sync(name) {
      current = name;
      const help = isHelpRoute(name);
      toggle.classList.toggle('active', help);
      if (help && !first && mode() === 'inline') setOpen(true);
      else if (open && mode() !== 'inline') setOpen(false);
      first = false;
    },
    refresh() { setOpen(false); },
  };
}
