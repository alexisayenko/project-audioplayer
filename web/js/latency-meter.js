import { el } from './dom.js';
import * as realGraph from './audio-graph.js';
import { onMark } from './perf.js';
import { storeGet, storeSet } from './storage.js';
import { switchMode, SWITCH_KEY, SWITCH_MODES } from './stop-load.js';
import { createMeterCore, levelOfBytes, describeLayout, pressKind, isPlayKey, fileIdOf, resourceRows, SAMPLE_MS, STRIP_LEN } from './latency-core.js';

export const POS_KEY = 'ap2.perf.pos';
export const COLLAPSED_KEY = 'ap2.perf.collapsed';
export const TAP_KEY = 'ap2.perf.tap';

const CLICK_FOLLOW_MS = 1500;
const RUN_FRESH_MS = 2000;
const STALL_MS = 100;
const LAYOUT_BYTES = 4096;
const AUDIO_MARKS = ['loadstart', 'loadedmetadata', 'loadeddata', 'canplay', 'canplaythrough', 'playing', 'waiting', 'stalled', 'suspend', 'emptied', 'abort', 'error'];
const PERF_MARKS = new Set(['load() entry', 'audio.src set', 'audio.play() called', 'play() resolved', 'play() rejected', 'audioContext created', 'audioContext resume() called', 'audioContext resume() settled', 'createMediaElementSource done']);

const describe = (n) => {
  const t = n?.closest?.('button, a, li, [role="button"]') ?? n;
  return `${(t?.tagName ?? '').toLowerCase()}${t?.id ? `#${t.id}` : ''}`;
};

/**
 * The on-screen latency meter (PLY-212): a fixed panel that restarts at every press on Play, counts milliseconds, samples the audio level every 100 ms and reports the first sound.
 * Started only when the meter is switched on (`latency-flag.js`); nothing of it is loaded otherwise.
 */
export function startLatencyMeter({ audio = document.getElementById('audio'), win = window, doc = document, graph = realGraph, onClose = () => {} } = {}) {
  const now = () => win.performance.now();
  const core = createMeterCore();
  let t0 = 0;
  let prevId = null;
  let lastFrame = 0;
  let lastPress = null;
  let timer = null;
  let raf = 0;
  let resTimer = null;
  let analyserBuf = null;
  let layoutText = '';
  let shownMarks = -1;
  let dragging = false;
  const shown = {};

  const ui = buildPanel();
  const { panel } = ui;

  function ctxState() {
    const c = graph.getContext?.();
    return `${c?.state ?? 'none'}${graph.hasGraph?.() ? ', graph connected' : ', no graph'}`;
  }

  function readLevel() {
    const a = graph.getAnalyser?.();
    if (!a) return null;
    if (!analyserBuf || analyserBuf.length !== a.fftSize) analyserBuf = new Uint8Array(a.fftSize);
    a.getByteTimeDomainData(analyserBuf);
    return levelOfBytes(analyserBuf);
  }

  function tap() {
    if (storeGet(TAP_KEY) === '0') return;
    try {
      if (!graph.isSupported?.()) return;
      if (graph.hasGraph()) void graph.resume();
      else graph.unlock(audio);
    } catch { /* the meter falls back to timeupdate */ }
  }

  function text(node, key, value) {
    if (shown[key] === value) return;
    shown[key] = value;
    node.textContent = value;
  }

  function render(t) {
    const s = core.snapshot(t);
    text(ui.ms, 'ms', String(Math.round(s.ms)));
    const hit = s.soundMs != null;
    ui.sound.classList.toggle('lm-hit', hit);
    const idle = s.marks.length === 0;
    text(ui.sound, 'sound', hit ? `first sound at ${Math.round(s.soundMs)} ms` : idle ? 'press Play' : s.active ? 'waiting for sound' : 'no sound found');
    const level = s.level;
    text(ui.meta, 'meta', `${s.method === 'none' ? 'method: -' : s.method === 'level' ? 'method: level (analyser)' : 'method: timeupdate (no analyser)'}  ctx: ${shown.ctx ?? '-'}`);
    text(ui.levelNum, 'level', level == null ? '-' : String(level));
    ui.levelBar.style.setProperty('--v', String(level ?? 0));
    for (let i = 0; i < STRIP_LEN; i++) {
      const v = s.strip[s.strip.length - STRIP_LEN + i];
      const key = `strip${i}`;
      const val = v === undefined ? 'e' : v === null ? 'n' : String(v);
      if (shown[key] === val) continue;
      shown[key] = val;
      const cell = ui.strip[i];
      cell.style.setProperty('--v', v == null ? '0' : String(v));
      cell.className = v === undefined ? 'lm-e' : v === null ? 'lm-n' : '';
    }
    if (s.marks.length !== shownMarks) {
      shownMarks = s.marks.length;
      ui.marks.replaceChildren(...s.marks.map((m) => el('li', {}, el('b', {}, String(m.ms)), ` ${m.name}${m.detail ? ` ${m.detail}` : ''}`)));
      ui.marks.scrollTop = ui.marks.scrollHeight;
    }
  }

  function stopLoops() {
    clearInterval(timer);
    timer = null;
    cancelAnimationFrame(raf);
    raf = 0;
  }

  function updateResources() {
    try {
      core.setResources(resourceRows(win.performance.getEntriesByType('resource'), t0, { prevId, curId: fileIdOf(audio.getAttribute('src')) }));
    } catch { /* no resource timing */ }
  }

  function endRun() {
    stopLoops();
    updateResources();
    render(now());
  }

  function tickSample() {
    const t = now();
    const more = core.sample(t, readLevel());
    shown.ctx = ctxState();
    render(t);
    if (!more) endRun();
  }

  function frame() {
    raf = 0;
    if (!core.running) return;
    const t = now();
    if (lastFrame && t - lastFrame > STALL_MS) core.mark('main thread idle gap', t, `${Math.round(t - lastFrame)} ms without a frame`);
    lastFrame = t;
    render(t);
    raf = requestAnimationFrame(frame);
  }

  function raise() {
    if (dragging || !ui.popover) return;
    try {
      panel.hidePopover();
      panel.showPopover();
    } catch { /* stays where it is */ }
  }

  function begin(t, detail, armed) {
    stopLoops();
    clearTimeout(resTimer);
    t0 = t;
    prevId = fileIdOf(audio.getAttribute('src'));
    shownMarks = -1;
    core.press(t, detail, { armed });
    try {
      win.performance.setResourceTimingBufferSize?.(1000);
      win.performance.clearResourceTimings?.();
    } catch { /* the buffer keeps its size */ }
    core.fact('switch mode', switchMode());
    core.fact('tap', storeGet(TAP_KEY) === '0' ? 'off' : 'on');
    core.fact('song loaded at press', prevId ?? 'none');
    core.fact('audio playing at press', audio.paused ? 'no' : 'yes (a switch)');
    core.fact('ua', win.navigator.userAgent);
    core.fact('page', win.location.hash || '/');
    core.fact('audio context at press', ctxState());
    shown.ctx = ctxState();
    tap();
    render(t);
    timer = setInterval(tickSample, SAMPLE_MS);
    lastFrame = t;
    raf = requestAnimationFrame(frame);
    setTimeout(raise, 0);
  }

  function fresh() {
    return core.running && now() - t0 < RUN_FRESH_MS;
  }

  function press(e, t, how) {
    if (panel.contains(e.target)) return;
    const kind = pressKind(e.target, { paused: audio.paused, currentId: fileIdOf(audio.getAttribute('src')) });
    if (!kind) {
      lastPress = { t, text: `${how} ${describe(e.target)}` };
      return;
    }
    if (how === 'click' && core.running && t - t0 < CLICK_FOLLOW_MS) {
      core.mark('click', t);
      return;
    }
    begin(t, `${how} ${describe(e.target)}`, audio.paused);
  }

  const onDown = (e) => { const t = now(); press(e, t, 'pointerdown'); };
  const onClick = (e) => { const t = now(); press(e, t, 'click'); };
  const onKey = (e) => {
    const t = now();
    if (!isPlayKey(e) || panel.contains(e.target)) return;
    begin(t, `key ${e.key === ' ' ? 'Space' : e.key}`, audio.paused);
  };
  doc.addEventListener('pointerdown', onDown, { capture: true, passive: true });
  doc.addEventListener('click', onClick, { capture: true, passive: true });
  doc.addEventListener('keydown', onKey, { capture: true, passive: true });

  const audioListeners = [];
  const listen = (ev, fn) => { audio.addEventListener(ev, fn); audioListeners.push([ev, fn]); };
  listen('play', () => {
    const t = now();
    if (!fresh()) {
      const lp = lastPress && t - lastPress.t < CLICK_FOLLOW_MS ? lastPress : null;
      begin(lp ? lp.t : t, lp ? lp.text : 'play event', true);
    }
    core.mark('play', t);
  });
  for (const ev of AUDIO_MARKS) {
    listen(ev, () => {
      if (!core.running) return;
      const t = now();
      if (ev === 'loadstart' || ev === 'emptied') core.arm(t);
      core.mark(ev, t, `rs${audio.readyState}`);
      if (ev === 'playing') {
        core.fact('audio context at playing', ctxState());
        clearTimeout(resTimer);
        resTimer = setTimeout(updateResources, 700);
      }
    });
  }
  listen('timeupdate', () => { if (core.running) core.timeupdate(now(), audio.currentTime); });
  const offMark = onMark((name, t, detail) => { if (core.running && PERF_MARKS.has(name)) core.mark(name, t, detail); });

  async function checkLayout() {
    const src = audio.getAttribute('src');
    if (!src) { setLayout('no song loaded'); return; }
    setLayout('checking...');
    try {
      const r = await win.fetch(src, { headers: { Range: `bytes=0-${LAYOUT_BYTES - 1}` }, credentials: 'same-origin', cache: 'no-store' });
      const reader = r.body.getReader();
      const parts = [];
      let n = 0;
      while (n < LAYOUT_BYTES) {
        const { value, done } = await reader.read();
        if (done) break;
        parts.push(value);
        n += value.length;
      }
      void reader.cancel().catch(() => {});
      const bytes = new Uint8Array(n);
      let at = 0;
      for (const p of parts) { bytes.set(p, at); at += p.length; }
      const d = describeLayout(bytes);
      setLayout(`HTTP ${r.status}, boxes: ${d.boxes.join(' ')}; ${d.verdict}`);
    } catch (err) {
      setLayout(`failed: ${err?.message ?? err}`);
    }
  }

  function setLayout(v) {
    layoutText = v;
    ui.layout.textContent = `file layout: ${v}`;
    ui.layout.hidden = false;
  }

  async function copy() {
    updateResources();
    if (layoutText) core.fact('file layout', layoutText);
    core.fact('audio context now', ctxState());
    const body = core.toText();
    let ok = false;
    try {
      await win.navigator.clipboard.writeText(body);
      ok = true;
    } catch {
      const ta = el('textarea', { value: body, readonly: true });
      ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
      doc.body.append(ta);
      ta.select();
      try { ok = doc.execCommand('copy'); } catch { ok = false; }
      ta.remove();
    }
    ui.copy.textContent = ok ? 'Copied' : 'Copy failed';
    setTimeout(() => { ui.copy.textContent = 'Copy'; }, 1500);
  }

  ui.copy.addEventListener('click', () => { void copy(); });
  ui.layoutBtn.addEventListener('click', () => { void checkLayout(); });
  const paintTap = () => { ui.tapBtn.textContent = storeGet(TAP_KEY) === '0' ? 'Tap off' : 'Tap on'; ui.tapBtn.setAttribute('aria-pressed', String(storeGet(TAP_KEY) !== '0')); };
  ui.tapBtn.addEventListener('click', () => { storeSet(TAP_KEY, storeGet(TAP_KEY) === '0' ? '1' : '0'); paintTap(); });
  paintTap();
  const paintMode = () => { ui.modeBtn.textContent = `Switch: ${switchMode()}`; };
  ui.modeBtn.addEventListener('click', () => { storeSet(SWITCH_KEY, SWITCH_MODES[(SWITCH_MODES.indexOf(switchMode()) + 1) % SWITCH_MODES.length]); paintMode(); });
  paintMode();
  ui.fold.addEventListener('click', () => {
    const on = !panel.classList.contains('lm-collapsed');
    panel.classList.toggle('lm-collapsed', on);
    ui.fold.textContent = on ? '+' : '-';
    ui.fold.setAttribute('aria-label', on ? 'Expand latency meter' : 'Collapse latency meter');
    storeSet(COLLAPSED_KEY, on ? '1' : '0');
  });
  ui.close.addEventListener('click', () => { stop(); onClose(); });

  if (storeGet(COLLAPSED_KEY) === '1') { panel.classList.add('lm-collapsed'); ui.fold.textContent = '+'; ui.fold.setAttribute('aria-label', 'Expand latency meter'); }

  function place(x, y) {
    const w = panel.offsetWidth || 240;
    const h = panel.offsetHeight || 120;
    const left = Math.max(0, Math.min(x, win.innerWidth - w));
    const top = Math.max(0, Math.min(y, win.innerHeight - h));
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
    return { x: left, y: top };
  }

  try {
    const saved = JSON.parse(storeGet(POS_KEY) || 'null');
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) place(saved.x, saved.y);
  } catch { /* default corner */ }

  let grab = null;
  ui.head.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    const r = panel.getBoundingClientRect();
    grab = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    dragging = true;
    ui.head.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  });
  ui.head.addEventListener('pointermove', (e) => { if (grab) place(e.clientX - grab.dx, e.clientY - grab.dy); });
  const drop = (e) => {
    if (!grab) return;
    const p = place(e.clientX - grab.dx, e.clientY - grab.dy);
    storeSet(POS_KEY, JSON.stringify(p));
    grab = null;
    dragging = false;
  };
  ui.head.addEventListener('pointerup', drop);
  ui.head.addEventListener('pointercancel', () => { grab = null; dragging = false; });
  let raiseQueued = false;
  const dialogs = new win.MutationObserver(() => {
    if (raiseQueued) return;
    raiseQueued = true;
    setTimeout(() => { raiseQueued = false; raise(); }, 0);
  });
  dialogs.observe(doc.body, { subtree: true, attributes: true, attributeFilter: ['open'] });
  const onResize = () => { if (panel.style.left) place(parseFloat(panel.style.left), parseFloat(panel.style.top)); };
  win.addEventListener('resize', onResize);

  doc.body.append(panel);
  try {
    panel.showPopover();
  } catch {
    ui.popover = false;
  }
  panel.classList.add('lm-on');
  render(now());

  function stop() {
    stopLoops();
    clearTimeout(resTimer);
    doc.removeEventListener('pointerdown', onDown, true);
    doc.removeEventListener('click', onClick, true);
    doc.removeEventListener('keydown', onKey, true);
    for (const [ev, fn] of audioListeners) audio.removeEventListener(ev, fn);
    audioListeners.length = 0;
    offMark();
    dialogs.disconnect();
    win.removeEventListener('resize', onResize);
    panel.remove();
  }

  return { stop, core, panel };
}

function buildPanel() {
  const head = el('div', { class: 'lm-head' });
  const title = el('span', { class: 'lm-title' }, 'Latency');
  const fold = el('button', { class: 'lm-btn', type: 'button', 'aria-label': 'Collapse latency meter' }, '-');
  const close = el('button', { class: 'lm-btn', type: 'button', 'aria-label': 'Close latency meter' }, 'x');
  head.append(title, fold, close);
  const ms = el('span', { class: 'lm-ms-val' }, '0');
  const sound = el('div', { class: 'lm-sound' }, 'press Play');
  const meta = el('div', { class: 'lm-meta' }, 'method: -');
  const levelNum = el('span', { class: 'lm-level-num' }, '-');
  const levelBar = el('i', {});
  const strip = Array.from({ length: STRIP_LEN }, () => el('i', { class: 'lm-e' }));
  const marks = el('ul', { class: 'lm-marks' });
  const layout = el('div', { class: 'lm-layout', hidden: true });
  const copy = el('button', { class: 'lm-btn lm-act', type: 'button' }, 'Copy');
  const layoutBtn = el('button', { class: 'lm-btn lm-act', type: 'button', title: 'Read the first bytes of the loaded file and report where its moov atom is' }, 'Layout');
  const tapBtn = el('button', { class: 'lm-btn lm-act', type: 'button', title: 'Read the level through the Web Audio analyser (changes how Safari plays the song)' }, 'Tap on');
  const modeBtn = el('button', { class: 'lm-btn lm-act', type: 'button', title: 'How a new song replaces the one that is loaded: auto = end an unfinished download first, always = end it even when complete, off = just set the new source' }, 'Switch: auto');
  const panel = el('div', { class: 'lm', popover: 'manual', role: 'status', 'aria-label': 'Latency meter' },
    head,
    el('div', { class: 'lm-count' }, ms, el('small', {}, ' ms')),
    sound,
    meta,
    el('div', { class: 'lm-more' },
      el('div', { class: 'lm-level' }, el('span', { class: 'lm-bar' }, levelBar), levelNum),
      el('div', { class: 'lm-strip', 'aria-hidden': 'true' }, strip),
      marks,
      layout,
      el('div', { class: 'lm-actions' }, copy, layoutBtn, tapBtn, modeBtn)));
  return { panel, head, fold, close, ms, sound, meta, levelNum, levelBar, strip, marks, layout, copy, layoutBtn, tapBtn, modeBtn, popover: true };
}
