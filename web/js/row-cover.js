import { el } from './dom.js';
import { icon } from './icons.js';

const ACTIONS = {
  pause: { icon: 'pause', verb: 'Pause' },
  resume: { icon: 'play', verb: 'Play' },
  play: { icon: 'play', verb: 'Play' },
  download: { icon: 'download', verb: 'Download' },
  none: { icon: 'play', verb: 'Play' },
};

// What the cover button of a Library row does and shows. `dl` is the autodl view kind of a song without server audio.
export function coverModel({ audio, queueable, here, playing, dl = 'none' }) {
  if (audio && here) {
    const action = playing ? 'pause' : 'resume';
    return { action, persistent: true, ...ACTIONS[action] };
  }
  if (queueable) return { action: 'play', persistent: false, ...ACTIONS.play };
  if (!audio && (dl === 'none' || dl === 'failed')) return { action: 'download', persistent: false, ...ACTIONS.download };
  return { action: 'none', persistent: false, disabled: true, ...ACTIONS.none };
}

export const isRowControl = (target) => !!target?.closest?.('a, button:not(.open)');

export const coverLabel = (model, name) => `${model.verb} ${name}`;

export function touchOnly(mm = globalThis.matchMedia) {
  try {
    return !!mm?.('(hover: none)')?.matches;
  } catch {
    return false;
  }
}

export function coverButton(img, model, name, { run, touch = touchOnly() }) {
  const label = coverLabel(model, name);
  const cls = ['row-cover', `act-${model.action}`, model.persistent ? 'persist' : ''].filter(Boolean).join(' ');
  return el('button', {
    class: cls, type: 'button', 'aria-label': label, title: touch ? null : label, disabled: !!model.disabled,
    onclick: () => run(model.action),
  }, img, el('span', { class: 'rc-ov', 'aria-hidden': 'true' }, icon(model.icon, 20)));
}
