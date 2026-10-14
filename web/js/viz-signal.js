export const SILENT_DB = -110;
export const SILENT_FRAMES = 90;

const GRAPH_TEXT = {
  unsupported: 'Visualizer: this browser has no Web Audio',
  blocked: 'Visualizer: the browser blocked the audio context, press V or the Visualizer button',
  failed: 'Visualizer: the audio graph could not be built',
};

export function frameStats(buf, silentDb = SILENT_DB) {
  let max = -Infinity;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < buf.length; i += 1) {
    const v = buf[i];
    if (!Number.isFinite(v)) continue;
    if (v > max) max = v;
    sum += v;
    count += 1;
  }
  return { max, mean: count ? sum / count : -Infinity, finite: count, silent: !(max > silentDb) };
}

export function byteMax(bytes) {
  let max = 0;
  for (let i = 0; i < bytes.length; i += 1) if (bytes[i] > max) max = bytes[i];
  return max;
}

export function createTracker() {
  const t = { frames: 0, live: 0, silentRun: 0, max: -Infinity, mean: -Infinity, allZero: true, byteMax: null };
  return {
    t,
    record(buf) {
      const s = frameStats(buf);
      t.frames += 1;
      t.max = s.max;
      t.mean = s.mean;
      t.allZero = s.silent;
      if (s.silent) t.silentRun += 1;
      else { t.live += 1; t.silentRun = 0; }
      return s;
    },
    lost() {
      t.silentRun = 0;
      t.max = -Infinity;
      t.mean = -Infinity;
      t.allZero = true;
    },
  };
}

export function diagnose(i) {
  if (!i.playing) return { code: 'idle', text: '' };
  if (GRAPH_TEXT[i.graphState]) return { code: i.graphState, text: GRAPH_TEXT[i.graphState] };
  if (i.ctxState === 'suspended' || i.ctxState === 'interrupted') {
    return { code: 'suspended', text: `Visualizer: audio context ${i.ctxState}, press V or the Visualizer button` };
  }
  if (!i.hasAnalyser) return { code: 'no-analyser', text: 'Visualizer: audio is not routed to the analyser yet' };
  if (i.silentRun >= SILENT_FRAMES) return { code: 'silent', text: 'Visualizer: the analyser reads silence' };
  return { code: 'ok', text: '' };
}

export function userAgentFamily(ua = '') {
  if (/Edg\//.test(ua)) return 'Edge';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/(Chrome|CriOS)\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua)) return 'Safari';
  return 'other';
}

export function audioOrigin(audio, loc) {
  const src = audio?.currentSrc || audio?.src || '';
  let origin = '';
  try { origin = src ? new URL(src, loc?.href).origin : ''; } catch { origin = '?'; }
  return { src: origin || 'none', sameOrigin: origin !== '' && origin === loc?.origin, crossOrigin: audio?.crossOrigin ?? null };
}

const fmt = (v) => (Number.isFinite(v) ? v.toFixed(1) : '-inf');

export function debugLines(i) {
  const d = diagnose(i);
  return [
    `state ${d.code}${d.text ? `: ${d.text}` : ''}`,
    `playing ${i.playing ? 'yes' : 'no'}  paused ${i.paused ? 'yes' : 'no'}  graph ${i.graphState}`,
    `AudioContext ${i.ctxState}  analyser ${i.hasAnalyser ? `fft ${i.fftSize}` : 'none'}`,
    `dB max ${fmt(i.max)}  mean ${fmt(i.mean)}  byte max ${i.byteMax ?? 'n/a'}`,
    `all-zero ${i.allZero ? 'yes' : 'no'}  frames ${i.frames}  nonzero ${i.live}  silent run ${i.silentRun}`,
    `audio origin ${i.src}  page ${i.pageOrigin}  same-origin ${i.sameOrigin ? 'yes' : 'no'}  crossOrigin ${i.crossOrigin ?? 'null'}`,
    `ua ${i.ua}  ${i.frameMs}`,
  ];
}

function styleStatus(el) {
  el.id = 'viz-status';
  el.setAttribute?.('aria-hidden', 'true');
  Object.assign(el.style ?? {}, {
    position: 'fixed', left: '8px', bottom: '8px', zIndex: '100', pointerEvents: 'none', font: '11px monospace',
    color: '#fff', background: 'rgba(0,0,0,.65)', padding: '4px 6px', whiteSpace: 'pre-wrap', maxWidth: 'calc(100vw - 16px)', display: 'none',
  });
}

export function createStatusEl(doc) {
  if (!doc?.createElement || !doc.body?.append) return { set() {} };
  const found = doc.getElementById?.('viz-status');
  const el = found ?? doc.createElement('div');
  if (!found) styleStatus(el);
  if (!el.isConnected) doc.body.append(el);
  return {
    set(text) {
      if (text === el.textContent) return;
      el.textContent = text;
      if (el.style) el.style.display = text ? 'block' : 'none';
    },
  };
}
