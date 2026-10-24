import { el } from './dom.js';
import { icon } from './icons.js';
import { segmented } from './segmented.js';
import { createMicInput, createPlayerInput, errorKey } from './harmonics-input.js';
import {
  MAX_RUN_MS, DEFAULT_LIVE_MAX, LIVE_RANGES, LIVE_VIEW_NAMES, axisText, axisCaption, liveAxisRange, gramTicks,
  createFeeder, createColors, createAxisControl, createLevelMeter, createLiveWave, createLiveSpectrum, createGramView,
} from './listen-views.js';

export const TITLE = 'Listen';
export const SOURCES = ['mic', 'player'];
export const SOURCE_LABELS = { mic: 'Microphone', player: 'Player' };
export const APP_URL = 'https://electrophone.cc/';
export const PLAYER_NEEDS_APP = 'Player needs the Electrophone app';
export const ENSURE_EVERY_MS = 500;
export const CAPTION = 'Listens in this browser only. Nothing is recorded, uploaded or played back.';
export const LIVE_TEXT = {
  idle: 'Tap Start to listen',
  asking: 'Waiting for microphone permission...',
  listening: 'Listening to the microphone',
  denied: 'Microphone access is off: allow it in the browser settings for this site',
  none: 'No microphone found',
  busy: 'The microphone is in use by another app',
  unsupported: 'This browser cannot use the microphone on this page',
  failed: 'Could not start the microphone',
  hidden: 'Stopped: the page was hidden',
  timeout: 'Stopped: 10 minutes reached',
  ended: 'Stopped: the microphone was disconnected',
  devices: 'Stopped: the audio devices changed',
  nothing: 'Nothing is playing',
  player: 'Listening to the player',
  playerWait: 'Waiting for the player audio...',
  playerFailed: 'This browser cannot analyse the player audio',
};
const CALM = new Set(['idle', 'asking', 'listening', 'nothing', 'player', 'playerWait']);

export function createListenCard(env = {}) {
  const doc = env.document ?? globalThis.document;
  const raf = env.raf ?? ((fn) => globalThis.requestAnimationFrame?.(fn) ?? 0);
  const caf = env.caf ?? ((id) => globalThis.cancelAnimationFrame?.(id));
  const now = env.now ?? (() => globalThis.performance?.now?.() ?? Date.now());
  const sources = (env.sources ?? ['mic']).filter((s) => SOURCES.includes(s));
  const micIn = env.mic ?? createMicInput(env);
  const playerIn = sources.includes('player') ? (env.player ?? createPlayerInput(env)) : null;
  let source = sources[0] ?? 'mic';
  let axis = 'log';
  let liveMax = DEFAULT_LIVE_MAX;
  let running = false;
  let starting = false;
  let paused = false;
  let gone = false;
  let frame = 0;
  let safety = 0;
  let lastTick = 0;
  let ensureAt = 0;
  let playerKey = '';
  let attempt = 0;
  const off = [];

  const uid = `ls-${Math.random().toString(36).slice(2, 7)}`;
  const what = () => (source === 'mic' ? 'the microphone' : 'the player');
  const feed = createFeeder(() => {
    if (!running) return null;
    if (source === 'mic') return { an: micIn.analyser, sr: micIn.sampleRate };
    return playerIn?.playing ? { an: playerIn.analyser, sr: playerIn.sampleRate } : null;
  });
  const colors = createColors(() => node, now);
  const range = () => liveAxisRange(axis, liveMax);
  const axisControl = createAxisControl({ uid, getAxis: () => axis, setAxis, getMax: () => liveMax, setMax: setLiveMax });
  const meter = createLevelMeter({ now, feed });
  const wave = createLiveWave({ uid, colors, feed, what, freq: () => spectrum.peak?.freq ?? 0 });
  const spectrum = createLiveSpectrum({ uid, colors, now, feed, range, axisControl, what });
  const gram = createGramView({ colors, feed, range, ticks: (r, h) => gramTicks([], r, h) });

  const label = el('span', {}, 'Start');
  const toggleIcon = el('span', { class: 'hm-ic' }, icon('mic', 'action'));
  const button = el('button', { class: 'btn primary hm-toggle', type: 'button', onclick: () => { if (running) stop('idle'); else void start(); } }, toggleIcon, label);
  const state = el('p', { class: 'hm-state t-subhead', role: 'status', 'aria-live': 'polite' }, LIVE_TEXT.idle);

  const playerOff = playerIn !== null && playerIn.available === false;
  const sourceSeg = sources.length > 1
    ? segmented(sources.map((s) => [s, SOURCE_LABELS[s]]), () => source, (s) => setSource(s), { 'aria-labelledby': `${uid}-ol` })
    : null;
  if (sourceSeg && playerOff) {
    const btn = sourceSeg.group.children[sources.indexOf('player')];
    btn.disabled = true;
    btn.title = PLAYER_NEEDS_APP;
  }
  const sourceField = sourceSeg
    ? el('div', { class: 'hm-axis' },
      el('span', { id: `${uid}-ol`, class: 'hm-lbl' }, 'Source'),
      sourceSeg.group,
      el('p', { class: 'hm-cap muted t-caption', hidden: !playerOff }, 'Player needs the ', el('a', { href: APP_URL }, 'Electrophone app')))
    : null;

  const node = el('section', { class: 'card hm-card ls-card', 'aria-label': TITLE },
    el('h2', { class: 't-headline' }, TITLE),
    ...(sourceField ? [sourceField] : []),
    el('div', { class: 'hm-play' }, button, state),
    el('p', { class: 'hm-cap muted t-caption' }, CAPTION),
    meter.node,
    wave.node,
    spectrum.node,
    gram.node);

  function describe() {
    const w = what();
    const r = range();
    wave.describe();
    spectrum.describe();
    gram.canvas.setAttribute('aria-label', `Spectrogram of ${w} signal, ${axisText(r)}, last 10 seconds`);
    gram.caption.textContent = `${LIVE_VIEW_NAMES.gram} The last 10 seconds, frequency axis ${axisCaption(r)}. It fills while ${w} is heard and clears when the axis or source changes.`;
  }

  function paintButton() {
    label.textContent = running ? 'Stop' : 'Start';
    button.hidden = source === 'player';
    button.disabled = starting;
    button.classList.toggle('primary', !running);
    button.classList.toggle('outline', running);
    toggleIcon.replaceChildren(icon(running ? 'clear' : 'mic', 'action'));
  }

  function paintOutputs() {
    axisControl.paint();
    sourceSeg?.paint();
    describe();
  }

  function paintStatic() {
    wave.paint();
    spectrum.paint();
    gram.paintAxes();
  }

  function say(key) {
    state.textContent = LIVE_TEXT[key];
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

  function clearViews() {
    gram.restart();
    meter.reset();
    wave.reset();
  }

  function watchPlayer() {
    const t = now();
    const playing = playerIn.playing;
    if (playing && !playerIn.analyser && t - ensureAt >= ENSURE_EVERY_MS) { ensureAt = t; playerIn.ensure(); }
    const live = playing && playerIn.analyser !== null;
    const key = !playing ? 'nothing' : live ? 'player' : playerIn.failed ? 'playerFailed' : 'playerWait';
    if (key !== playerKey) {
      playerKey = key;
      say(key);
      clearViews();
      if (!live) paintStatic();
    }
    return live;
  }

  function tick() {
    if (!running || gone) return;
    frame = raf(tick);
    const t = now();
    const dt = Math.min(0.25, Math.max(0, (t - lastTick) / 1000));
    lastTick = t;
    if (source === 'player' && !watchPlayer()) return;
    wave.paint();
    spectrum.paint();
    meter.update();
    gram.step(dt);
  }

  function stop(key = 'idle') {
    if (!running) return;
    running = false;
    release();
    micIn.stop();
    if (gone) return;
    paintButton();
    say(key);
    clearViews();
    paintStatic();
  }

  function engage(key) {
    running = true;
    lastTick = now();
    clearViews();
    safety = setTimeout(() => stop('timeout'), MAX_RUN_MS);
    listen(doc, 'visibilitychange', () => { if (doc.hidden) stop('hidden'); });
    paintButton();
    say(key);
    frame = raf(tick);
  }

  async function startMic() {
    const mine = attempt;
    starting = true;
    say('asking');
    paintButton();
    try {
      if (!(await micIn.start((key) => stop(key)))) return;
    } catch (ex) {
      if (mine !== attempt || gone) return;
      starting = false;
      say(ex?.name === 'NotSupportedError' ? 'unsupported' : errorKey(ex));
      paintButton();
      return;
    }
    if (mine !== attempt || gone) return;
    starting = false;
    engage('listening');
  }

  function startPlayer() {
    paused = false;
    playerKey = '';
    running = true;
    lastTick = now();
    clearViews();
    listen(doc, 'visibilitychange', () => {
      if (doc.hidden) { paused = true; caf(frame); frame = 0; } else if (paused) { paused = false; lastTick = now(); frame = raf(tick); }
    });
    paintButton();
    playerIn.ensure();
    watchPlayer();
    frame = raf(tick);
  }

  async function start() {
    if (running || starting || gone || source === 'player') return;
    await startMic();
  }

  function refreshAxis() {
    paintOutputs();
    gram.refresh();
    spectrum.paint();
  }

  function setAxis(next) {
    if (next === axis) return;
    axis = next;
    refreshAxis();
  }

  function setLiveMax(next) {
    if (next === liveMax || !LIVE_RANGES.includes(next)) return;
    liveMax = next;
    refreshAxis();
  }

  function setSource(next) {
    if (next === source || !sources.includes(next) || gone) return;
    if (next === 'player' && playerOff) return;
    attempt += 1;
    starting = false;
    if (running) stop('idle');
    micIn.stop();
    source = next;
    paintOutputs();
    paintButton();
    gram.refresh();
    clearViews();
    paintStatic();
    if (source === 'player') startPlayer(); else say('idle');
  }

  let ro = null;
  if (typeof ResizeObserver !== 'undefined') {
    ro = new ResizeObserver(() => {
      if (gone) return;
      gram.paintAxes();
      if (!running) paintStatic();
    });
    ro.observe(node);
  }

  paintOutputs();
  paintButton();
  if (typeof requestAnimationFrame === 'function') raf(() => { if (!gone && !running) paintStatic(); });

  return {
    node,
    meter,
    get running() { return running; },
    get source() { return source; },
    get axis() { return axis; },
    get liveMax() { return liveMax; },
    setAxis,
    setLiveMax,
    setSource,
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
