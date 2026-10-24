import { el } from './dom.js';

export const TABS = [
  { id: 'track', label: 'Modify', hash: '#/studio' },
  { id: 'tools', label: 'Analyze', hash: '#/studio/tools' },
  { id: 'simple', label: 'Synthesize', hash: '#/studio/simple' },
];

export const tabFromHash = (hash) => {
  const m = /^#\/?studio\/(tools|simple)$/.exec(hash || '');
  return m ? m[1] : 'track';
};

let refocus = false;

export function studioTabs(active, go = (hash) => { globalThis.location.hash = hash; }, tabs = TABS) {
  const buttons = tabs.map((t) => {
    const on = t.id === active;
    return el('button', {
      class: `seg-btn${on ? ' on' : ''}`, type: 'button', role: 'tab', id: `stu-tab-${t.id}`, 'aria-controls': `stu-${t.id}`,
      'aria-selected': String(on), tabindex: on ? '0' : '-1',
      onclick: () => { if (!on) go(t.hash); },
    }, t.label);
  });
  const bar = el('div', { class: 'seg stu-tabs', role: 'tablist', 'aria-label': 'Studio view' }, ...buttons);
  bar.addEventListener('keydown', (e) => {
    const at = tabs.findIndex((t) => t.id === active);
    const next = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const to = tabs[(next + tabs.length) % tabs.length];
    if (to.id === active) return;
    refocus = true;
    go(to.hash);
  });
  return {
    bar,
    restoreFocus() {
      if (!refocus) return;
      refocus = false;
      buttons[tabs.findIndex((t) => t.id === active)].focus();
    },
  };
}
