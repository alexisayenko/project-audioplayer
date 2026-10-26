import { el } from './dom.js';
import { icon } from './icons.js';
import { createMicInput, errorKey } from './harmonics-input.js';
import { createMicBpm, PUBLISH_MS } from './mic-bpm.js';
import { liveBpmLabel, LIVE_IDLE } from './bpm-label.js';
import { MAX_RUN_MS, GRID_NOTE, createFeeder, createColors, createBandsView } from './listen-views.js';
import { createBpmWindowsView } from './bpm-windows.js';

export const TITLE = 'Rhythm';
export const IDLE_VALUE = LIVE_IDLE;
export const CAPTION = 'Listens in this browser only. Nothing is recorded or uploaded. Works best when the music plays from a speaker.';
export const TEXT = {
  idle: 'Tap Start to listen',
  asking: 'Waiting for microphone permission...',
  listening: 'Listening...',
  denied: 'Microphone access is off: allow it in the browser settings for this site',
  none: 'No microphone found',
  busy: 'The microphone is in use by another app',
  unsupported: 'This browser cannot use the microphone on this page',
  failed: 'Could not start the microphone',
  hidden: 'Stopped: the page was hidden',
  timeout: 'Stopped: 10 minutes reached',
  ended: 'Stopped: the microphone was disconnected',
  devices: 'Stopped: the audio devices changed',
};
const CALM = new Set(['idle', 'asking', 'listening']);
export const WINDOWS_MS = 1000;

export function createRhythmCard(env = {}) {
  const doc = env.document ?? globalThis.document;
  const raf = env.raf ?? ((fn) => globalThis.requestAnimationFrame?.(fn) ?? 0);
  const caf = env.caf ?? ((id) => globalThis.cancelAnimationFrame?.(id));
  const now = env.now ?? (() => globalThis.performance?.now?.() ?? Date.now());
  const bpm = (env.createBpm ?? (() => createMicBpm({ windows: true })))();
  const micIn = env.mic ?? createMicInput({ ...env, onSamples: (samples, sampleRate) => bpm.push(samples, sampleRate) });
  let running = false;
  let starting = false;
  let gone = false;
  let frame = 0;
  let safety = 0;
  let publishAt = 0;
  let windowsAt = 0;
  let attempt = 0;
  const off = [];

  const uid = `rh-${Math.random().toString(36).slice(2, 7)}`;
  const feed = createFeeder(() => (running ? { an: micIn.analyser, sr: micIn.sampleRate } : null));
  const colors = createColors(() => node, now);
  const bands = createBandsView({ uid, colors, feed, note: GRID_NOTE });
  const windows = createBpmWindowsView({ uid, colors, now });

  const value = el('span', { class: 'mt-value' }, IDLE_VALUE);
  const badge = el('span', { class: 'bpm-badge mt-bpm', role: 'img', title: 'Beats per minute (estimated)', 'aria-label': 'BPM not detected' }, value, ' ', el('small', { 'aria-hidden': 'true' }, 'BPM'));
  const label = el('span', {}, 'Start');
  const toggleIcon = el('span', { class: 'hm-ic' }, icon('mic', 'action'));
  const button = el('button', { class: 'btn primary mt-toggle', type: 'button', onclick: () => { if (running) stop('idle'); else void start(); } }, toggleIcon, label);
  const state = el('p', { class: 'mt-state t-subhead', role: 'status', 'aria-live': 'polite' }, TEXT.idle);
  const dLevel = el('p', { class: 'mt-detail' });
  const dWindow = el('p', { class: 'mt-detail' });
  const dList = el('ol', { class: 'mt-candidates' });
  const details = el('details', { class: 'mt-details' },
    el('summary', {}, 'Details'),
    dLevel, dWindow,
    el('p', { class: 'mt-detail' }, 'Top candidates (score 0 to 1):'),
    dList);
  const node = el('section', { class: 'card mt-card rh-card', 'aria-label': TITLE },
    el('h2', { class: 't-headline' }, TITLE),
    el('p', { class: 'mt-caption muted t-caption' }, CAPTION),
    el('div', { class: 'mt-row' }, badge, button),
    details,
    state,
    windows.node,
    bands.node);

  function paintBpm(exact) {
    const text = exact == null ? '' : liveBpmLabel(exact);
    value.textContent = text || IDLE_VALUE;
    badge.setAttribute('aria-label', text ? `BPM ${text}` : 'BPM not detected');
  }

  function paintDetails(info) {
    const db = info?.levelDb;
    dLevel.textContent = `Level: ${Number.isFinite(db) ? db.toFixed(1) : '-'} dBFS`;
    dWindow.textContent = `Window: ${info?.windowS ? info.windowS.toFixed(1) : '-'} s`;
    const rows = (info?.candidates ?? []).map((c) => el('li', {}, `${Math.round(c.bpm)} BPM (${c.score.toFixed(2)})`));
    dList.replaceChildren(...(rows.length ? rows : [el('li', {}, 'none')]));
  }

  function refreshDetails() {
    if (details.open) paintDetails(running ? bpm.details?.() : null);
  }

  function paintButton() {
    label.textContent = running ? 'Stop' : 'Start';
    button.disabled = starting;
    button.classList.toggle('primary', !running);
    button.classList.toggle('outline', running);
    toggleIcon.replaceChildren(icon(running ? 'clear' : 'mic', 'action'));
  }

  function say(key) {
    state.textContent = TEXT[key];
    state.classList.toggle('error', !CALM.has(key));
  }

  function listen(target, type, fn) {
    target?.addEventListener?.(type, fn);
    off.push(() => target?.removeEventListener?.(type, fn));
  }

  function release() {
    clearTimeout(safety);
    caf(frame);
    frame = 0;
    while (off.length) off.pop()();
  }

  function publish(t) {
    bpm.value();
    const exact = bpm.exact;
    paintBpm(exact);
    bands.setTempo(exact);
    refreshDetails();
    if (t - windowsAt >= WINDOWS_MS) {
      windowsAt = t;
      windows.update(t, exact, bpm.windows?.() ?? []);
    }
  }

  function clearViews() {
    bpm.reset();
    paintBpm(null);
    bands.reset();
    bands.setTempo(null);
    windows.clearReadouts();
  }

  function tick() {
    if (!running || gone) return;
    frame = raf(tick);
    const t = now();
    if (t - publishAt >= PUBLISH_MS) { publishAt = t; publish(t); }
    bands.step(t);
  }

  function stop(key = 'idle') {
    if (!running) return;
    running = false;
    release();
    micIn.stop();
    if (gone) return;
    clearViews();
    bands.paint();
    refreshDetails();
    paintButton();
    say(key);
  }

  function engage() {
    running = true;
    publishAt = now();
    windowsAt = publishAt;
    clearViews();
    windows.reset();
    safety = setTimeout(() => stop('timeout'), MAX_RUN_MS);
    listen(doc, 'visibilitychange', () => { if (doc.hidden) stop('hidden'); });
    paintButton();
    say('listening');
    frame = raf(tick);
  }

  async function start() {
    if (running || starting || gone) return;
    const mine = attempt;
    starting = true;
    say('asking');
    paintButton();
    let opened = false;
    try {
      opened = await micIn.start((key) => stop(key));
    } catch (ex) {
      if (mine !== attempt || gone) return;
      starting = false;
      say(ex?.name === 'NotSupportedError' ? 'unsupported' : errorKey(ex));
      paintButton();
      return;
    }
    if (mine !== attempt || gone) return;
    starting = false;
    if (!opened) {
      say('idle');
      paintButton();
      return;
    }
    engage();
  }

  bands.describe('the microphone signal');
  paintDetails(null);
  details.addEventListener('toggle', refreshDetails);

  let ro = null;
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => {
      if (gone) return;
      windows.paint();
      if (!running) bands.paint();
    });
    ro.observe(node);
  }
  if (typeof requestAnimationFrame === 'function') raf(() => {
    if (!gone && !running) bands.paint();
    if (!gone) windows.paint();
  });

  return {
    node,
    bands,
    windows,
    bpm,
    get running() { return running; },
    start,
    stop: () => stop('idle'),
    dispose() {
      gone = true;
      attempt += 1;
      ro?.disconnect();
      if (running) { running = false; release(); }
      micIn.stop();
    },
  };
}
