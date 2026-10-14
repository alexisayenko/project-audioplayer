import * as audioGraph from './audio-graph.js';
import { createViz } from './viz-canvas.js';
import { createFullscreen, isVizKey, isVizModeKey } from './viz-fullscreen.js';
import { createModeSwitch } from './viz-switch.js';
import { availableModes, nextMode, modeLabel } from './viz-modes.js';
import {
  vizBackgroundOn, onVizBackground, vizCaps, vizMode, setVizMode, onVizMode, vizHeightScale, onVizHeight,
} from './viz-settings.js';
import { attachScrubber } from './scrubber.js';
import { titleNodes } from './display-title.js';
import { $, setIcon } from './player-ui.js';

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
    getDiag: () => ({ audio, graphState: graph.getState?.(), ctxState: graph.getContext?.()?.state }),
    ...extra,
  };
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

export function initVisualizer({
  player, audio = $('audio'), graph = audioGraph, win = globalThis, deps = {}, caps = vizCaps(),
}) {
  const supported = graph.isSupported(win);
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

  const bgViz = createViz({ canvas: $('viz-bg'), mode: 'background', deps: vizDeps(audio, graph, { getAnchor: coverAnchor, ...deps }) });
  const fullViz = createViz({ canvas: $('viz-full-canvas'), mode: 'full', deps: vizDeps(audio, graph, deps) });
  const refreshAll = () => { bgViz.refresh(); fullViz.refresh(); };
  const modes = availableModes(caps);
  let currentMode = vizMode(() => caps);
  const live = $('viz-live');
  const switches = [];
  const applyMode = (id, announce) => {
    currentMode = id;
    bgViz.setVizMode(id);
    fullViz.setVizMode(id);
    for (const sw of switches) sw.set(id);
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
  const syncSwitchVisibility = () => { $('p-viz-switch').hidden = modes.length < 2 || !(supported && vizBackgroundOn()); };

  function enableGraph() {
    if (!supported) return;
    void graph.resume();
    void graph.enable(audio, { win }).then(refreshAll);
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
      paintMeta(player.current);
      paintPlayButton(audio);
      scrubber.sync();
      fullViz.setEnabled(true);
      syncBackground();
    },
    onClose() {
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

  for (const type of ['play', 'pause', 'ended', 'emptied']) {
    audio.addEventListener(type, () => { paintPlayButton(audio); refreshAll(); });
  }
  audio.addEventListener('play', () => { void graph.resume(); });
  audio.addEventListener('loadstart', () => paintMeta(player.current));
  for (const type of ['timeupdate', 'durationchange']) audio.addEventListener(type, () => scrubber.sync());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void graph.resume(); });

  onVizBackground((on) => { syncBackground(); if (on) enableGraph(); });
  syncBackground();
  if (supported && vizBackgroundOn()) {
    const arm = () => {
      document.removeEventListener('pointerdown', arm);
      document.removeEventListener('keydown', arm);
      enableGraph();
    };
    document.addEventListener('pointerdown', arm);
    document.addEventListener('keydown', arm);
  }
  return { full, bgViz, fullViz, syncBackground };
}
