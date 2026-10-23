import { el } from './dom.js';

export function loadingNote(text = 'Loading...') {
  return el('p', { class: 'loading-note t-subhead', role: 'status' }, text);
}
