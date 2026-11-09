export const CHUNK_BUDGET_MS = 8;

/** Runs `fn` in a task of its own, after the tasks already queued (media events included). */
export function nextTask(fn, win = globalThis) {
  const sched = win.scheduler;
  if (sched && typeof sched.postTask === 'function') {
    sched.postTask(fn, { priority: 'user-visible' }).catch(() => {});
    return;
  }
  setTimeout(fn, 0);
}

/**
 * Puts keyboard focus back on `target` (a control that replaced the focused one) at the start of the next frame, when the browser works out the new layout anyway.
 * Calling `focus()` inside the press would make it do that work at once, in front of the media events. Nothing happens when the target left the page or the focus went somewhere else meanwhile.
 */
export function restoreFocus(target, from = null, doc = globalThis.document, win = globalThis) {
  if (!target) return;
  const run = () => {
    const at = doc.activeElement;
    if (target.isConnected !== false && (!at || at === doc.body || at === from)) target.focus();
  };
  if (typeof win.requestAnimationFrame === 'function') win.requestAnimationFrame(run);
  else nextTask(run, win);
}

/**
 * Calls `step(i)` for i in 0..count-1 in slices of at most `budgetMs`, yielding to the browser between slices so no task grows long.
 * A list of `syncBelow` items or fewer runs at once. Returns a cancel function; `done()` is not called after a cancel.
 */
export function runChunks({ count, step, done = () => {}, budgetMs = CHUNK_BUDGET_MS, syncBelow = 0, now = () => globalThis.performance.now(), later = nextTask }) {
  let i = 0;
  let dead = false;
  const slice = () => {
    if (dead) return;
    const start = now();
    while (i < count) {
      step(i);
      i += 1;
      if (i < count && now() - start >= budgetMs) {
        later(slice);
        return;
      }
    }
    done();
  };
  if (count <= syncBelow) {
    for (; i < count; i += 1) step(i);
    done();
  } else {
    slice();
  }
  return () => { dead = true; };
}
