import { api } from './api.js';
import { store } from './store.js';
import { el } from './dom.js';

const bpmText = (v) => (v != null ? `${Math.round(v)} BPM` : 'Not detected yet');

export function bpmRow({ isAdd, initial }) {
  if (isAdd) return el('p', { class: 't-caption muted' }, 'BPM is detected after saving');
  const bpmValue = el('span', { title: 'Heuristic, may be off by half or double' }, bpmText(initial.bpm));
  const bpmErr = el('p', { class: 'msg error', hidden: true });
  const redetect = el('button', { type: 'button', class: 'btn outline small' }, 'Re-detect');
  redetect.addEventListener('click', async () => {
    redetect.disabled = true;
    redetect.textContent = 'Detecting...';
    try {
      const updated = await api.detectBpm(initial.id);
      bpmValue.textContent = bpmText(updated.bpm);
      bpmErr.hidden = true;
      await store.refresh();
    } catch (ex) {
      bpmErr.textContent = ex.message;
      bpmErr.hidden = false;
    } finally {
      redetect.disabled = false;
      redetect.textContent = 'Re-detect';
    }
  });
  return el('div', { class: 'field' }, el('label', {}, 'BPM'), el('div', { class: 'row' }, bpmValue, redetect), bpmErr);
}
