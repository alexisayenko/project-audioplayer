import { el } from '../web/js/dom.js';

export const PLACEHOLDERS = {
  'synthesize/aerophones': {
    title: 'Aerophones',
    task: 'task-0115',
    lines: [
      'Sound comes from a vibrating column of air in a pipe.',
      'An open pipe (flute-like) supports every harmonic: H1, H2, H3 and so on.',
      'A closed pipe (clarinet-like) supports only the odd ones: H1, H3, H5.',
      'The pipe sounds a little lower than its length suggests, because the air vibrates slightly beyond the open end (end correction).',
    ],
  },
  'synthesize/membranophones': {
    title: 'Membranophones',
    task: 'task-0116',
    lines: [
      'Sound comes from a stretched skin, as in a drum.',
      'The partials are not whole multiples of the base frequency. For an ideal circular membrane the ratios are 1, 1.59, 2.14, 2.30, 2.65 and 2.92 (zeros of Bessel functions).',
      'That is why drums have a less clear pitch than strings or pipes.',
    ],
  },
  'synthesize/idiophones': {
    title: 'Idiophones',
    task: 'task-0117',
    lines: [
      'Sound comes from the solid body of the instrument itself.',
      'A free bar (xylophone, marimba, vibraphone) has partials at about 1, 2.76, 5.40 and 8.93 times the base frequency.',
      'Bells and cymbals have many inharmonic partials, so they ring with a shimmer rather than a single clear pitch.',
    ],
  },
};

export function mountPlaceholder(pane, id) {
  const { title, task, lines } = PLACEHOLDERS[id];
  pane.replaceChildren(el('section', { class: 'card stu-soon' },
    el('h2', { class: 't-headline' }, title),
    ...lines.map((line) => el('p', { class: 't-subhead' }, line)),
    el('p', { class: 'muted t-caption' }, `Coming soon: see ${task}`)));
  return () => {};
}
