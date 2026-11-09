import { el } from './dom.js';
import { icon } from './icons.js';
import { can } from './guest.js';
import { unwatchCover } from './cover-url.js';

const ACTIONS = {
  pause: { icon: 'pause', verb: 'Pause' },
  resume: { icon: 'play', verb: 'Play' },
  play: { icon: 'play', verb: 'Play' },
  download: { icon: 'download', verb: 'Download' },
  none: { icon: 'play', verb: 'Play' },
  source: { icon: 'play', verb: 'Open source:' },
};

// What the cover button of a Library row does and shows. `dl` is the autodl view kind of a song without server audio.
export function coverModel({ audio, queueable, here, playing, dl = 'none', source = false }) {
  if (audio && here) {
    const action = playing ? 'pause' : 'resume';
    return { action, persistent: true, ...ACTIONS[action] };
  }
  if (queueable) return { action: 'play', persistent: false, ...ACTIONS.play };
  if (!audio && !can('fetch') && source) return { action: 'source', persistent: false, ...ACTIONS.source };
  if (!audio && can('fetch') && (dl === 'none' || dl === 'failed')) return { action: 'download', persistent: false, ...ACTIONS.download };
  return { action: 'none', persistent: false, disabled: true, ...ACTIONS.none };
}

export const isRowControl = (target) => !!target?.closest?.('a, button:not(.open)');

const coverImg = (row) => row.querySelector?.('.row-cover img.cover');
const coverSrc = (img) => img.dataset?.src || img.getAttribute('src');

export function keepCovers(prevRows, nextRows) {
  const loaded = new Map();
  for (const row of prevRows) {
    const img = coverImg(row);
    if (img?.getAttribute('src')) loaded.set(row.dataset.id, img);
  }
  for (const row of nextRows) {
    const fresh = coverImg(row);
    const kept = loaded.get(row.dataset.id);
    if (fresh && kept && kept !== fresh && coverSrc(kept) === coverSrc(fresh)) {
      loaded.delete(row.dataset.id);
      unwatchCover(fresh);
      fresh.replaceWith(kept);
    }
  }
}

export const coverLabel = (model, name) => `${model.verb} ${name}`;

export function touchOnly(mm = globalThis.matchMedia) {
  try {
    return !!mm?.('(hover: none)')?.matches;
  } catch {
    return false;
  }
}

export function coverAttrs(model, name, touch = false, extra = '') {
  const label = coverLabel(model, name);
  const cls = ['row-cover', extra, `act-${model.action}`, model.persistent ? 'persist' : ''].filter(Boolean).join(' ');
  return { cls, label, title: touch ? null : label, disabled: !!model.disabled };
}

// Re-paints an existing cover button (Now playing, mini-player) in place; keeps focus.
export function paintCover(btn, model, name, { touch = touchOnly(), size = 20, extra = '' } = {}) {
  const a = coverAttrs(model, name, touch, extra);
  btn.className = a.cls;
  btn.setAttribute('aria-label', a.label);
  if (a.title) btn.title = a.title; else btn.removeAttribute('title');
  btn.disabled = a.disabled;
  const ov = btn.querySelector('.rc-ov');
  if (ov) ov.replaceChildren(icon(model.icon, size));
}

// Cover of the current song: always the current song's play/pause state (a song without server audio is handled by player.toggle).
export const currentCoverModel = (playing) => coverModel({ audio: true, queueable: true, here: true, playing });

/** A queued song whose exact position is not worked out yet: its note says only "In the queue" until `showQueuePosition` fills it in. */
export const QUEUED_LAZY = Object.freeze({ pos: 0, total: 0 });

export const queueNote = (q) => {
  if (!q) return '';
  return q.pos ? `In the queue, position ${q.pos} of ${q.total}` : 'In the queue';
};

export function coverButton(img, model, name, { run, touch = touchOnly(), queued = null }) {
  const a = coverAttrs(model, name, touch);
  const note = queueNote(queued);
  const tip = note ? `${a.label}. ${note}` : a.title;
  return el('button', {
    class: note ? `${a.cls} queued` : a.cls, type: 'button', 'aria-label': a.label, 'aria-description': note || null, title: tip, disabled: a.disabled,
    'data-label': note ? a.label : null,
    onclick: () => run(model.action),
  }, el('span', { class: 'cover-mark', 'aria-hidden': 'true' }, icon('coverPlaceholder')), img, el('span', { class: 'rc-ov', 'aria-hidden': 'true' }, icon(model.icon, 20)));
}

/**
 * Writes the exact queue position into the tooltips of a row's queued controls (`pos` is `{ pos, total }` or null).
 * Rows are built with "In the queue" only, because the position of every row changes with each queue change and the note is needed only when the row is pointed at or focused.
 */
export function showQueuePosition(row, pos) {
  const note = queueNote(pos);
  const cover = row.querySelector('.row-cover.queued');
  if (cover && note) {
    const tip = `${cover.dataset.label}. ${note}`;
    if (cover.title !== tip) cover.title = tip;
    if (cover.getAttribute('aria-description') !== note) cover.setAttribute('aria-description', note);
  }
  const btn = row.querySelector('.act-queue.on');
  const btnTip = `${note}. Click to remove`;
  if (btn && note && btn.title !== btnTip) btn.title = btnTip;
}

// Cover button of a Now playing row: the current row follows play/pause, any other row starts that queue item.
export const queueCoverModel = (isCurrent, playing) => (isCurrent
  ? currentCoverModel(playing)
  : coverModel({ audio: true, queueable: true, here: false }));
