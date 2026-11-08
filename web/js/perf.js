const RING = 300;
const MAX_GAPS = 200;
const LONG_MS = 50;
const RAF_GAP_MS = 100;
const RAF_WINDOW_MS = 15000;
const SESSION_MS = 30000;
const AUDIO_EVENTS = ['play', 'loadstart', 'loadedmetadata', 'loadeddata', 'canplay', 'canplaythrough', 'playing', 'timeupdate', 'waiting', 'stalled', 'suspend', 'seeking', 'seeked', 'durationchange', 'emptied', 'abort', 'error'];

const noop = () => {};
const tenth = (n) => Math.round(n * 10) / 10;

export function readEnabled(win = globalThis) {
  try {
    if (/[#?&]perf=1\b/.test(`${win.location?.search ?? ''}${win.location?.hash ?? ''}`)) return true;
  } catch { /* no location */ }
  try {
    return win.localStorage?.getItem('ap2.perf') === '1';
  } catch {
    return false;
  }
}

/** Playback-start timing marks. Silent unless `localStorage['ap2.perf']='1'` or `?perf=1` / `#perf=1` is present when the page starts (PLY-203). */
export function createPerf({ win = globalThis, enabled = readEnabled(win) } = {}) {
  if (!enabled) return { enabled: false, mark: noop, begin: noop, watchAudio: noop, track: (p) => p, table: () => [], slowest: () => [], resources: () => [] };
  const clock = win.performance;
  const now = () => (clock?.now ? clock.now() : Date.now());
  const out = win.console ?? {};
  const entries = [];
  const gaps = [];
  let base = null;
  let armed = false;
  let sawTime = false;
  let rafSeq = 0;
  const audios = new WeakSet();

  function push(list, item, cap) {
    list.push(item);
    if (list.length > cap) list.shift();
  }

  function mark(name, detail) {
    const t = now();
    push(entries, { name, t, detail }, RING);
    try {
      clock?.mark?.(`ap2:${name}`, { startTime: t, detail });
      if (armed && base != null) clock?.measure?.(`ap2:${name} since start`, { start: base, end: t });
    } catch { /* performance timeline unavailable */ }
  }

  function addGap(kind, start, dur) {
    push(gaps, { kind, start, dur }, MAX_GAPS);
  }

  function watchFrames() {
    const raf = win.requestAnimationFrame?.bind(win);
    if (!raf) return;
    const my = ++rafSeq;
    let last = now();
    const end = last + RAF_WINDOW_MS;
    const step = () => {
      if (my !== rafSeq) return;
      const t = now();
      if (t - last > RAF_GAP_MS) addGap('frame', last, t - last);
      last = t;
      if (t < end) raf(step);
    };
    raf(step);
  }

  function begin(label = 'click', detail) {
    entries.length = 0;
    gaps.length = 0;
    base = now();
    armed = true;
    sawTime = false;
    mark(label, detail);
    watchFrames();
  }

  function table() {
    const from = base ?? 0;
    const rows = entries.filter((e) => e.t >= from).map((e) => ({ mark: e.name, ms: tenth(e.t - from), dur: '', detail: e.detail ?? '' }));
    for (const g of gaps) {
      if (g.start + g.dur >= from) rows.push({ mark: `gap:${g.kind}`, ms: tenth(g.start - from), dur: tenth(g.dur), detail: '' });
    }
    rows.sort((a, b) => a.ms - b.ms);
    let prev = 0;
    return rows.map((r) => {
      const row = { ...r, since_prev: tenth(r.ms - prev) };
      if (!r.mark.startsWith('gap:')) prev = r.ms;
      return row;
    });
  }

  function slowest(n = 5) {
    const from = base ?? 0;
    const events = entries.filter((e) => e.t >= from);
    const spans = events.slice(1).map((e, i) => ({ between: `${events[i].name} -> ${e.name}`, ms: tenth(e.t - events[i].t) }));
    const g = gaps.map((x) => ({ between: `gap:${x.kind} at ${tenth(x.start - from)} ms`, ms: tenth(x.dur) }));
    return [...spans, ...g].sort((a, b) => b.ms - a.ms).slice(0, n);
  }

  function resources() {
    const from = base ?? 0;
    let list = [];
    try { list = clock?.getEntriesByType?.('resource') ?? []; } catch { /* no resource timing */ }
    const late = list.filter((r) => r.startTime >= from);
    const bytesOf = (r) => r.transferSize || r.encodedBodySize || 0;
    const covers = late.filter((r) => r.initiatorType === 'img' && String(r.name).includes('/covers/'));
    const perUrl = new Map();
    for (const r of covers) perUrl.set(r.name, (perUrl.get(r.name) ?? 0) + 1);
    const repeats = [...perUrl.values()].filter((n) => n > 1).length;
    const rows = [{
      what: 'cover requests (img, /covers/)',
      count: covers.length,
      distinct_urls: perUrl.size,
      urls_requested_more_than_once: repeats,
      bytes: covers.reduce((n, r) => n + bytesOf(r), 0),
    }];
    for (const r of late.filter((x) => String(x.name).includes('/files/'))) {
      rows.push({
        what: `audio ${String(r.name).replace(/^.*\/files\//, '/files/').slice(0, 40)}`,
        start_ms: tenth(r.startTime - from),
        request_start_ms: tenth(r.requestStart - from),
        queued_ms: tenth(r.requestStart - r.startTime),
        response_start_ms: tenth(r.responseStart - from),
        end_ms: tenth(r.responseEnd - from),
        bytes: bytesOf(r),
      });
    }
    return rows;
  }

  function report() {
    const rows = table();
    try {
      out.log?.('[ap2perf] first playing after start; call __ap2perf() for the full table, __ap2perf.resources() for covers and audio requests (a request still pending is not listed yet)');
      out.table?.(rows);
      out.table?.(slowest());
      out.table?.(resources());
    } catch { /* console unavailable */ }
    return rows;
  }

  function watchAudio(audio) {
    if (!audio || audios.has(audio)) return;
    audios.add(audio);
    for (const ev of AUDIO_EVENTS) {
      audio.addEventListener(ev, () => {
        if (ev === 'timeupdate') {
          if (sawTime) return;
          sawTime = true;
        }
        mark(`audio:${ev}`, `rs${audio.readyState} t${tenth(audio.currentTime || 0)}`);
        if (ev === 'playing' && armed) {
          armed = false;
          report();
        }
      });
    }
  }

  function track(promise) {
    if (promise?.then) promise.then(() => mark('play() resolved'), (err) => mark('play() rejected', err?.name ?? String(err)));
    return promise;
  }

  const Observer = win.PerformanceObserver;
  if (typeof Observer === 'function') {
    try {
      const po = new Observer((list) => {
        for (const e of list.getEntries()) if (e.duration >= LONG_MS) addGap('longtask', e.startTime, e.duration);
      });
      po.observe({ type: 'longtask' });
    } catch { /* longtask unsupported (Safari) */ }
  }

  win.document?.addEventListener?.('click', (e) => {
    const target = e.target?.closest?.('button, a, [role="button"], li, tr') ?? e.target;
    const detail = `${target?.tagName ?? ''}${target?.id ? `#${target.id}` : ''}`.toLowerCase();
    if (armed && now() - base < SESSION_MS) mark('click again', detail); else begin('click', detail);
  }, true);

  try { clock?.setResourceTimingBufferSize?.(1000); } catch { /* keep the default buffer */ }
  table.resources = resources;
  win.__ap2perf = table;
  return { enabled: true, mark, begin, watchAudio, track, table, slowest, resources };
}

const perf = createPerf();

export const perfEnabled = perf.enabled;
export const mark = perf.mark;
export const watchAudio = perf.watchAudio;
export const trackPlay = perf.track;
export const perfBegin = perf.begin;
