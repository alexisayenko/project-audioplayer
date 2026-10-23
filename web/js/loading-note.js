import { el } from './dom.js';

export function loadingNote() {
  return el('p', { class: 'loading-note t-subhead', role: 'status' }, 'Loading...');
}
