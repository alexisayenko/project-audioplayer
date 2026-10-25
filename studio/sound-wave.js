import { el } from '../web/js/dom.js';
import { createConeAnimation, WAVES, WAVE_DEFAULT, DEFAULT_FREQ, DEFAULT_AMP } from '../web/js/cone-animation.js';
import { termById } from '../web/js/glossary-terms.js';
import { queryFromHash } from './routes.js';

export const TITLE = 'Sound wave';
export const INTRO = 'See how a vibrating speaker cone squeezes the air into a sound wave: compression (red) and rarefaction, slowed down so you can watch.';
export const READ_TITLE = 'How to read this';
export const READ_ITEMS = [
  'The dots are the air in front of the speaker cone. Each dot is a bit of air that only swings a little back and forth; the wave travels, the air does not.',
  'Red dots are a compression: air squeezed closer than at rest (high pressure). Teal dots are at rest or spread thinner (rarefaction, low pressure).',
  'The curve above the dots is the air density along the path, right now: above the dashed line the air is denser than at rest, below it thinner.',
  'One cycle in time is one wavelength in space: one dense bunch and one thin gap are one cycle of the wave, and the pattern moves away from the cone.',
  'In this plane-wave picture the pressure follows the cone\'s speed, not its position: the air is squeezed hardest when the cone moves forward fastest. The spacing is schematic.',
  'The slow motion factor stretches time so you can watch: at 2000x a real 440 Hz tone is a swing about every 4.5 seconds.',
];
export const RELATED_TITLE = 'Related terms';
export const RELATED_IDS = ['sound-wave', 'compression-and-rarefaction', 'wavelength', 'speed-of-sound', 'frequency', 'amplitude', 'sine-wave', 'triangle-wave', 'square-wave', 'sawtooth-wave'];

export function paramsFromHash(hash) {
  const q = queryFromHash(hash);
  const wave = q.get('wave')?.toLowerCase();
  const raw = q.get('freq');
  const freq = raw === null || raw.trim() === '' ? NaN : Number(raw);
  return { wave: WAVES.includes(wave) ? wave : undefined, freq: Number.isFinite(freq) ? freq : undefined };
}

export function mountSoundWave(pane, win = globalThis) {
  const first = paramsFromHash(win.location.hash);
  const anim = createConeAnimation({ frequency: first.freq ?? DEFAULT_FREQ, amplitude: DEFAULT_AMP, wave: first.wave ?? WAVE_DEFAULT });
  const related = RELATED_IDS.map((id) => el('a', { href: `#/glossary/${id}` }, termById(id).term));

  const onHash = () => {
    const p = paramsFromHash(win.location.hash);
    if (p.wave) anim.setWave(p.wave);
    if (p.freq !== undefined) anim.setFrequency(p.freq);
  };

  pane.replaceChildren(el('section', { class: 'card sw-card', 'aria-label': TITLE },
    el('h2', { class: 't-headline' }, TITLE),
    el('p', { class: 'hm-cap muted t-caption' }, INTRO),
    anim.node,
    el('section', { class: 'hp-sec', 'aria-labelledby': 'sw-read-h' },
      el('h3', { class: 'fx-sec-h', id: 'sw-read-h' }, READ_TITLE),
      el('ul', { class: 'sw-read t-body' }, ...READ_ITEMS.map((t) => el('li', {}, t)))),
    el('section', { class: 'hp-sec', 'aria-labelledby': 'sw-rel-h' },
      el('h3', { class: 'fx-sec-h', id: 'sw-rel-h' }, RELATED_TITLE),
      el('p', { class: 'gl-more t-caption sw-related' }, ...related))));
  win.addEventListener('hashchange', onHash);
  return () => {
    win.removeEventListener('hashchange', onHash);
    anim.destroy();
  };
}
