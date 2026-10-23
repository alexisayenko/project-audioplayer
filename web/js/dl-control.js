import { el } from './dom.js';
import { icon } from './icons.js';
import { autodl } from './autodl.js';
import { ringModel } from './dl-progress.js';
import { rowActions } from './row-actions.js';
import { ringNode } from './dl-ring.js';

export function fetchAudio(id) {
  autodl.request([id], { front: true });
}

export function downloadButton(id, label) {
  return el('button', {
    class: 'icon sq-btn', type: 'button', title: 'Download to the server', 'aria-label': `Download: ${label}`,
    onclick: (e) => { e.stopPropagation(); fetchAudio(id); },
  }, icon('download', 'inline'));
}

export function fetchControl(id, label) {
  const dl = ringModel(autodl.view(id));
  const act = rowActions({ audio: false, ring: dl });
  if (act.ring) return ringNode(dl, () => autodl.retry(id));
  return act.download ? downloadButton(id, label) : null;
}
