export const MIN_OVERFLOW = 2;
export const PAD = 14;
const SPEED = 32;
const PAUSES = 3;
const MIN_DUR = 6;
const REDUCED = '(prefers-reduced-motion: reduce)';

export function prefersReduced(mm = globalThis.matchMedia) {
  return typeof mm === 'function' ? !!mm.call(globalThis, REDUCED)?.matches : false;
}

export function marqueeMetrics(overflow, reduced = false) {
  if (reduced || !(overflow > MIN_OVERFLOW)) return { overflowing: false, dist: 0, dur: 0 };
  const dist = Math.ceil(overflow) + 2 * PAD;
  return { overflowing: true, dist, dur: Math.max(MIN_DUR, dist / SPEED + PAUSES) };
}

const states = new WeakMap();
const autos = new Set();
let ro = null;
let io = null;
let installed = false;

const shouldRun = (st) => st.dist > 0 && (st.auto ? st.visible : st.active);

function apply(el, st) {
  if (st.dist > 0) {
    el.style.setProperty('--mq-dist', `${st.dist}px`);
    el.style.setProperty('--mq-dur', `${st.dur}s`);
  } else {
    el.style.removeProperty('--mq-dist');
    el.style.removeProperty('--mq-dur');
  }
  el.classList.toggle('mq-run', shouldRun(st));
}

export function measure(el) {
  const st = states.get(el);
  if (!st?.track) return;
  const width = el.clientWidth;
  const content = st.track.scrollWidth - (el.classList.contains('mq-run') ? 2 * PAD : 0);
  const m = width > 0 ? marqueeMetrics(content - width, prefersReduced()) : marqueeMetrics(0);
  st.dist = m.dist;
  st.dur = m.dur;
  apply(el, st);
}

function remeasureAutos() {
  for (const ref of autos) {
    const el = ref.deref();
    if (el?.isConnected) measure(el);
    else autos.delete(ref);
  }
}

function install() {
  if (installed) return;
  installed = true;
  if (typeof ResizeObserver === 'function') {
    ro = new ResizeObserver((entries) => {
      for (const { target } of entries) {
        if (target.isConnected) measure(target);
        else ro.unobserve(target);
      }
    });
  }
  if (typeof IntersectionObserver === 'function') {
    io = new IntersectionObserver((entries) => {
      for (const { target, isIntersecting } of entries) {
        const st = states.get(target);
        if (!st) continue;
        st.visible = isIntersecting;
        apply(target, st);
      }
    });
  }
  document.addEventListener?.('visibilitychange', () => document.body?.classList.toggle('doc-hidden', document.hidden === true));
  void document.fonts?.ready?.then(remeasureAutos);
  document.fonts?.addEventListener?.('loadingdone', remeasureAutos);
}

function wrap(el) {
  const first = el.firstChild;
  if (first && el.childNodes.length === 1 && first.className === 'mq-track') return first;
  const track = document.createElement('span');
  track.className = 'mq-track';
  for (const c of [...el.childNodes]) track.append(c);
  el.append(track);
  return track;
}

function setActive(el, st, on) {
  if (st.active === on) return;
  st.active = on;
  if (on) measure(el);
  else apply(el, st);
}

function bindHost(el, st) {
  const host = st.host;
  host.addEventListener('mouseenter', () => setActive(el, st, true));
  host.addEventListener('mouseleave', () => setActive(el, st, false));
  host.addEventListener('focusin', () => setActive(el, st, true));
  host.addEventListener('focusout', (e) => {
    if (!e.relatedTarget || !host.contains(e.relatedTarget)) setActive(el, st, false);
  });
}

function watch(el, st) {
  if (st.watched) return;
  st.watched = true;
  st.ref = new WeakRef(el);
  autos.add(st.ref);
  ro?.observe(el);
  io?.observe(el);
}

function unwatch(el, st) {
  if (!st.watched) return;
  st.watched = false;
  autos.delete(st.ref);
  ro?.unobserve(el);
  io?.unobserve(el);
}

export function marquee(el, { auto = false, host = el } = {}) {
  install();
  let st = states.get(el);
  if (!st) {
    st = { auto, host, active: false, visible: true, dist: 0, dur: 0, track: null, watched: false, ref: null };
    states.set(el, st);
    el.classList.add('mq');
    bindHost(el, st);
  }
  st.auto = auto;
  st.track = wrap(el);
  st.dist = 0;
  apply(el, st);
  if (auto) watch(el, st); else unwatch(el, st);
  const later = globalThis.requestAnimationFrame ?? ((fn) => fn());
  later(() => measure(el));
  return el;
}

export function disposeAll(root) {
  if (!root?.querySelectorAll) return;
  for (const el of root.querySelectorAll('.mq')) {
    const st = states.get(el);
    if (st) unwatch(el, st);
  }
}
