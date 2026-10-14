import { TOUCH_HOLD_MS, TOUCH_SLOP_PX, CLICK_SWALLOW_MS, VIBRATE_MS } from './constants.js';

export const MIME = 'application/x-electrophone-token';
const END = Number.MAX_SAFE_INTEGER;
export const dragState = { current: null };

export function clearMarks() {
  for (const n of document.querySelectorAll('.drop-over, .drop-before')) n.classList.remove('drop-over', 'drop-before');
}

export function locate(target) {
  const node = target?.closest ? target.closest('.token-field') : null;
  if (!node?.acceptDrop) return null;
  const pill = target.closest('.token-pill');
  const own = pill && node.contains(pill);
  return { node, pill: own && !pill.classList.contains('dragging') ? pill : null, index: own ? Number(pill.dataset.i) : END };
}

export function mark(hit) {
  clearMarks();
  if (!hit) return;
  if (hit.pill) hit.pill.classList.add('drop-before');
  else if (hit.index === END) hit.node.classList.add('drop-over');
}

export function startTouchDrag(kind, pill, i, e) {
  if (e.pointerType === 'mouse' || e.button > 0) return;
  const sx = e.clientX;
  const sy = e.clientY;
  let active = false;
  let clone = null;
  let timer = setTimeout(() => {
    timer = null;
    active = true;
    dragState.current = { kind, index: i };
    pill.classList.add('dragging');
    clone = pill.cloneNode(true);
    clone.classList.remove('dragging');
    clone.classList.add('token-drag-clone');
    clone.style.width = `${pill.offsetWidth}px`;
    document.body.append(clone);
    place(sx, sy);
    if (navigator.vibrate) navigator.vibrate(VIBRATE_MS);
  }, TOUCH_HOLD_MS);
  const place = (x, y) => { clone.style.left = `${x - 20}px`; clone.style.top = `${y - 20}px`; };
  const hitAt = (x, y) => locate(document.elementFromPoint(x, y));
  const stopScroll = (ev) => { if (active && ev.cancelable) ev.preventDefault(); };
  const move = (ev) => {
    if (!active) {
      if (Math.hypot(ev.clientX - sx, ev.clientY - sy) > TOUCH_SLOP_PX) cleanup();
      return;
    }
    place(ev.clientX, ev.clientY);
    mark(hitAt(ev.clientX, ev.clientY));
  };
  const noContext = (ev) => ev.preventDefault();
  function cleanup(drop, ev) {
    if (timer) clearTimeout(timer);
    document.removeEventListener('pointermove', move);
    document.removeEventListener('pointerup', up);
    document.removeEventListener('pointercancel', cancel);
    document.removeEventListener('touchmove', stopScroll);
    pill.removeEventListener('contextmenu', noContext);
    const was = active;
    active = false;
    if (clone) clone.remove();
    clearMarks();
    pill.classList.remove('dragging');
    dragState.current = null;
    if (was) {
      const swallow = (c) => { c.stopPropagation(); c.preventDefault(); };
      document.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => document.removeEventListener('click', swallow, true), CLICK_SWALLOW_MS);
      const hit = drop && ev ? hitAt(ev.clientX, ev.clientY) : null;
      if (hit) hit.node.acceptDrop(kind, i, hit.index);
    }
  }
  const up = (ev) => cleanup(true, ev);
  const cancel = () => cleanup(false);
  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', up);
  document.addEventListener('pointercancel', cancel);
  document.addEventListener('touchmove', stopScroll, { passive: false });
  pill.addEventListener('contextmenu', noContext);
}
