import { ORDER_SEND_MS, DRAG_EDGE_PX, DRAG_SCROLL_PX } from './constants.js';
import { dropIndex } from './playlists-model.js';

export function createOrderSync({ send, onError, delay = ORDER_SEND_MS }) {
  let latest = null;
  let timer = 0;
  let active = null;
  async function drain() {
    while (latest) {
      const ids = latest;
      latest = null;
      try {
        await send(ids); // NOSONAR each order is sent after the previous one finished
      } catch (ex) {
        latest = null;
        onError(ex);
        return;
      }
    }
  }
  function flush() {
    clearTimeout(timer);
    timer = 0;
    if (!active) active = drain().finally(() => { active = null; });
    return active;
  }
  return {
    schedule(ids) {
      latest = ids;
      clearTimeout(timer);
      timer = setTimeout(flush, delay);
    },
    flush,
    pending: () => !!(latest || active),
    cancel() {
      clearTimeout(timer);
      timer = 0;
      latest = null;
    },
  };
}

function slotAt(rows, y) {
  let slot = 0;
  for (const row of rows) {
    const r = row.getBoundingClientRect();
    if (y > r.top + r.height / 2) slot += 1;
  }
  return slot;
}

function markSlot(rows, slot, from) {
  for (const row of rows) row.classList.remove('drop-before', 'drop-end');
  if (slot === from || slot === from + 1) return;
  if (slot < rows.length) rows[slot].classList.add('drop-before');
  else rows[rows.length - 1].classList.add('drop-end');
}

export function attachDrag(list, { onMove }) {
  let drag = null;
  let frame = 0;

  const rowsNow = () => [...list.querySelectorAll('li.song')];

  function scrollTick() {
    frame = 0;
    if (!drag) return;
    const y = drag.y;
    let by = 0;
    if (y < DRAG_EDGE_PX) by = -DRAG_SCROLL_PX;
    else if (y > window.innerHeight - DRAG_EDGE_PX) by = DRAG_SCROLL_PX;
    if (by) {
      window.scrollBy(0, by);
      drag.slot = slotAt(rowsNow(), y);
      markSlot(rowsNow(), drag.slot, drag.from);
      frame = requestAnimationFrame(scrollTick);
    }
  }

  function finish(commit) {
    if (!drag) return;
    const { row, from, slot, grip, pointerId } = drag;
    drag = null;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    for (const r of rowsNow()) r.classList.remove('drop-before', 'drop-end');
    row.classList.remove('dragging');
    list.classList.remove('is-dragging');
    if (grip.hasPointerCapture?.(pointerId)) grip.releasePointerCapture(pointerId);
    document.removeEventListener('keydown', onKey, true);
    const to = dropIndex(rowsNow().length, from, slot);
    if (commit && to !== from) onMove(from, to, row);
  }

  function onKey(e) {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    finish(false);
  }

  list.addEventListener('pointerdown', (e) => {
    const grip = e.target.closest?.('.pl-grip');
    if (!grip || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const row = grip.closest('li.song');
    if (!row) return;
    e.preventDefault();
    const from = rowsNow().indexOf(row);
    grip.setPointerCapture?.(e.pointerId);
    drag = { row, grip, from, slot: from, pointerId: e.pointerId, y: e.clientY };
    row.classList.add('dragging');
    list.classList.add('is-dragging');
    document.addEventListener('keydown', onKey, true);
  });

  list.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    drag.y = e.clientY;
    const rows = rowsNow();
    drag.slot = slotAt(rows, e.clientY);
    markSlot(rows, drag.slot, drag.from);
    if (!frame) frame = requestAnimationFrame(scrollTick);
  });

  list.addEventListener('pointerup', (e) => {
    if (drag && e.pointerId === drag.pointerId) finish(true);
  });
  list.addEventListener('pointercancel', (e) => {
    if (drag && e.pointerId === drag.pointerId) finish(false);
  });
  list.addEventListener('lostpointercapture', () => finish(false));

  return () => finish(false);
}
