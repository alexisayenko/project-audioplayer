import { auth } from './api.js';
import { el, plural } from './dom.js';
import { icon } from './icons.js';
import { isGuest } from './guest.js';
import { bpmCard, metadataCard } from './backfill-card.js';
import { loadCollapsed, saveCollapsed, PANEL_KEYS } from './collapsible.js';

export function pendingText(meta, bpm) {
  const parts = [];
  if (meta > 0) parts.push(`${meta} ${plural(meta, 'song needs', 'songs need')} metadata`);
  if (bpm > 0) parts.push(`${bpm} ${plural(bpm, 'song needs', 'songs need')} BPM`);
  return parts.join(', ');
}

export function libraryTools(storage = globalThis.localStorage) {
  if (isGuest() || !auth.email) return null;
  const pending = { meta: 0, bpm: 0 };
  const badge = el('small', { class: 't-caption lib-tools-badge', hidden: true });
  const hint = el('span', { class: 'muted t-caption lib-tools-hint', role: 'status' });
  const toggle = el('button', { class: 'btn outline small lib-tools-btn', type: 'button', 'aria-controls': 'lib-tools-body' },
    icon('tools', 'inline'), 'Library tools', badge, el('span', { class: 'cl-chev', 'aria-hidden': 'true' }, icon('chevron', 'inline')));
  const body = el('div', { class: 'lib-tools-body', id: 'lib-tools-body' });
  const root = el('section', { class: 'lib-tools', 'aria-label': 'Library tools' }, el('div', { class: 'lib-tools-bar' }, toggle, hint), body);

  const paint = () => {
    const total = pending.meta + pending.bpm;
    const text = pendingText(pending.meta, pending.bpm);
    badge.textContent = String(total);
    badge.hidden = !total;
    hint.textContent = text;
    toggle.setAttribute('aria-label', text ? `Library tools, ${text}` : 'Library tools');
  };
  const set = (collapsed) => {
    body.hidden = collapsed;
    toggle.classList.toggle('collapsed', collapsed);
    toggle.setAttribute('aria-expanded', String(!collapsed));
  };

  body.append(
    metadataCard((s) => { pending.meta = s.candidates || 0; paint(); }),
    bpmCard((s) => { pending.bpm = s.candidates || 0; paint(); }));
  set(loadCollapsed(storage, PANEL_KEYS.libTools, 0));
  toggle.addEventListener('click', () => {
    const v = !body.hidden;
    set(v);
    saveCollapsed(storage, PANEL_KEYS.libTools, v);
  });
  paint();
  return root;
}
