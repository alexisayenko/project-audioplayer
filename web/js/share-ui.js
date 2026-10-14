import { player } from './player.js';
import { el, toast, fmtTime } from './dom.js';
import { icon } from './icons.js';
import { displayString } from './display-title.js';
import { vizMode, vizBackgroundOn } from './viz-settings.js';
import { modeLabel } from './viz-modes.js';
import { getStyle, styleLabel } from './viz-terrain-style.js';
import { getCam } from './viz-cam-debug.js';
import { buildShareUrl, parseClock, fmtClock, camDiffers, clampT } from './share.js';

const $ = (id) => document.getElementById(id);

export async function copyText(text, doc = document, nav = globalThis.navigator) {
  try {
    if (nav?.clipboard?.writeText) { await nav.clipboard.writeText(text); return true; }
  } catch { /* fall back to the textarea copy */ }
  const ta = doc.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  doc.body.append(ta);
  ta.select();
  ta.setSelectionRange?.(0, text.length);
  let ok = false;
  try { ok = !!doc.execCommand('copy'); } catch { ok = false; }
  ta.remove();
  return ok;
}

export function shareState(song, audio = $('audio')) {
  const mode = vizMode();
  const current = player.current?.id === song.id;
  return {
    mode,
    style: mode === 'terrain' ? getStyle() : null,
    bg: vizBackgroundOn(),
    cam: mode === 'terrain' && camDiffers(getCam()) ? { ...getCam() } : null,
    t: current && Number.isFinite(audio?.currentTime) ? Math.floor(audio.currentTime) : 0,
    current,
  };
}

function summary(st) {
  const bits = [modeLabel(st.mode)];
  if (st.style) bits.push(styleLabel(st.style));
  bits.push(st.bg ? 'background on' : 'background off');
  return `Visualizer: ${bits.join(', ')}`;
}

function dialog() {
  let dlg = $('share-dialog');
  if (!dlg) {
    dlg = el('dialog', { id: 'share-dialog', class: 'sheet', 'aria-labelledby': 'share-title' });
    dlg.addEventListener('keydown', (e) => e.stopPropagation());
    document.body.append(dlg);
  }
  return dlg;
}

export function openShareDialog(song, audio = $('audio')) {
  if (!song) return;
  const dlg = dialog();
  const st = shareState(song, audio);
  const canShare = typeof globalThis.navigator?.share === 'function';
  const atCur = el('input', { type: 'checkbox', id: 'share-at-cur' });
  atCur.checked = st.current && st.t > 0;
  const time = el('input', { type: 'text', id: 'share-time', class: 'share-time', inputMode: 'numeric', autocomplete: 'off', placeholder: '0:00', value: fmtClock(st.t) });
  const fs = el('input', { type: 'checkbox', id: 'share-fs' });
  const cam = st.cam ? el('input', { type: 'checkbox', id: 'share-cam' }) : null;
  const out = el('input', { type: 'text', id: 'share-url', class: 'share-url', readOnly: true, 'aria-label': 'Share link' });
  const err = el('p', { class: 'msg error', id: 'share-err', hidden: true }, 'Use mm:ss, for example 1:23');
  const live = el('output', { class: 'viz-sr', role: 'status', 'aria-live': 'polite', id: 'share-live' });
  const copy = el('button', { class: canShare ? 'btn outline' : 'btn primary', type: 'button', id: 'share-copy' }, 'Copy link');
  const send = canShare ? el('button', { class: 'btn primary', type: 'button', id: 'share-send' }, 'Share') : null;
  const origin = () => globalThis.location?.origin ?? '';
  const seconds = () => parseClock(time.value);
  const link = () => {
    const t = seconds();
    if (t === null) return null;
    return buildShareUrl({
      origin: origin(), id: song.id, t: clampT(t, song.duration), viz: st.mode, style: st.style, bg: st.bg, fs: fs.checked, cam: cam?.checked ? st.cam : null,
    });
  };
  const refresh = () => {
    const url = link();
    const bad = url === null;
    err.hidden = !bad;
    time.setAttribute('aria-invalid', String(bad));
    out.value = url ?? '';
    copy.disabled = bad;
    if (send) send.disabled = bad;
  };
  atCur.addEventListener('change', () => {
    if (atCur.checked) time.value = fmtClock(st.current ? audio.currentTime : st.t);
    refresh();
  });
  time.addEventListener('input', () => { atCur.checked = false; refresh(); });
  time.addEventListener('blur', () => { const t = seconds(); if (t !== null) time.value = fmtClock(clampT(t, song.duration)); });
  for (const c of [fs, cam]) c?.addEventListener('change', refresh);
  out.addEventListener('focus', () => out.select());
  const done = (ok) => {
    live.textContent = '';
    setTimeout(() => { live.textContent = ok ? 'Link copied' : 'Copy failed, select the link and copy it by hand'; }, 30);
    toast(ok ? 'Link copied' : 'Copy failed');
  };
  copy.addEventListener('click', async () => { if (out.value) done(await copyText(out.value)); });
  send?.addEventListener('click', async () => {
    if (!out.value) return;
    try {
      await globalThis.navigator.share({ title: displayString(song), url: out.value });
    } catch (e) {
      if (e?.name !== 'AbortError') done(await copyText(out.value));
    }
  });
  const row = (input, text) => el('label', { class: 'check-row t-body' }, input, ' ', text);
  dlg.replaceChildren(
    el('div', { class: 'dlg-head' },
      el('div', {}, el('h2', { class: 't-title', id: 'share-title' }, 'Share link'), el('p', { class: 'muted t-caption' }, displayString(song))),
      el('button', { type: 'button', class: 'link-btn t-headline', onclick: () => dlg.close() }, 'Close')),
    el('div', { class: 'field' }, row(atCur, `Start at current time${st.current ? ` (${fmtTime(audio.currentTime)})` : ''}`),
      el('label', { for: 'share-time' }, 'Start time (mm:ss)'), time, err),
    row(fs, 'Open in full-screen visualizer'),
    cam ? row(cam, 'Include camera') : null,
    el('p', { class: 'muted t-caption' }, summary(st)),
    el('div', { class: 'field' }, el('label', { for: 'share-url' }, 'Link'), out),
    el('p', { class: 'muted t-caption' }, 'Opens only for people who can see this song in the library.'),
    el('div', { class: 'row end' }, copy, send),
    live);
  refresh();
  dlg.showModal();
  time.focus();
}

export function initShare() {
  const buttons = ['p-share', 'viz-share'].map($).filter(Boolean);
  for (const b of buttons) {
    b.replaceChildren(icon('share', b.id === 'p-share' ? 20 : 22));
    b.addEventListener('click', () => openShareDialog(player.current));
  }
  const sync = () => { for (const b of buttons) b.hidden = !player.current; };
  player.onChange(sync);
  sync();
}
