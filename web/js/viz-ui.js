import * as audioGraph from './audio-graph.js';
import { createViz } from './viz-canvas.js';
import { createLookahead } from './viz-lookahead.js';
import { barCount } from './viz-spectrum.js';
import { createFullscreen, isVizKey, isVizModeKey, isVizStyleKey } from './viz-fullscreen.js';
import { createPartsToggles } from './viz-parts-ui.js';
import { createModeSwitch } from './viz-switch.js';
import { initOverlayPlayControls } from './viz-playctl.js';
import { availableModes, nextMode, modeLabel } from './viz-modes.js';
import {
  vizParts, setVizParts, onVizParts, vizBackgroundOn, onVizBackground, vizCaps, vizMode, setVizMode, onVizMode, vizHeightScale, onVizHeight,
} from './viz-settings.js';
import { attachScrubber } from './scrubber.js';
import { titleNodes } from './display-title.js';
import { $, setIcon } from './player-ui.js';
import { createCamPanel, loadCam } from './viz-cam-debug.js';
import { outputLatencyS } from './viz-latency.js';
import { getStyle, setStyle, nextStyle, styleLabel } from './viz-terrain-style.js';

const REDUCED = '(prefers-reduced-motion: reduce)';
const NO_AUDIO_TIP = 'Visualizer needs Web Audio, which this browser does not offer';
const REDUCED_TIP = 'Reduced motion is on';

function coverAnchor() {
  const cover = $('cover-art').getBoundingClientRect();
  const canvas = $('viz-bg').getBoundingClientRect();
  if (!(cover.width > 0)) return null;
  return {
    x: cover.left - canvas.left + cover.width / 2,
    y: cover.top - canvas.top + cover.height / 2,
    r: Math.min(cover.width, cover.height) * 0.36,
  };
}

function vizDeps(audio, graph, extra) {
  return {
    getAnalyser: () => graph.getAnalyser(),
    isPlaying: () => !audio.paused && !audio.ended,
    getOutputLatency: () => outputLatencyS(graph.getContext?.()),
    getDiag: () => ({ audio, graphState: graph.getState?.(), ctxState: graph.getContext?.()?.state }),
    ...extra,
  };
}

function placeStatus(inFull) {
  const el = document.getElementById('viz-status');
  if (!el?.style) return;
  (inFull ? $('viz-full') : document.body).append(el);
  el.style.top = inFull ? '24px' : '';
  el.style.bottom = inFull ? 'auto' : '8px';
}

function paintPlayButton(audio) {
  const playing = !audio.paused;
  setIcon('viz-play', playing ? 'pause' : 'play', 24);
  $('viz-play').setAttribute('aria-label', playing ? 'Pause' : 'Play');
}

function paintMeta(song) {
  $('viz-title').replaceChildren(...(song ? titleNodes(song) : ['Nothing playing']));
  $('viz-artist').textContent = song?.artist || '';
}

function bindOverlayActivity(root, full) {
  let wasIdle = false;
  root.addEventListener('pointerdown', () => { wasIdle = full.idle; full.poke(); });
  root.addEventListener('pointermove', () => full.poke());
  root.addEventListener('keydown', () => full.poke());
  root.addEventListener('focusin', () => full.poke());
  root.addEventListener('click', (e) => {
    if (!e.target?.classList?.contains('viz-canvas')) return;
    if (!wasIdle) full.close();
    wasIdle = false;
  });
}

const GESTURES = ['pointerdown', 'pointerup', 'touchend', 'mousedown', 'click', 'keydown'];

function armGestureUnlock({ supported, graph, wanted, unlock }) {
  if (!supported) return;
  const run = () => { if (wanted()) unlock(); };
  const arm = () => { for (const t of GESTURES) document.addEventListener(t, run, true); };
  const disarm = () => { for (const t of GESTURES) document.removeEventListener(t, run, true); };
  graph.onState?.((s) => { if (s === 'running') disarm(); else arm(); });
  arm();
}

export function initVisualizer({
  player, audio = $('audio'), graph = audioGraph, win = globalThis, deps = {}, caps = vizCaps(),
}) {
  const supported = graph.isSupported(win);
  const camPanel = /[#?&]vizdebug=1\b/.test(`${win.location?.search ?? ''}${win.location?.hash ?? ''}`)
    ? (loadCam(), createCamPanel(document))
    : null;
  if (camPanel) document.body.append(camPanel.el);
  const button = $('p-viz');
  const reducedMql = win.matchMedia?.(REDUCED) ?? null;
  setIcon('p-viz', 'equalizer', 20);
  setIcon('viz-prev', 'prev', 22);
  setIcon('viz-next', 'next', 22);
  setIcon('viz-close', 'clear', 22);
  if (!supported) {
    button.disabled = true;
    button.title = NO_AUDIO_TIP;
  } else if (reducedMql?.matches) {
    button.title = REDUCED_TIP;
  }

  const lookahead = deps.lookahead ?? createLookahead({
    audio,
    win,
    getSampleRate: () => graph.getContext?.()?.sampleRate || 44100,
    getBands: () => barCount($('viz-bg').clientWidth || win.innerWidth || 1200),
  });
  const bgViz = createViz({ canvas: $('viz-bg'), mode: 'background', deps: vizDeps(audio, graph, { getAnchor: coverAnchor, lookahead, ...deps }) });
  const fullViz = createViz({ canvas: $('viz-full-canvas'), mode: 'full', deps: vizDeps(audio, graph, { lookahead, ...deps }) });
  const refreshAll = () => { bgViz.refresh(); fullViz.refresh(); };
  graph.onState?.(refreshAll);
  const modes = availableModes(caps);
  let currentMode = vizMode(() => caps);
  const live = $('viz-live');
  const switches = [];
  const applyMode = (id, announce) => {
    currentMode = id;
    bgViz.setVizMode(id);
    fullViz.setVizMode(id);
    for (const sw of switches) sw.set(id);
    syncSwitchVisibility();
    if (announce && live) live.textContent = `Visualizer: ${modeLabel(id)}`;
  };
  const pickFromSwitch = (id) => { setVizMode(id); };
  for (const id of ['p-viz-switch', 'viz-switch']) {
    switches.push(createModeSwitch({ root: $(id), modes, current: currentMode, onSelect: pickFromSwitch }));
  }
  onVizMode((id) => { if (id !== currentMode) applyMode(id, true); });
  const heightOf = vizHeightScale;
  bgViz.setHeightScale(heightOf());
  fullViz.setHeightScale(heightOf());
  onVizHeight((s) => { bgViz.setHeightScale(s); fullViz.setHeightScale(s); });
  bgViz.setVizMode(currentMode);
  fullViz.setVizMode(currentMode);
  const syncSwitchVisibility = () => {
    $('p-viz-switch').hidden = modes.length < 2 || !(supported && vizBackgroundOn());
    $('p-viz-parts').hidden = !(supported && vizBackgroundOn() && currentMode === 'bars');
    $('viz-parts').hidden = currentMode !== 'bars';
  };
  const partsState = vizParts();
  bgViz.setParts(partsState);
  fullViz.setParts(partsState);
  const toggles = ['p-viz-parts', 'viz-parts'].map((id) => createPartsToggles({
    root: $(id),
    state: partsState,
    onChange: setVizParts,
    onRefuse: (row, part) => { if (live) live.textContent = `At least one ${row === 'freq' ? 'frequency' : 'behaviour'} part must stay on: ${part.label} kept on`; },
  }));
  onVizParts((s) => {
    bgViz.setParts(s);
    fullViz.setParts(s);
    for (const t of toggles) t.set(s);
  });

  function enableGraph() {
    if (!supported) return;
    graph.unlock(audio, { win });
    refreshAll();
  }

  const scrubber = attachScrubber($('viz-scrub'), {
    duration: () => audio.duration,
    time: () => audio.currentTime,
    onSeek: (t) => player.seek(t),
  });

  const full = createFullscreen({
    root: $('viz-full'),
    opener: button,
    onOpen() {
      enableGraph();
      placeStatus(true);
      if (camPanel) $('viz-full').append(camPanel.el);
      paintMeta(player.current);
      paintPlayButton(audio);
      scrubber.sync();
      fullViz.setEnabled(true);
      syncBackground();
    },
    onClose() {
      placeStatus(false);
      if (camPanel) document.body.append(camPanel.el);
      fullViz.setEnabled(false);
      syncBackground();
    },
  });

  function syncBackground() {
    const on = supported && vizBackgroundOn();
    $('viz-bg-layer').classList.toggle('on', on);
    bgViz.setEnabled(on && !full.isOpen());
    syncSwitchVisibility();
  }

  button.addEventListener('click', () => { if (supported) full.toggle(); });
  $('viz-close').addEventListener('click', () => full.close());
  $('viz-play').addEventListener('click', () => player.toggle());
  $('viz-prev').addEventListener('click', () => player.prev());
  $('viz-next').addEventListener('click', () => player.next());
  bindOverlayActivity($('viz-full'), full);
  initOverlayPlayControls({ player, audio, root: $('viz-full'), live, isOpen: () => full.isOpen() });

  document.addEventListener('keydown', (e) => {
    if (!supported || !isVizKey(e, { open: full.isOpen(), route: document.body.dataset.route })) return;
    e.preventDefault();
    full.toggle();
  });

  document.addEventListener('keydown', (e) => {
    if (!supported || modes.length < 2) return;
    if (!isVizModeKey(e, { open: full.isOpen(), route: document.body.dataset.route, background: vizBackgroundOn() })) return;
    e.preventDefault();
    setVizMode(nextMode(currentMode, caps));
  });

  document.addEventListener('keydown', (e) => {
    if (!supported) return;
    if (!isVizStyleKey(e, { open: full.isOpen(), route: document.body.dataset.route, background: vizBackgroundOn(), mode: currentMode })) return;
    e.preventDefault();
    const next = setStyle(nextStyle(getStyle()));
    if (live) live.textContent = `Terrain style: ${styleLabel(next)}`;
  });

  for (const type of ['play', 'pause', 'ended', 'emptied']) {
    audio.addEventListener(type, () => { paintPlayButton(audio); refreshAll(); });
  }
  audio.addEventListener('play', () => { void graph.resume(); });
  audio.addEventListener('loadstart', () => paintMeta(player.current));
  for (const type of ['timeupdate', 'durationchange']) audio.addEventListener(type, () => scrubber.sync());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void graph.resume(); });

  onVizBackground((on) => { syncBackground(); if (on) enableGraph(); });
  syncBackground();
  armGestureUnlock({ supported, graph, wanted: () => vizBackgroundOn() || full.isOpen(), unlock: enableGraph });
  return { full, bgViz, fullViz, syncBackground };
}
