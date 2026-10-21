import { api as defaultApi } from './api.js';
import { store } from './store.js';
import { el, pageHead } from './dom.js';
import { icon } from './icons.js';
import { hasAudio } from './playable.js';
import { can } from './guest.js';
import { titleLine, artistLine } from './credits.js';
import { fmtClock, parseClock, validRegion } from './loop-engine.js';
import { fmtRemainingClock, paintElapsed, elapsedButton, onTimeLeftChange } from './time-left.js';
import { loadPeaks, drawPeaks, sizeCanvas, xToTime, timeToX } from './peaks.js';
import { loopsOf, addLoop, renameLoop, removeLoop, sameRegion, MAX_LOOPS, MAX_NAME, FULL_TEXT } from './loops-model.js';

export const TAGLINE = 'Work on a track: loop a section, mark it, keep it.';
export const EMPTY_TEXT = 'Play a song to open it in the Studio.';
export const PREPARING = 'Preparing waveform...';
export const UNAVAILABLE = 'Waveform unavailable. The timeline still works.';
export const SIGN_IN_NOTE = 'Sign in to save loops';
export const TIME_HINT = 'Use m:ss.s, for example 0:12.4';
export const NEED_MARKS = 'Mark A and B to loop.';
export const NUDGES = [-1, -0.1, 0.1, 1];
export const NOTE_MS = 2000;
const WAVE_HEIGHT = 140;
const FALLBACK_WIDTH = 600;
const SIDES = {
  start: { key: 'a', name: 'A', text: 'Loop start', here: 'Set A here' },
  end: { key: 'b', name: 'B', text: 'Loop end', here: 'Set B here' },
};

const nudgeText = (d) => `${d > 0 ? '+' : '-'}${Math.abs(d)} s`;
const nudgeLabel = (side, d) => `${SIDES[side].text} ${d > 0 ? 'later' : 'earlier'} by ${Math.abs(d)} s`;

function readColors(node) {
  const css = node.ownerDocument?.defaultView?.getComputedStyle?.(node);
  const get = (name, fallback) => css?.getPropertyValue(name).trim() || fallback;
  return {
    wave: get('--ink-muted', '#888'),
    waveActive: get('--fill', '#2298b1'),
    region: get('--accent-tint', '#cdeef3'),
    playhead: get('--ink', '#000'),
  };
}

export function renderStudio(root, env = {}) {
  const player = env.player;
  const api = env.api ?? defaultApi;
  const load = env.load ?? loadPeaks;
  const raf = env.raf ?? ((fn) => globalThis.requestAnimationFrame?.(fn) ?? 0);
  const caf = env.caf ?? ((id) => globalThis.cancelAnimationFrame?.(id));
  const loop = player.loop;
  const head = pageHead('Studio', TAGLINE);
  const body = el('div', { class: 'stu' });
  root.append(head, body);

  let shownId = null;
  let shownAudio = false;
  let parts = null;
  let abort = null;
  let peaks = null;
  let status = 'idle';
  let frame = 0;
  let dragTime = null;
  let noteTimer = null;
  let editing = -1;
  let busy = false;
  let lastKey = '';
  let savedKey = '';
  let view = 'none';
  let colors = null;
  let colorsAt = 0;
  let disposed = false;

  const duration = () => {
    const d = player.duration;
    if (Number.isFinite(d) && d > 0) return d;
    return peaks?.duration ?? player.current?.audio?.duration ?? player.current?.duration ?? 0;
  };
  const position = () => (Number.isFinite(player.position) ? player.position : 0);

  function note(text, kind = '') {
    if (!parts) return;
    parts.note.textContent = text;
    parts.note.className = `stu-note t-caption${kind ? ` ${kind}` : ''}`;
    clearTimeout(noteTimer);
    if (text) noteTimer = setTimeout(() => { if (parts) parts.note.textContent = ''; }, NOTE_MS);
  }

  function wavePaint() {
    if (!parts) return;
    const { canvas, wave } = parts;
    const width = Math.round(wave.clientWidth || FALLBACK_WIDTH);
    const height = Math.round(wave.clientHeight || WAVE_HEIGHT);
    const dpr = globalThis.devicePixelRatio || 1;
    const ctx = canvas.getContext?.('2d');
    if (!ctx) return;
    const s = loop.get();
    const t = dragTime ?? position();
    paintClock(t);
    const key = [width, height, dpr, t.toFixed(2), s.start, s.end, status, peaks ? peaks.buckets : 0, duration()].join('|');
    if (key === lastKey) return;
    lastKey = key;
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) sizeCanvas(canvas, width, height, dpr);
    const now = Date.now();
    if (!colors || now - colorsAt > 500) { colors = readColors(canvas); colorsAt = now; }
    drawPeaks(ctx, peaks, { width, height, dpr, duration: duration(), playhead: t, region: validRegion(s) ? s : null, colors });
  }

  function paintClock(t) {
    if (!parts) return;
    const dur = duration();
    paintElapsed(parts.elapsed, fmtClock(t), fmtRemainingClock(t, dur));
    parts.dur.textContent = ` / ${fmtClock(dur)}`;
  }

  function placeHandles() {
    const s = loop.get();
    const dur = duration();
    for (const side of ['start', 'end']) {
      const h = parts.handles[side];
      const v = s[side];
      h.hidden = v == null || !(dur > 0);
      if (h.hidden) continue;
      const label = `${SIDES[side].text} ${fmtClock(v)}`;
      h.style.left = `${(timeToX(v, dur, 1) * 100).toFixed(3)}%`;
      h.setAttribute('aria-label', label);
      h.setAttribute('aria-valuetext', label);
      h.setAttribute('aria-valuemin', '0');
      h.setAttribute('aria-valuemax', String(Math.round(dur * 10) / 10));
      h.setAttribute('aria-valuenow', String(v));
    }
  }

  function syncControls() {
    if (!parts) return;
    const s = loop.get();
    const dur = duration();
    for (const side of ['start', 'end']) {
      const p = parts.marks[side];
      if (document.activeElement !== p.input) { p.input.value = s[side] == null ? '' : fmtClock(s[side]); p.input.removeAttribute('aria-invalid'); }
      for (const b of p.nudges) b.disabled = s[side] == null;
    }
    const ready = validRegion(s, dur);
    parts.toggle.disabled = !ready && !s.on;
    parts.toggle.setAttribute('aria-pressed', String(s.on));
    parts.toggle.classList.toggle('fill', s.on);
    parts.toggle.classList.toggle('outline', !s.on);
    parts.toggleText.textContent = s.on ? 'Loop on' : 'Loop off';
    parts.hint.textContent = ready || s.on ? '' : NEED_MARKS;
    if (parts.save) parts.save.disabled = !ready || busy || loopsOf(player.current).length >= MAX_LOOPS;
    placeHandles();
    paintSaved();
    lastKey = '';
    wavePaint();
  }

  async function persist(next, done) {
    const song = player.current;
    if (!song || busy) return;
    busy = true;
    syncControls();
    try {
      const saved = await api.patch(song.id, { loops: next });
      const mine = store.get(song.id) ?? song;
      const list = Array.isArray(saved?.loops) ? saved.loops : [];
      if (list.length) mine.loops = list; else delete mine.loops;
      if (mine !== song) { if (list.length) song.loops = list; else delete song.loops; }
      note(done, 'ok');
    } catch (ex) {
      note(ex?.message || 'Could not save the loops. Try again.', 'error');
    } finally {
      busy = false;
      editing = -1;
      if (!disposed) syncControls();
    }
  }

  function pickLoop(l) {
    loop.setRegion(l.start, l.end, true);
    player.seek(l.start);
    player.play();
  }

  function paintSaved() {
    if (!parts?.list) return;
    const saved = loopsOf(player.current);
    const s = loop.get();
    const key = JSON.stringify([saved, s.on, s.start, s.end, busy, editing]);
    if (key === savedKey) return;
    savedKey = key;
    const rows = saved.map((l, i) => {
      if (editing === i) return editRow(l, i);
      const on = s.on && sameRegion(l, s);
      const pick = el('button', { class: `chip stu-pick${on ? ' on' : ''}`, type: 'button', 'aria-pressed': String(on), title: `Loop ${l.name}`, onclick: () => pickLoop(l) },
        el('span', { class: 'stu-loop-name' }, l.name), ' ', el('span', { class: 't-time' }, `${fmtClock(l.start)} - ${fmtClock(l.end)}`));
      return el('li', { class: 'stu-loop' }, pick,
        el('button', { class: 'icon round', type: 'button', 'aria-label': `Rename ${l.name}`, title: 'Rename', disabled: busy, onclick: () => { editing = i; paintSaved(); parts.list.querySelector('.stu-rename')?.focus(); } }, icon('pencil', 'action')),
        el('button', { class: 'icon round', type: 'button', 'aria-label': `Delete ${l.name}`, title: 'Delete', disabled: busy, onclick: () => remove(i) }, icon('clear', 'action')));
    });
    parts.list.replaceChildren(...rows);
    parts.savedHead.hidden = !saved.length;
    parts.list.hidden = !saved.length;
  }

  function editRow(l, i) {
    const input = el('input', { class: 'stu-rename', type: 'text', maxlength: MAX_NAME, value: l.name, 'aria-label': `Name of ${l.name}` });
    let finished = false;
    const finish = (commit) => {
      if (finished) return;
      finished = true;
      if (!commit) { editing = -1; paintSaved(); return; }
      const result = renameLoop(loopsOf(player.current), i, input.value);
      if (!result.ok) { note(result.error, 'error'); editing = -1; paintSaved(); return; }
      editing = -1;
      void persist(result.loops, 'Renamed.');
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
    });
    input.addEventListener('blur', () => finish(input.value.trim() !== l.name));
    return el('li', { class: 'stu-loop editing' }, input);
  }

  function remove(i) {
    const saved = loopsOf(player.current);
    const result = removeLoop(saved, i);
    if (!result.ok) { note(result.error, 'error'); return; }
    void persist(result.loops, `Deleted ${saved[i].name}.`);
  }

  function saveCurrent() {
    const s = loop.get();
    const result = addLoop(loopsOf(player.current), s, duration());
    if (!result.ok) { note(result.error, 'error'); return; }
    void persist(result.loops, `Saved as ${result.loops.at(-1).name}.`);
  }

  function markEditor(side) {
    const meta = SIDES[side];
    const input = el('input', { class: 'stu-time', type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '0:00.0', 'aria-label': `${meta.text} time (m:ss.s)` });
    const commit = () => {
      if (!input.value.trim()) return;
      const t = parseClock(input.value);
      if (t == null) { input.setAttribute('aria-invalid', 'true'); note(TIME_HINT, 'error'); return; }
      input.removeAttribute('aria-invalid');
      loop.setMark(side, t);
      syncControls();
    };
    input.addEventListener('change', commit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } });
    const nudges = NUDGES.map((d) => el('button', { class: 'btn outline small stu-nudge', type: 'button', title: nudgeLabel(side, d), 'aria-label': nudgeLabel(side, d), onclick: () => loop.nudge(side, d) }, nudgeText(d)));
    const here = el('button', { class: 'btn small stu-set', type: 'button', title: meta.here, 'aria-label': meta.here, onclick: () => loop.setMark(side, position()) }, icon('plus', 'action'), 'Set');
    const group = el('div', { class: 'stu-mark', role: 'group', 'aria-label': meta.text },
      el('div', { class: 'stu-mark-row' },
        el('label', { class: 'stu-mark-label t-caption', title: `${meta.name}: ${meta.text.toLowerCase()}` }, meta.name), input, here),
      el('div', { class: 'stu-nudges' }, ...nudges));
    return { group, input, nudges };
  }

  function handle(side) {
    const meta = SIDES[side];
    const h = el('div', { class: `stu-handle stu-${meta.key}`, role: 'slider', tabindex: '0', 'aria-orientation': 'horizontal', hidden: true },
      el('span', { class: 'stu-flag', 'aria-hidden': 'true' }, meta.name));
    let drag = null;
    const at = (e) => { const r = parts.wave.getBoundingClientRect(); return xToTime(e.clientX - r.left, r.width || FALLBACK_WIDTH, duration()); };
    h.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      drag = e.pointerId;
      h.setPointerCapture?.(e.pointerId);
      h.classList.add('dragging');
    });
    h.addEventListener('pointermove', (e) => { if (drag === e.pointerId) loop.move(side, at(e)); });
    const end = (e) => { if (drag !== e.pointerId) return; drag = null; h.classList.remove('dragging'); h.releasePointerCapture?.(e.pointerId); };
    h.addEventListener('pointerup', end);
    h.addEventListener('pointercancel', end);
    h.addEventListener('keydown', (e) => {
      const dir = e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : 0;
      if (!dir) return;
      e.preventDefault();
      e.stopPropagation();
      loop.nudge(side, dir * (e.shiftKey ? 1 : 0.1));
    });
    return h;
  }

  function toggleLoop() {
    const s = loop.get();
    loop.setOn(!s.on);
    const n = loop.get();
    if (n.on) {
      const t = position();
      if (t < n.start || t >= n.end) player.seek(n.start);
    }
  }

  function wireWave(wave, canvas) {
    let drag = null;
    const at = (e) => { const r = wave.getBoundingClientRect(); return xToTime(e.clientX - r.left, r.width || FALLBACK_WIDTH, duration()); };
    canvas.addEventListener('pointerdown', (e) => {
      if (!(duration() > 0)) return;
      drag = e.pointerId;
      canvas.setPointerCapture?.(e.pointerId);
      dragTime = at(e);
      wavePaint();
    });
    canvas.addEventListener('pointermove', (e) => { if (drag === e.pointerId) { dragTime = at(e); wavePaint(); } });
    const done = (e) => {
      if (drag !== e.pointerId) return;
      drag = null;
      canvas.releasePointerCapture?.(e.pointerId);
      if (dragTime != null) player.seek(dragTime);
      dragTime = null;
      wavePaint();
    };
    canvas.addEventListener('pointerup', done);
    canvas.addEventListener('pointercancel', () => { drag = null; dragTime = null; });
  }

  function statusText() {
    if (!parts) return;
    parts.status.textContent = status === 'loading' ? PREPARING : status === 'unavailable' ? UNAVAILABLE : '';
    parts.status.hidden = !parts.status.textContent;
  }

  function startPeaks(song) {
    abort?.abort();
    peaks = null;
    status = 'loading';
    statusText();
    const mine = new AbortController();
    abort = mine;
    Promise.resolve(load(song.id, { signal: mine.signal })).then((r) => {
      if (mine.signal.aborted || disposed) return;
      peaks = r.peaks;
      status = 'ready';
      statusText();
      syncControls();
    }, () => {
      if (mine.signal.aborted || disposed) return;
      status = 'unavailable';
      statusText();
      syncControls();
    });
  }

  function empty() {
    parts = null;
    view = 'empty';
    body.replaceChildren(el('div', { class: 'stu-empty card state' },
      el('p', { class: 't-subhead' }, EMPTY_TEXT),
      el('a', { class: 'btn primary', href: '#/library' }, 'Library')));
  }

  function build(song) {
    const canvas = el('canvas', { class: 'stu-canvas', 'aria-hidden': 'true' });
    const handles = { start: handle('start'), end: handle('end') };
    const wave = el('div', { class: 'stu-wave' }, canvas, handles.start, handles.end);
    const status$ = el('p', { class: 'stu-status muted t-caption', role: 'status', 'aria-live': 'polite', hidden: true });
    const elapsed = elapsedButton();
    const durText = el('span', {}, ' / 0:00.0');
    const clock = el('span', { class: 't-time stu-clock' }, elapsed, durText);
    paintElapsed(elapsed, '0:00.0', null);
    const toggleText = el('span', {}, 'Loop off');
    const toggle = el('button', { class: 'btn outline small stu-toggle', type: 'button', 'aria-pressed': 'false', onclick: toggleLoop }, icon('repeat', 'action'), toggleText);
    const hint = el('span', { class: 'stu-hint muted t-caption' });
    const marks = { start: markEditor('start'), end: markEditor('end') };
    const saveable = can('edit');
    const save = saveable ? el('button', { class: 'btn small', type: 'button', onclick: saveCurrent }, icon('plus', 'action'), 'Save loop') : null;
    const note$ = el('p', { class: 'stu-note t-caption', role: 'status', 'aria-live': 'polite' });
    const savedHead = el('h2', { class: 'stu-saved-head t-title', hidden: true }, 'Saved loops');
    const list = saveable ? el('ul', { class: 'stu-loops', hidden: true }) : null;
    view = 'song';
    savedKey = '';
    parts = { canvas, wave, handles, status: status$, clock, elapsed, dur: durText, toggle, toggleText, hint, marks, save, note: note$, savedHead, list };
    body.replaceChildren(el('section', { class: 'stu-card card', 'aria-label': 'Waveform' },
      el('div', { class: 'stu-song' }, el('b', { class: 't-subhead' }, titleLine(song)), el('span', { class: 'muted t-caption' }, artistLine(song))),
      wave, status$,
      el('div', { class: 'stu-bar' }, toggle, hint, clock),
      el('div', { class: 'stu-marks' }, marks.start.group, marks.end.group)),
    el('section', { class: 'stu-saved card', 'aria-label': 'Saved loops' },
      el('div', { class: 'stu-saved-bar' }, save, saveable ? null : el('p', { class: 'muted t-subhead stu-signin' }, SIGN_IN_NOTE)),
      savedHead, list, note$));
    wireWave(wave, canvas);
    ro?.observe(wave);
    lastKey = '';
    startPeaks(song);
    syncControls();
  }

  function refresh() {
    if (disposed) return;
    const song = player.current;
    const audio = !!song && hasAudio(song);
    if (!song || !audio) {
      shownId = null;
      shownAudio = false;
      if (view !== 'empty') { abort?.abort(); empty(); }
      return;
    }
    if (song.id !== shownId || view !== 'song') {
      shownId = song.id;
      shownAudio = true;
      editing = -1;
      build(song);
    } else {
      syncControls();
    }
  }

  const stopPlayer = player.onChange(refresh);
  const stopLoop = loop.onChange(() => { if (parts) syncControls(); });
  const tick = () => { frame = raf(tick); wavePaint(); };
  let ro = null;
  if (typeof ResizeObserver !== 'undefined') { ro = new ResizeObserver(() => { lastKey = ''; wavePaint(); }); ro.observe(body); }

  refresh();
  frame = raf(tick);
  const stopTimeLeft = onTimeLeftChange(() => paintClock(position()));

  return () => {
    disposed = true;
    abort?.abort();
    clearTimeout(noteTimer);
    caf(frame);
    ro?.disconnect();
    stopPlayer?.();
    stopLoop?.();
    stopTimeLeft();
    parts = null;
  };
}
