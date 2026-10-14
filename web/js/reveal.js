export function findRowIndex(songs, id) {
  return songs.findIndex((s) => s.id === id);
}

export function scrollTarget({ rowTop, rowHeight, scrollY, viewportH, docH }) {
  const centred = scrollY + rowTop + rowHeight / 2 - viewportH / 2;
  const max = Math.max(0, docH - viewportH);
  return Math.min(Math.max(0, Math.round(centred)), max);
}

let revealer = null;
let pending = null;

export function registerRevealer(fn) {
  revealer = fn;
  if (pending) {
    const id = pending;
    pending = null;
    requestAnimationFrame(() => fn(id));
  }
  return () => { if (revealer === fn) revealer = null; };
}

export function requestReveal(id) {
  if (revealer) { revealer(id); return; }
  pending = id;
  location.hash = '#/library';
}
