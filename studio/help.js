import { el } from '../web/js/dom.js';
import { FEATURES, STATUS_LABELS, TASK_URL, groupFeatures } from '../web/js/studio-features.js';

export const REPO_URL = 'https://github.com/alexisayenko/project-audioplayer';
export const MAIN_URL = 'https://electrophone.cc/';
export const FEATURES_INTRO = 'What the Studio does today, what is being built and what is planned. Newest first.';
export const SECTIONS = [['in-progress', 'In progress'], ['planned', 'Planned'], ['released', 'Released']];

export const buildLine = (build) => (build && build.hash ? `Build ${build.hash}${build.date ? `, ${build.date}` : ''}.` : '');

const build = () => (typeof __STUDIO_BUILD__ === 'undefined' ? null : __STUDIO_BUILD__);

export function featureItem(f) {
  const meta = [el('span', { class: 'fx-area' }, f.area)];
  if (f.date) meta.push(el('time', { datetime: f.date }, f.date));
  if (f.task) meta.push(el('a', { class: 'fx-task', href: `${TASK_URL}${f.task}.md`, target: '_blank', rel: 'noopener' }, f.task));
  return el('li', { class: 'fx-item' },
    el('div', { class: 'fx-head' },
      el('span', { class: `fx-badge fx-${f.status}` }, STATUS_LABELS[f.status]),
      el('span', { class: 'fx-title' }, f.title)),
    ...(f.text ? [el('p', { class: 'fx-text' }, f.text)] : []),
    el('p', { class: 'fx-meta t-caption muted' }, ...meta));
}

export function featuresSections(list = FEATURES) {
  const groups = groupFeatures(list);
  const out = [];
  for (const [key, label] of SECTIONS) {
    if (key === 'released') {
      const count = groups.released.reduce((n, d) => n + d.items.length, 0);
      if (!count) continue;
      out.push(el('section', { class: 'fx-sec', 'aria-labelledby': 'fx-h-released' },
        el('h3', { class: 'fx-sec-h', id: 'fx-h-released' }, label, el('span', { class: 'fx-count' }, ` (${count})`)),
        ...groups.released.map((d) => el('section', { class: 'fx-day' },
          el('h4', { class: 'fx-day-h t-subhead' }, el('time', { datetime: d.date }, d.date)),
          el('ul', { class: 'fx-list' }, ...d.items.map(featureItem))))));
    } else if (groups[key].length) {
      out.push(el('section', { class: 'fx-sec', 'aria-labelledby': `fx-h-${key}` },
        el('h3', { class: 'fx-sec-h', id: `fx-h-${key}` }, label, el('span', { class: 'fx-count' }, ` (${groups[key].length})`)),
        el('ul', { class: 'fx-list' }, ...groups[key].map(featureItem))));
    }
  }
  return out;
}

export function mountFeatures(pane) {
  pane.replaceChildren(el('section', { class: 'card fx-card', 'aria-label': 'Features' },
    el('h2', { class: 't-headline' }, 'Features'),
    el('p', { class: 'hm-cap muted t-caption' }, FEATURES_INTRO),
    ...featuresSections()));
  return () => {};
}

const para = (...kids) => el('p', { class: 't-body' }, ...kids);
const block = (title, ...kids) => el('section', { class: 'hp-sec' }, el('h3', { class: 'fx-sec-h' }, title), ...kids);

export const PAGE_NOTES = [
  ['Primitive', 'One sine wave, one frequency, H1 only. Set frequency, amplitude and length, press Play, and see the wave on an oscilloscope.'],
  ['Chordophones', 'A harmonics lab for strings: choose the harmonics, their decay and the strike, and see the waveform, spectrum, spectrogram and beating.'],
  ['Aerophones, Membranophones, Idiophones', 'Placeholders for now; each says what is planned.'],
  ['Listen', 'The microphone as an instrument: level meter, waveform, spectrum with harmonic marks, spectrogram and Beat bands.'],
  ['Rhythm', 'The microphone as a tempo meter: a live BPM, the tempo per analysis window and the Beat bands with a tempo grid.'],
  ['Glossary', 'Plain-language definitions of the sound terms, as a list or as a map of how they connect.'],
];

export function mountHelp(pane) {
  pane.replaceChildren(el('section', { class: 'card hp-card', 'aria-label': 'Help' },
    el('h2', { class: 't-headline' }, 'Help'),
    el('p', { class: 'hm-cap muted t-caption' }, 'A short guide to the pages, the microphone and the keyboard.'),
    block('The pages', el('dl', { class: 'hp-pages' }, ...PAGE_NOTES.map(([t, d]) => el('div', {}, el('dt', {}, t), el('dd', { class: 't-body' }, d))))),
    block('The microphone',
      para('Listen and Rhythm ask for the microphone only after you press Start, and the browser asks for your permission. The sound is analysed in this browser; nothing is recorded, saved or uploaded. The microphone is released when you press Stop or leave the page.'),
      para('A level in dBFS is relative to digital full scale of the input. It is not a sound pressure level in dB SPL.')),
    block('Browsers',
      para('The tools use the Web Audio API, so they need a current browser on a computer or a phone. The microphone pages also need the microphone permission for this site.')),
    block('Keyboard',
      para('The menu, buttons, switches and links work with Tab, Enter and Space. On the Glossary map, Enter or Space selects a node.')),
    block('More',
      para('Look a term up in the ', el('a', { href: '#/glossary' }, 'Glossary'), '. Back to ', el('a', { href: MAIN_URL }, 'Electrophone'), ', the music player this site belongs to.'))));
  return () => {};
}

export function mountAbout(pane) {
  const line = buildLine(build());
  pane.replaceChildren(el('section', { class: 'card hp-card', 'aria-label': 'About' },
    el('h2', { class: 't-headline' }, 'About'),
    el('p', { class: 'hm-cap muted t-caption' }, 'Electrophone Studio by Alex Isayenko.'),
    block('What it is',
      para('A set of sound tools that run in your browser: a tone generator, a harmonics lab, a microphone analyzer, a rhythm meter and a glossary. It is the Analyze and Synthesize part of Electrophone, on a site of its own.')),
    block('Privacy',
      para('No sign-in, no cookies, no analytics and no data from a server: every page is a static file and the sound never leaves your device. The only thing the site remembers is whether the menu is collapsed, in this browser.')),
    block('Source',
      para('The code is on ', el('a', { href: REPO_URL, target: '_blank', rel: 'noopener' }, 'GitHub'), '. Back to ', el('a', { href: MAIN_URL }, 'Electrophone'), '.'),
      ...(line ? [el('p', { class: 'muted t-caption', id: 'hp-build' }, line)] : []))));
  return () => {};
}
