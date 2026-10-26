import { el } from './dom.js';
import { formatTime, validateTrim, trimPayload } from './trim-fields.js';

const HINT = 'Cut only this part of the source. Leave empty to keep everything.';
const BASE = 'Advanced';

let seq = 0;

export function trimBlock({ start = null, end = null, hint = null, duration = null, audio = false, songId = null, redownload = null } = {}) {
  seq += 1;
  const id = `trim-${seq}`;
  const mk = (label, name, value) => {
    const inp = el('input', { type: 'text', id: `${id}-${name}`, value: value == null ? '' : formatTime(value), placeholder: 'm:ss', inputMode: 'text', autocomplete: 'off', spellcheck: 'false', 'aria-describedby': `${id}-hint ${id}-msg` });
    return { inp, node: el('div', { class: 'field' }, el('label', { for: `${id}-${name}` }, label), inp) };
  };
  const hinted = start == null && hint != null && hint > 0;
  const s = mk('Start', 'start', hinted ? hint : start);
  const e = mk('End', 'end', end);
  const len = el('p', { class: 't-caption muted', role: 'status' });
  const msg = el('p', { class: 'msg error t-caption', id: `${id}-msg`, role: 'alert', hidden: true });
  const note = el('p', { class: 't-caption muted trim-note', hidden: true });
  const summary = el('summary', {}, BASE);
  const initialStart = hinted ? hint : start;
  const initialEnd = end;
  const changedFromStored = () => {
    const r = validateTrim(s.inp.value, e.inp.value, duration);
    return (r.start || null) !== (start || null) || (r.end ?? null) !== (end ?? null);
  };
  const reBtn = el('button', { class: 'btn outline small', type: 'button', hidden: true }, 'Re-download with this cut');
  const reMsg = el('p', { class: 't-caption muted', role: 'status' });

  const paint = ({ show = false } = {}) => {
    const r = validateTrim(s.inp.value, e.inp.value, duration);
    let marker = '';
    if (r.start) marker = ` · cut from ${formatTime(r.start)}`;
    else if (r.end) marker = ` · cut to ${formatTime(r.end)}`;
    summary.textContent = `${BASE}${marker}`;
    len.textContent = r.length !== null ?`Length: ${formatTime(r.length)}` : '';
    if (show || r.error) {
      msg.textContent = r.error || '';
      msg.hidden = !r.error;
    }
    if (!r.error) { msg.hidden = true; msg.textContent = ''; }
    s.inp.setAttribute('aria-invalid', r.error ? 'true' : 'false');
    const stored = audio && changedFromStored() && !r.error;
    note.hidden = !(audio && changedFromStored());
    note.textContent = note.hidden ? '' : 'Changing the cut needs a new download.';
    reBtn.hidden = !(stored && redownload);
  };
  s.inp.addEventListener('input', () => paint());
  e.inp.addEventListener('input', () => paint());
  paint();

  if (redownload) {
    reBtn.addEventListener('click', async () => {
      const r = validateTrim(s.inp.value, e.inp.value, duration);
      if (r.error) { paint({ show: true }); return; }
      reBtn.disabled = true;
      reMsg.textContent = '';
      try {
        await redownload(songId, trimPayload(r.start, r.end));
        reMsg.textContent = 'Re-download started.';
      } catch (ex) {
        reMsg.textContent = ex?.status === 404 ? 'Re-download is not available yet.' : (ex?.message || 'Re-download failed.');
      } finally {
        reBtn.disabled = false;
      }
    });
  }

  const node = el('details', { class: 'trim-block' },
    summary,
    el('div', { class: 'grid2' }, s.node, e.node),
    el('p', { class: 't-caption muted', id: `${id}-hint` }, HINT),
    len, msg, note,
    redownload ? el('div', { class: 'row' }, reBtn, reMsg) : null);

  return {
    node,
    check() {
      const r = validateTrim(s.inp.value, e.inp.value, duration);
      paint({ show: true });
      return r.error;
    },
    value() {
      const r = validateTrim(s.inp.value, e.inp.value, duration);
      return r.error ? null : trimPayload(r.start, r.end);
    },
    changed: () => changedFromStored(),
    reset() {
      s.inp.value = initialStart == null ? '' : formatTime(initialStart);
      e.inp.value = initialEnd == null ? '' : formatTime(initialEnd);
      paint();
    },
  };
}
