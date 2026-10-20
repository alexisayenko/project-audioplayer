import { scrollTarget } from './reveal.js';

export const USER_SCROLL_MS = 2000;

export function createQueueFollow(list, { now = () => Date.now(), reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches, observe = true } = {}) {
  let lastKey = null;
  let wasVisible = false;
  let lastUser = -Infinity;
  let current = null;
  const visible = () => (list.getClientRects?.().length ?? 0) > 0;
  const markUser = () => { lastUser = now(); };
  list.addEventListener?.('wheel', markUser, { passive: true });
  list.addEventListener?.('touchmove', markUser, { passive: true });

  function scrollTo(index, smooth) {
    const row = list.children[index];
    if (!row) return;
    const lr = list.getBoundingClientRect();
    const r = row.getBoundingClientRect();
    list.scrollTo({
      top: scrollTarget({ rowTop: r.top - lr.top, rowHeight: r.height, scrollY: list.scrollTop, viewportH: list.clientHeight, docH: list.scrollHeight }),
      behavior: smooth && !reduced() ? 'smooth' : 'auto',
    });
  }

  function sync() {
    const shown = visible();
    const opened = shown && !wasVisible;
    wasVisible = shown;
    if (!current) { lastKey = null; return; }
    if (!shown) return;
    if (current.key !== lastKey) { lastKey = current.key; scrollTo(current.index, !opened); return; }
    if (opened && now() - lastUser > USER_SCROLL_MS) scrollTo(current.index, false);
  }

  if (observe && typeof ResizeObserver !== 'undefined') new ResizeObserver(sync).observe(list);
  return (id, index) => {
    current = id == null || index < 0 ? null : { key: `${index}|${id}`, index };
    sync();
  };
}
