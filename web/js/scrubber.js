import { positionToTime, keyTime, fraction, usableDuration, valueText, clock } from './scrub.js';

export function attachScrubber(node, { duration, time, onSeek, onPreview }) {
  let dragging = false;
  let target = 0;
  let pointer = null;
  const bubble = node.querySelector('.scrub-bubble');

  const paint = (t) => {
    const d = duration();
    node.style.setProperty('--p', fraction(t, d).toFixed(4));
    node.setAttribute('aria-valuenow', String(Math.round(t)));
    node.setAttribute('aria-valuetext', valueText(t, d));
    if (bubble) bubble.textContent = clock(t);
  };

  const sync = () => {
    const d = duration();
    const ok = usableDuration(d);
    node.setAttribute('aria-disabled', String(!ok));
    node.tabIndex = ok ? 0 : -1;
    node.setAttribute('aria-valuemin', '0');
    node.setAttribute('aria-valuemax', String(ok ? Math.round(d) : 0));
    if (!dragging) paint(ok ? time() : 0);
  };

  const finish = (commit) => {
    if (!dragging) return;
    dragging = false;
    node.classList.remove('dragging');
    if (pointer != null && node.hasPointerCapture?.(pointer)) node.releasePointerCapture(pointer);
    pointer = null;
    if (onPreview) onPreview(null);
    if (commit) onSeek(target);
    sync();
  };

  const at = (e) => positionToTime(e.clientX, node.getBoundingClientRect(), duration());
  const move = (e) => {
    const t = at(e);
    if (t == null) return;
    target = t;
    paint(t);
    if (onPreview) onPreview(t);
  };

  node.addEventListener('pointerdown', (e) => {
    if (e.button > 0 || !usableDuration(duration())) return;
    e.preventDefault();
    dragging = true;
    pointer = e.pointerId;
    node.classList.add('dragging');
    node.setPointerCapture?.(e.pointerId);
    node.focus({ preventScroll: true });
    move(e);
  });
  node.addEventListener('pointermove', (e) => { if (dragging && e.pointerId === pointer) move(e); });
  node.addEventListener('pointerup', (e) => { if (dragging && e.pointerId === pointer) { move(e); finish(true); } });
  node.addEventListener('pointercancel', () => finish(false));
  node.addEventListener('lostpointercapture', () => finish(false));
  node.addEventListener('dragstart', (e) => e.preventDefault());
  node.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = keyTime(e.key, e.shiftKey, dragging ? target : time(), duration());
    if (t == null) return;
    e.preventDefault();
    e.stopPropagation();
    onSeek(t);
    paint(t);
  });

  sync();
  return { sync, get dragging() { return dragging; } };
}
