import { runChunks, restoreFocus } from './defer.js';

export const SYNC_ROWS = 60;

/**
 * The rows of the Now playing queue. A change of the current song or of play/pause touches the one or two rows it concerns; the rows are built again only when the queue or the library changed, in slices of a few milliseconds, and not at all while the Now playing page is hidden (they are made when it is shown).
 * `state()` gives `{ items, index, playing }`; the queue array of a new queue is a new object, a jump to another song keeps it.
 */
export function createQueueView({ list, section = null, state, buildRow, paintPlaying, keepCovers = () => {}, dispose = () => {}, onRebuild = () => {}, onBuilt = () => {}, win = globalThis, chunk = {} }) {
  const tracked = !!section && typeof win.MutationObserver === 'function';
  let stale = true;
  let shownItems = null;
  let shownIndex = -1;
  let shownPlaying = null;
  let job = null;
  let jobKey = null;

  const visible = () => !tracked || !section.hidden;
  const sameAs = (s, items, index, playing) => s.items === items && s.index === index && s.playing === playing;

  function cancel() {
    job?.cancel();
    job = null;
    jobKey = null;
  }

  function focusedRow() {
    const at = list.ownerDocument?.activeElement ?? null;
    const row = at?.closest?.('li') ?? null;
    return row && row.parentNode === list && at.classList?.contains('row-cover') ? { index: [...list.children].indexOf(row), at } : null;
  }

  function rebuild(s) {
    cancel();
    const rows = [];
    const snapshot = { items: s.items, index: s.index, playing: s.playing };
    jobKey = snapshot;
    const run = runChunks({
      count: s.items.length,
      step: (i) => rows.push(buildRow(s.items[i], i, snapshot)),
      syncBelow: SYNC_ROWS,
      ...chunk,
      done: () => {
        job = null;
        jobKey = null;
        const prev = [...list.children];
        const focus = focusedRow();
        onRebuild();
        keepCovers(prev, rows);
        list.replaceChildren(...rows);
        if (focus) restoreFocus(list.children[focus.index]?.querySelector('.row-cover'), focus.at, list.ownerDocument, win);
        shownItems = snapshot.items;
        shownIndex = snapshot.index;
        shownPlaying = snapshot.playing;
        stale = false;
        onBuilt();
      },
    });
    if (jobKey) job = { cancel: run };
  }

  function replaceRow(i, s) {
    const old = list.children[i];
    if (!old || !s.items[i]) return;
    const next = buildRow(s.items[i], i, s);
    keepCovers([old], [next]);
    dispose(old);
    const at = list.ownerDocument?.activeElement ?? null;
    const had = old.contains?.(at);
    old.replaceWith(next);
    if (had) restoreFocus(next.querySelector('.row-cover'), at, list.ownerDocument, win);
  }

  function patch(s) {
    if (s.index !== shownIndex) {
      replaceRow(shownIndex, s);
      replaceRow(s.index, s);
    } else if (s.playing !== shownPlaying) {
      const row = list.children[s.index];
      if (row) paintPlaying(row, s.index, s);
    }
    shownIndex = s.index;
    shownPlaying = s.playing;
  }

  /** Brings the rows in line with the player. */
  function update() {
    if (!visible()) return;
    const s = state();
    if (job) {
      if (sameAs(s, jobKey.items, jobKey.index, jobKey.playing)) return;
      rebuild(s);
      return;
    }
    if (!stale && s.items === shownItems && list.children.length === s.items.length) {
      if (!sameAs(s, shownItems, shownIndex, shownPlaying)) patch(s);
      return;
    }
    rebuild(s);
  }

  /** The songs behind the rows changed (library, auto-download): build them again at the next update. */
  function invalidate() {
    stale = true;
  }

  let watcher = null;
  if (tracked) {
    watcher = new win.MutationObserver(() => { if (!section.hidden) update(); });
    watcher.observe(section, { attributes: true, attributeFilter: ['hidden'] });
  }

  return { update, invalidate, get building() { return job != null; }, stop() { cancel(); watcher?.disconnect(); } };
}
