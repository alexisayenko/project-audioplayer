import * as audioGraph from './audio-graph.js';
import { createViz } from './viz-canvas.js';
import { api } from './api.js';
import { createLookahead } from './viz-lookahead.js';
import { barCount } from './viz-spectrum.js';
import { createFullscreen, isNearBox, isVizKey, isVizModeKey, isVizStyleKey, isVizFlightKey } from './viz-fullscreen.js';
import { createStylePanel } from './viz-panel.js';
import { createModeSwitch } from './viz-switch.js';
import { initOverlayPlayControls } from './viz-playctl.js';
import { availableModes, nextMode, modeLabel } from './viz-modes.js';
import {
  vizParts, setVizParts, onVizParts, vizCaps, vizMode, setVizMode, onVizMode, vizHeightScale, onVizHeight,
} from './viz-settings.js';
import { attachScrubber } from './scrubber.js';
import { titleNodes, artistLine } from './credits.js';
import { $, setIcon } from './player-ui.js';
import { createCamPanel, loadCam } from './viz-cam-debug.js';
import { outputLatencyS } from './viz-latency.js';
import { flightOn, flightReduced, setFlightOn, initFlight } from './viz-flight.js';
import { storeRemove } from './storage.js';
import { BG_STORAGE_KEY } from './viz-constants.js';
import { getStyle, setStyle, nextStyle, styleLabel } from './viz-terrain-style.js';

const REDUCED = '(prefers-reduced-motion: reduce)';
const NO_AUDIO_TIP = 'Visualizer needs Web Audio, which this browser does not offer';
const REDUCED_TIP = 'Reduced motion is on';

function vizDeps(audio, graph, extra) {
  return {
    getAnalyser: () => graph.getAnalyser(),
    isPlaying: () => !audio.paused && !audio.ended,
    getOutputLatency: () => outputLatencyS(graph.getContext?.()),
    getDiag: () => ({ audio, graphState: graph.getState?.(), ctxState: graph.getContext?.()?.state }),
    onNotice: (text) => { const el = document.getElementById('viz-live'); if (el) el.textContent = text; },
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
  setIcon('viz-play', playing ? 'pause' : 'play', 'play');
  $('viz-play').setAttribute('aria-label', playing ? 'Pause' : 'Play');
}

function paintMeta(song) {
  $('viz-title').replaceChildren(...(song ? titleNodes(song) : ['Nothing playing']));
  $('viz-artist').textContent = song ? artistLine(song) : '';
}

const CORNER_PAD = 48;
const KEEP_AREA = '.viz-dock, .viz-ctl';
const KEEP_FOCUS = 'select, input, [role="slider"], [role="switch"]';

function makeKeepAwake(root, dock, ctl) {
  let over = false;
  let dragging = false;
  root.addEventListener('pointerover', (e) => { over = !!e.target?.closest?.(KEEP_AREA); });
  root.addEventListener('pointerleave', () => { over = false; });
  root.addEventListener('pointerdown', (e) => { if (e.target?.closest?.(KEEP_AREA)) dragging = true; });
  for (const ev of ['pointerup', 'pointercancel']) document.addEventListener(ev, () => { dragging = false; });
  return () => {
    const a = document.activeElement;
    const focused = !!a && (dock.contains(a) || (ctl.contains(a) && a.matches?.(KEEP_FOCUS)));
    return over || dragging || focused;
  };
}

function bindOverlayActivity(root, full, { onCanvasClick }) {
  const corner = $('viz-corner');
  const setNear = (v) => corner.classList.toggle('near', v);
  root.addEventListener('pointerdown', () => full.poke());
  root.addEventListener('pointermove', (e) => {
    full.poke();
    if (e.pointerType && e.pointerType !== 'mouse') return;
    setNear(isNearBox({ x: e.clientX, y: e.clientY }, corner.getBoundingClientRect(), CORNER_PAD));
  });
  root.addEventListener('pointerleave', () => setNear(false));
  root.addEventListener('keydown', () => full.poke());
  root.addEventListener('focusin', () => full.poke());
  root.addEventListener('click', (e) => {
    if (e.target?.classList?.contains('viz-canvas')) onCanvasClick();
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
  const dock = document.createElement('div');
  dock.className = 'viz-dock';
  dock.dataset.theme = 'dark';
  $('viz-full').dataset.theme = 'dark';
  $('viz-corner').classList.add('t-micro');
  document.body.append(dock);
  const button = $('p-viz');
  const reducedMql = win.matchMedia?.(REDUCED) ?? null;
  setIcon('p-viz', 'equalizer', 'nav');
  setIcon('viz-prev', 'prev', 'nav');
  setIcon('viz-next', 'next', 'nav');
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
    getBands: () => barCount($('viz-full-canvas').clientWidth || win.innerWidth || 1200),
    getNextSrc: () => { const id = player?.peekNextId?.(); return id ? new URL(api.fileUrl(id), win.location?.href).href : ''; },
  });
  const noticeOf = (text, info) => {
    const el = document.getElementById('viz-live');
    if (el) el.textContent = text;
    if (info?.label && info.mode === currentMode) {
      fallbackNote = info.label;
      for (const sw of switches) sw.setNote(fallbackNote);
    }
  };
  const fullViz = createViz({ canvas: $('viz-full-canvas'), mode: 'full', deps: vizDeps(audio, graph, { lookahead, onNotice: noticeOf, ...deps }) });
  const refreshAll = () => { fullViz.refresh(); };
  graph.onState?.(refreshAll);
  const modes = availableModes(caps);
  let currentMode = vizMode(() => caps);
  const live = $('viz-live');
  const switches = [];
  let fallbackNote = '';
  const applyMode = (id, announce) => {
    currentMode = id;
    fullViz.setVizMode(id);
    for (const sw of switches) sw.set(id);
    fallbackNote = '';
    syncSwitchVisibility();
    if (announce && live) live.textContent = `Visualizer: ${modeLabel(id)}`;
  };
  const pickFromSwitch = (id) => { setVizMode(id); };
  const toggleFull = () => { if (supported) full.toggle(); };
  switches.push(createModeSwitch({ root: $('viz-switch'), modes, current: currentMode, onSelect: pickFromSwitch }));
  onVizMode((id) => { if (id !== currentMode) applyMode(id, true); });
  fullViz.setHeightScale(vizHeightScale());
  onVizHeight((s) => { fullViz.setHeightScale(s); });
  fullViz.setVizMode(currentMode);
  const syncSwitchVisibility = () => {
    syncDock();
  };
  const partsState = vizParts();
  fullViz.setParts(partsState);
  const stylePanel = createStylePanel({
    mode: currentMode,
    width: win.innerWidth ?? 1200,
    parts: {
      state: partsState,
      onChange: setVizParts,
      onRefuse: (row, part) => { if (live) live.textContent = `At least one ${row === 'freq' ? 'frequency' : 'behaviour'} part must stay on: ${part.label} kept on`; },
    },
  });
  dock.append(...(camPanel ? [camPanel.el] : []), stylePanel.el);
  onVizParts((s) => {
    fullViz.setParts(s);
    stylePanel.setParts(s);
  });
  let settingsOpen = false;
  const syncDock = () => {
    const inFull = full?.isOpen?.() ?? false;
    stylePanel.setMode(currentMode);
    stylePanel.el.hidden = stylePanel.isEmpty();
    dock.hidden = !(supported && inFull && settingsOpen) || (stylePanel.el.hidden && !camPanel);
  };

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
    keep: makeKeepAwake($('viz-full'), dock, $('viz-ctl')),
    opener: button,
    onOpen() {
      enableGraph();
      placeStatus(true);
      $('viz-full').append(dock);
      dock.style.setProperty('--viz-ctl-h', `${$('viz-ctl').offsetHeight || 112}px`);
      paintMeta(player.current);
      paintPlayButton(audio);
      scrubber.sync();
      fullViz.setEnabled(true);
      miniViz.setAttribute('aria-pressed', 'true');
      syncSwitchVisibility();
    },
    onIdle() { for (const sw of switches) sw.close(); },
    onClose() {
      for (const sw of switches) sw.close();
      placeStatus(false);
      document.body.append(dock);
      fullViz.setEnabled(false);
      miniViz.setAttribute('aria-pressed', 'false');
      if (openedFromMini) { openedFromMini = false; miniViz.focus?.(); }
      syncSwitchVisibility();
    },
  });

  button.addEventListener('click', toggleFull);
  const miniViz = $('mini-viz');
  setIcon('mini-viz', 'equalizer', 'action');
  if (!supported) { miniViz.disabled = true; miniViz.title = NO_AUDIO_TIP; }
  let openedFromMini = false;
  miniViz.addEventListener('click', () => { openedFromMini = true; toggleFull(); });
  const gear = $('viz-settings');
  setIcon('viz-settings', 'settings', 'nav');
  gear.addEventListener('click', () => {
    settingsOpen = !settingsOpen;
    gear.setAttribute('aria-pressed', String(settingsOpen));
    syncDock();
  });
  $('viz-play').addEventListener('click', () => player.toggle());
  $('viz-prev').addEventListener('click', () => player.prev());
  $('viz-next').addEventListener('click', () => player.next());
  setIcon('viz-close', 'clear', 'nav');
  $('viz-close').addEventListener('click', () => full.close());
  const flash = $('viz-flash');
  bindOverlayActivity($('viz-full'), full, {
    onCanvasClick() {
      const willPlay = audio.paused;
      player.toggle();
      setIcon('viz-flash', willPlay ? 'play' : 'pause', 64);
      flash.classList.remove('go');
      void flash.offsetWidth;
      flash.classList.add('go');
      if (live) live.textContent = willPlay ? 'Playing' : 'Paused';
    },
  });
  initOverlayPlayControls({ player, audio, root: $('viz-full'), live, isOpen: () => full.isOpen() });

  document.addEventListener('keydown', (e) => {
    if (!supported || !isVizKey(e, { open: full.isOpen(), route: document.body.dataset.route })) return;
    e.preventDefault();
    full.toggle();
  });

  document.addEventListener('keydown', (e) => {
    if (!supported || modes.length < 2) return;
    if (!isVizModeKey(e, { open: full.isOpen(), route: document.body.dataset.route })) return;
    e.preventDefault();
    setVizMode(nextMode(currentMode, caps));
  });

  document.addEventListener('keydown', (e) => {
    if (!supported) return;
    if (!isVizStyleKey(e, { open: full.isOpen(), route: document.body.dataset.route, mode: currentMode })) return;
    e.preventDefault();
    const next = setStyle(nextStyle(getStyle()));
    if (live) live.textContent = `Terrain style: ${styleLabel(next)}`;
  });

  initFlight();
  document.addEventListener('keydown', (e) => {
    if (!supported) return;
    if (!isVizFlightKey(e, { open: full.isOpen(), route: document.body.dataset.route, mode: currentMode })) return;
    e.preventDefault();
    const on = flightReduced() ? false : setFlightOn(!flightOn());
    if (live) live.textContent = flightReduced() ? 'Camera flight is off: reduced motion is on' : `Camera flight ${on ? 'on' : 'off'}`;
  });

  for (const type of ['play', 'pause', 'ended', 'emptied']) {
    audio.addEventListener(type, () => { paintPlayButton(audio); refreshAll(); });
  }
  audio.addEventListener('play', () => { void graph.resume(); });
  audio.addEventListener('loadstart', () => paintMeta(player.current));
  for (const type of ['timeupdate', 'durationchange']) audio.addEventListener(type, () => scrubber.sync());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void graph.resume(); });

  try { storeRemove(BG_STORAGE_KEY); } catch { /* storage unavailable */ }
  syncSwitchVisibility();
  armGestureUnlock({ supported, graph, wanted: () => full.isOpen(), unlock: enableGraph });
  return { full, fullViz, openFull: toggleFull, syncBackground: syncSwitchVisibility };
}
