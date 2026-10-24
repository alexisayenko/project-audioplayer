import { el } from './dom.js';
import { icon } from './icons.js';
import { createMicBpm, rmsOf, levelFraction, MAX_RUN_MS, PUBLISH_MS, METER_MS } from './mic-bpm.js';

export const TITLE = 'Live BPM (microphone)';
export const CAPTION_STANDALONE = 'Listens in this browser only. Nothing is recorded or uploaded. Works best when the music plays from a speaker.';
export const CAPTION = `${CAPTION_STANDALONE} The player and this tool can run together.`;
export const IDLE_VALUE = '- - -';
export const CONSTRAINTS = { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } };
export const DEVICE_GRACE_MS = 1500;
const METER_FALL = 0.06;
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

export function errorKey(ex) {
  const name = ex?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') return 'denied';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') return 'none';
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') return 'busy';
  return 'failed';
}

export function createMicCard(env = {}) {
  const nav = env.navigator ?? globalThis.navigator;
  const Ctx = env.AudioContext ?? globalThis.AudioContext ?? globalThis.webkitAudioContext;
  const doc = env.document ?? globalThis.document;
  const create = env.createBpm ?? createMicBpm;
  let run = null;
  let starting = false;
  let gone = false;

  const value = el('span', { class: 'mt-value' }, IDLE_VALUE);
  const badge = el('span', { class: 'bpm-badge mt-bpm', role: 'img', title: 'Beats per minute (estimated)', 'aria-label': 'BPM not detected' }, value, ' ', el('small', { 'aria-hidden': 'true' }, 'BPM'));
  const label = el('span', {}, 'Start');
  const button = el('button', { class: 'btn primary mt-toggle', type: 'button', onclick: () => { if (run) stop('idle'); else void start(); } }, icon('mic', 'action'), label);
  const bar = el('div', { class: 'mt-meter-bar' });
  const meter = el('div', { class: 'mt-meter', role: 'meter', 'aria-label': 'Microphone level', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': '0' }, bar);
  const state = el('p', { class: 'mt-state t-subhead', role: 'status', 'aria-live': 'polite' }, TEXT.idle);
  const dLevel = el('p', { class: 'mt-detail' });
  const dWindow = el('p', { class: 'mt-detail' });
  const dList = el('ol', { class: 'mt-candidates' });
  const details = el('details', { class: 'mt-details' },
    el('summary', {}, 'Details'),
    dLevel, dWindow,
    el('p', { class: 'mt-detail' }, 'Top candidates (score 0 to 1):'),
    dList);
  const node = el('section', { class: 'card mt-card', 'aria-label': TITLE },
    el('h2', { class: 't-headline' }, TITLE),
    el('div', { class: 'mt-row' }, badge, button),
    details,
    meter, state,
    el('p', { class: 'mt-caption muted t-caption' }, env.standalone ? CAPTION_STANDALONE : CAPTION));

  function paintBpm(bpm) {
    value.textContent = bpm == null ? IDLE_VALUE : String(bpm);
    badge.setAttribute('aria-label', bpm == null ? 'BPM not detected' : `BPM ${bpm}`);
  }

  function paintDetails(info) {
    const db = info?.levelDb;
    dLevel.textContent = `Level: ${Number.isFinite(db) ? db.toFixed(1) : '-'} dBFS`;
    dWindow.textContent = `Window: ${info?.windowS ? info.windowS.toFixed(1) : '-'} s`;
    const rows = (info?.candidates ?? []).map((c) => el('li', {}, `${Math.round(c.bpm)} BPM (${c.score.toFixed(2)})`));
    dList.replaceChildren(...(rows.length ? rows : [el('li', {}, 'none')]));
  }

  function refreshDetails() {
    if (details.open) paintDetails(run ? run.bpm.details?.() : null);
  }

  function paintLevel(fraction) {
    bar.style.transform = `scaleX(${fraction.toFixed(3)})`;
    meter.setAttribute('aria-valuenow', String(Math.round(fraction * 100)));
  }

  function paintButton() {
    const live = run !== null;
    label.textContent = live ? 'Stop' : 'Start';
    button.disabled = starting;
    button.classList.toggle('primary', !live);
    button.classList.toggle('outline', live);
  }

  function say(key) {
    state.textContent = TEXT[key];
    state.classList.toggle('error', key !== 'idle' && key !== 'asking' && key !== 'listening');
  }

  function release() {
    const r = run;
    if (!r) return;
    run = null;
    for (const t of r.timers) { clearInterval(t); clearTimeout(t); }
    r.off.forEach((fn) => fn());
    r.proc.onaudioprocess = null;
    for (const n of r.nodes) n.disconnect();
    for (const t of r.stream.getTracks()) t.stop();
    void r.ctx.close?.();
  }

  function stop(key) {
    if (!run) return;
    release();
    if (gone) return;
    paintBpm(null);
    paintLevel(0);
    refreshDetails();
    paintButton();
    say(key);
  }

  async function start() {
    if (run || starting || gone) return;
    if (!nav?.mediaDevices?.getUserMedia || !Ctx) { say('unsupported'); return; }
    starting = true;
    say('asking');
    paintButton();
    let ctx;
    let stream;
    try {
      ctx = new Ctx();
      void ctx.resume?.();
      stream = await nav.mediaDevices.getUserMedia(CONSTRAINTS);
    } catch (ex) {
      starting = false;
      void ctx?.close?.();
      if (gone) return;
      say(errorKey(ex));
      paintButton();
      return;
    }
    starting = false;
    if (gone) {
      for (const t of stream.getTracks()) t.stop();
      void ctx.close?.();
      return;
    }
    try {
      if (ctx.state === 'suspended') await ctx.resume();
      begin(ctx, stream);
    } catch {
      for (const t of stream.getTracks()) t.stop();
      void ctx.close?.();
      if (!gone) { say('failed'); paintButton(); }
    }
  }

  function begin(ctx, stream) {
    const bpm = create();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    const mute = ctx.createGain();
    mute.gain.value = 0;
    source.connect(analyser);
    analyser.connect(proc);
    proc.connect(mute);
    mute.connect(ctx.destination);
    proc.onaudioprocess = (e) => bpm.push(e.inputBuffer.getChannelData(0), ctx.sampleRate);
    const buf = new Float32Array(analyser.fftSize);
    let held = 0;
    const off = [];
    const listen = (target, type, fn) => { target?.addEventListener?.(type, fn); off.push(() => target?.removeEventListener?.(type, fn)); };
    const startedAt = Date.now();
    run = {
      ctx, stream, proc, bpm, nodes: [source, analyser, proc, mute], off,
      timers: [
        setInterval(() => {
          analyser.getFloatTimeDomainData(buf);
          held = Math.max(levelFraction(rmsOf(buf)), held - METER_FALL);
          paintLevel(held);
        }, METER_MS),
        setInterval(() => { paintBpm(bpm.value()); refreshDetails(); }, PUBLISH_MS),
        setTimeout(() => stop('timeout'), MAX_RUN_MS),
      ],
    };
    for (const t of stream.getTracks()) listen(t, 'ended', () => stop('ended'));
    listen(doc, 'visibilitychange', () => { if (doc.hidden) stop('hidden'); });
    listen(nav.mediaDevices, 'devicechange', () => { if (Date.now() - startedAt > DEVICE_GRACE_MS) stop('devices'); });
    paintBpm(null);
    say('listening');
    paintButton();
  }

  details.addEventListener('toggle', refreshDetails);
  paintDetails(null);

  return {
    node,
    get running() { return run !== null; },
    start,
    stop: () => stop('idle'),
    dispose() { gone = true; release(); },
  };
}
