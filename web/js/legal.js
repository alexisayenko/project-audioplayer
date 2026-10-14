import { el } from './dom.js';

export const NOTE = 'A private personal library. All music and artwork belong to their authors and rights holders, who are credited on each song. Audio is streamed for private listening and cannot be downloaded. To have a song removed, contact the owner.';
const REMOVAL = 'To have a song removed, contact';
const EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;
const URL_OK = /^https:\/\/[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+(:\d{1,5})?(\/[^\s<>"']*)?$/;

const state = { note: NOTE, contact: null };

export function contactHref(contact) {
  const value = typeof contact === 'string' ? contact.trim() : '';
  if (EMAIL.test(value)) return `mailto:${value}`;
  return URL_OK.test(value) ? value : null;
}

export function buildLegal(note = NOTE, contact = null) {
  const href = contactHref(contact);
  const at = note.lastIndexOf(REMOVAL);
  if (!href || at < 0) return [note];
  const link = el('a', { href, rel: 'noopener noreferrer', target: href.startsWith('mailto:') ? null : '_blank' }, contact.trim());
  return [`${note.slice(0, at)}${REMOVAL} `, link, '.'];
}

export function legalVisible({ guest = false, route = '', vizFull = false } = {}) {
  return !vizFull && (guest || route === 'settings');
}

export function syncLegal(footer, ctx) {
  if (!footer) return;
  footer.replaceChildren(...buildLegal(state.note, state.contact));
  footer.hidden = !legalVisible(ctx);
}

export async function loadLegal(footer, ctx) {
  try {
    const res = await fetch('/legal');
    const data = res.ok ? await res.json() : null;
    if (typeof data?.note === 'string' && data.note) state.note = data.note;
    state.contact = typeof data?.contact === 'string' ? data.contact : null;
  } catch { /* the built-in note stays */ }
  syncLegal(footer, ctx());
}
