export const SAMPLE_MS = 100;
export const STRIP_LEN = 30;
export const SOUND_LEVEL = 2;
export const SOUND_RUN = 2;
export const TAIL_MS = 3000;
export const GIVE_UP_MS = 20000;
export const GUARD_MS = 200;
const MAX_SAMPLES = 400;
const MAX_MARKS = 140;
const PHASE = 'phase: ';

const tenth = (n) => Math.round(n * 10) / 10;

/** The `phase: <name>` marks of a run (detail `<n> ms`, mark time = end of the phase), summed per name and ordered longest first. */
export function phaseRows(marks) {
  const by = new Map();
  for (const m of marks) {
    if (!m.name.startsWith(PHASE)) continue;
    const name = m.name.slice(PHASE.length);
    const dur = parseFloat(m.detail);
    if (!Number.isFinite(dur)) continue;
    const row = by.get(name) ?? { name, ms: 0, runs: 0, endMs: 0 };
    row.ms = tenth(row.ms + dur);
    row.runs += 1;
    row.endMs = m.ms;
    by.set(name, row);
  }
  return [...by.values()].sort((a, b) => b.ms - a.ms);
}

/** Peak of a time-domain byte buffer (128 is silence) on a 0 to 100 scale. */
export function levelOfBytes(bytes) {
  let peak = 0;
  for (let i = 0; i < bytes.length; i++) {
    const d = Math.abs(bytes[i] - 128);
    if (d > peak) peak = d;
  }
  return Math.min(100, Math.round((peak / 128) * 100));
}

/** Top-level boxes of the first bytes of an m4a, and whether the index (`moov`) comes before the audio (`mdat`). */
export function describeLayout(bytes) {
  const boxes = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 0;
  while (pos + 8 <= bytes.length && boxes.length < 12) {
    let size = view.getUint32(pos);
    const kind = String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]);
    if (size === 1 && pos + 16 <= bytes.length) size = Number(view.getBigUint64(pos + 8));
    boxes.push(kind);
    if (size < 8) break;
    pos += size;
  }
  const moov = boxes.indexOf('moov');
  const mdat = boxes.indexOf('mdat');
  const fast = moov >= 0 && (mdat < 0 || moov < mdat);
  const slow = mdat >= 0 && (moov < 0 || mdat < moov);
  let verdict = 'unknown (moov and mdat not both reached in the first bytes)';
  if (fast) verdict = 'moov first: fast start';
  else if (slow) verdict = 'moov AFTER mdat: Safari must read the whole file before it can play';
  return { boxes, verdict, faststart: fast ? true : slow ? false : null };
}

const PLAY_SELECTOR = '.act-play, #mini-play, #side-mini-play, #viz-play, #mini-cover-btn, #cover-toggle, #mini-next, #mini-prev, #side-mini-next, #viz-next, #viz-prev';
const SKIP_SELECTOR = '#mini-next, #mini-prev, #side-mini-next, #viz-next, #viz-prev';

/** The song id in a `/files/<id>` address, or null. */
export function fileIdOf(src) {
  const m = /\/files\/([^/?#]+)/.exec(String(src ?? ''));
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return m[1]; }
}

/** 'play' or 'skip' when a press on `target` is about to start a song (so a new run begins at once), else null. Pressing Play on the song that is playing is a pause and starts nothing. */
export function pressKind(target, { paused, currentId = null } = {}) {
  const ctl = target?.closest?.(PLAY_SELECTOR);
  if (!ctl) return null;
  if (ctl.matches?.(SKIP_SELECTOR)) return 'skip';
  if (paused) return 'play';
  const row = ctl.closest?.('li[data-id]');
  if (row) return row.dataset?.id !== currentId ? 'play' : null;
  return ctl.matches?.('.act-play') ? 'play' : null;
}

/** Keyboard play (Space on the page, or the media key) as a press, when the key is not typing or activating a control. */
export function isPlayKey(e) {
  if (e.key === 'MediaPlayPause') return true;
  if (e.key !== ' ' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return false;
  return !/^(INPUT|TEXTAREA|SELECT|BUTTON|A|SUMMARY)$/.test(e.target?.tagName ?? '') && !e.target?.isContentEditable;
}

export const RESOURCE_WINDOW_MS = 5000;
const EARLIER_MS = 30000;
const API_INITIATORS = new Set(['fetch', 'xmlhttprequest', 'other', 'beacon']);

/**
 * Resource Timing rows for the `windowMs` after the press at `t0` (offsets in ms from `t0`, negative for a request that started earlier and was still running at the press).
 * Every `/files/` request is listed, with `who`: `cur` (the song of this run), `prev` (the song that was loaded at the press, when it is another one) or `other` (a warm-up for some other song); script-made requests that are not `/files/` (plays upload, listening, peaks) are listed as `api`.
 */
export function resourceRows(entries, t0, { prevId = null, curId = null, windowMs = RESOURCE_WINDOW_MS } = {}) {
  const off = (v) => (v > 0 ? tenth(v - t0) : 0);
  const rows = [];
  for (const r of entries) {
    const name = String(r.name);
    const file = name.includes('/files/');
    if (!file && !API_INITIATORS.has(r.initiatorType)) continue;
    const early = r.startTime < t0;
    if (early && !(r.responseEnd > t0 && r.startTime >= t0 - EARLIER_MS)) continue;
    if (r.startTime > t0 + windowMs) continue;
    const id = file ? fileIdOf(name) : null;
    rows.push({
      name: name.replace(/^[a-z]+:\/\/[^/]+/, '').slice(0, 28),
      who: !file ? 'api' : id != null && id === prevId && prevId !== curId ? 'prev' : id != null && id === curId ? 'cur' : 'other',
      start: tenth(r.startTime - t0),
      connect: r.connectEnd > r.connectStart ? tenth(r.connectEnd - r.connectStart) : 0,
      requestStart: off(r.requestStart),
      responseStart: off(r.responseStart),
      responseEnd: off(r.responseEnd),
      bytes: r.transferSize || r.encodedBodySize || 0,
    });
  }
  return rows.sort((a, b) => a.start - b.start);
}

/** The state of one press-to-sound run; no DOM, no clock of its own: every call carries its time. */
export function createMeterCore({ stripLen = STRIP_LEN, soundLevel = SOUND_LEVEL, soundRun = SOUND_RUN, tailMs = TAIL_MS, giveUpMs = GIVE_UP_MS } = {}) {
  let run = null;

  const blank = (t0) => ({
    t0,
    marks: [],
    facts: [],
    resources: [],
    samples: [],
    strip: [],
    level: null,
    levelFromStart: null,
    armedAt: null,
    above: 0,
    aboveStart: null,
    levelSoundMs: null,
    progressMs: null,
    doneAt: null,
  });

  const ms = (t) => (run ? Math.max(0, t - run.t0) : 0);

  function mark(name, t, detail) {
    if (!run) return;
    run.marks.push({ name, ms: tenth(ms(t)), detail: detail ?? '' });
    if (run.marks.length > MAX_MARKS) run.marks.splice(1, 1);
  }

  /** Starts a new run at time `t` and drops the previous one. `armed` is false when sound from an earlier song may still be playing. */
  function press(t, detail, { armed = true } = {}) {
    run = blank(t);
    if (armed) run.armedAt = 0;
    mark('press', t, detail);
    return run;
  }

  function fact(key, value) {
    if (!run) return;
    const at = run.facts.findIndex((f) => f.key === key);
    if (at >= 0) run.facts[at].value = value;
    else run.facts.push({ key, value });
  }

  /** The audio of an earlier song may still be in the analyser until the new source loads: count sound only from here on. */
  function arm(t) {
    if (!run || run.armedAt != null) return;
    run.armedAt = ms(t) + GUARD_MS;
  }

  function soundMs() {
    if (!run) return null;
    return method() === 'level' ? run.levelSoundMs : run.progressMs;
  }

  function method() {
    if (!run || run.levelFromStart == null) return 'none';
    return run.levelFromStart ? 'level' : 'timeupdate';
  }

  /** One 100 ms reading: `level` is 0 to 100, or null when there is no analyser. Returns false once the run is over. */
  function sample(t, level) {
    if (!run || run.doneAt != null) return false;
    const at = ms(t);
    if (run.levelFromStart == null) run.levelFromStart = level != null;
    run.level = level;
    run.samples.push(level == null ? [tenth(at)] : [tenth(at), level]);
    if (run.samples.length > MAX_SAMPLES) run.samples.shift();
    run.strip.push(level);
    if (run.strip.length > stripLen) run.strip.shift();
    const counts = level != null && run.armedAt != null && at >= run.armedAt;
    if (counts && level > soundLevel) {
      if (run.above === 0) run.aboveStart = at;
      run.above += 1;
      if (run.above >= soundRun && run.levelSoundMs == null) {
        run.levelSoundMs = tenth(run.aboveStart);
        mark('first sound (level)', run.t0 + run.aboveStart, `level>${soundLevel} x${soundRun}`);
      }
    } else if (counts) {
      run.above = 0;
    }
    const sound = soundMs();
    if ((sound != null && at >= sound + tailMs) || at >= giveUpMs) run.doneAt = tenth(at);
    return run.doneAt == null;
  }

  function timeupdate(t, currentTime) {
    if (!run || run.progressMs != null || run.armedAt == null || !(currentTime > 0)) return;
    run.progressMs = tenth(ms(t));
    mark('first timeupdate>0', t, `t${tenth(currentTime)}`);
  }

  function setResources(list) {
    if (run) run.resources = list;
  }

  function stop(t) {
    if (run && run.doneAt == null) run.doneAt = tenth(ms(t));
  }

  function snapshot(t) {
    if (!run) return { active: false, ms: 0, level: null, strip: [], soundMs: null, method: 'none', marks: [], facts: [], resources: [], progressMs: null, levelSoundMs: null };
    const active = run.doneAt == null;
    const found = soundMs();
    return {
      active,
      ms: tenth(found ?? (active ? ms(t) : run.doneAt)),
      level: run.level,
      strip: run.strip.slice(),
      soundMs: soundMs(),
      method: method(),
      marks: run.marks.slice(),
      facts: run.facts.slice(),
      resources: run.resources.slice(),
      progressMs: run.progressMs,
      levelSoundMs: run.levelSoundMs,
    };
  }

  function toText() {
    if (!run) return 'Latency meter: no run yet';
    const s = soundMs();
    const m = method();
    const lines = ['Latency meter run'];
    for (const f of run.facts) lines.push(`${f.key}: ${f.value}`);
    lines.push(`first sound: ${s == null ? 'not detected' : `${s} ms`} (method: ${m}${m === 'level' ? `, level>${soundLevel} for ${soundRun} samples` : ', no analyser at press'})`);
    if (run.levelSoundMs != null) lines.push(`first sound by level: ${run.levelSoundMs} ms`);
    lines.push(`first timeupdate>0: ${run.progressMs == null ? 'none' : `${run.progressMs} ms`}`);
    lines.push('marks (ms from press):');
    for (const x of run.marks) lines.push(`  ${String(x.ms).padStart(8)}  ${x.name}${x.detail ? ` ${x.detail}` : ''}`);
    const phases = phaseRows(run.marks);
    if (phases.length) {
      lines.push('phases (ms of main-thread work in each part of the press pipeline, longest first; end = when its last run ended, ms from press):');
      for (const p of phases) lines.push(`  ${String(p.ms).padStart(8)} ms  ${p.name}${p.runs > 1 ? ` (${p.runs} runs)` : ''}  end ${p.endMs}`);
    }
    if (run.resources.length) {
      lines.push(`requests in the first ${RESOURCE_WINDOW_MS / 1000} s (ms from press, Resource Timing; who: cur = this song, prev = the song loaded at the press, other = another song or a warm-up, api = not a file; a request cancelled or still pending is not listed; connect > 0 means a new connection):`);
      for (const r of run.resources) lines.push(`  [${r.who}] ${r.name} start ${r.start}${r.start < 0 ? ' (before the press)' : ''} connect ${r.connect} requestStart ${r.requestStart} responseStart ${r.responseStart} responseEnd ${r.responseEnd} bytes ${r.bytes}`);
    } else {
      lines.push('requests: none listed (Resource Timing has none for this run; Safari may omit media requests)');
    }
    lines.push('levels (0-100 every 100 ms, - = no analyser):');
    lines.push(run.samples.map((x) => (x.length > 1 ? x[1] : '-')).join(' '));
    return lines.join('\n');
  }

  return { press, mark, fact, arm, sample, timeupdate, setResources, stop, snapshot, toText, get running() { return !!run && run.doneAt == null; } };
}
