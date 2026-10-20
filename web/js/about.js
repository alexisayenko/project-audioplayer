import { el } from './dom.js';

const DOCS = 'https://github.com/alexisayenko/project-audioplayer/blob/main/docs/tech/';

export const ABOUT = {
  title: 'About',
  intro: 'Electrophone is a personal music library: songs the owner picks, kept so they play reliably, offline, with the screen locked. The web UI is open to anyone with a Google or Apple sign-in, and each user gets their own library.',
  genres: {
    heading: 'How genres are organised',
    text: 'Genres are social categories, and there is no official standard. We do not claim one. The model here is consistent for one library, and the documentation says where each decision came from. Genres work like colour names: everyone agrees on the centre of green, but nobody can say exactly where blue turns into green, so a genre has a clear centre and a soft border. A song is described along four axes.',
    table: {
      caption: 'The four axes',
      note: 'Mood stays personal: it is how a song feels to you, so it is not shared vocabulary.',
      head: ['Axis', 'Question', 'Examples'],
      rows: [
        ['Form', 'Which style is it? (the genre tree)', 'house, rock, synthpop'],
        ['Medium', 'How is it made?', 'acoustic, electronic'],
        ['Purpose', 'What is it for?', 'dance, film score'],
        ['Tradition', 'Which tradition or scene?', 'Western, Latin, Berlin, Italo'],
      ],
    },
  },
  kinds: {
    heading: 'Genres, groups and modifiers',
    items: [
      'A genre is a style you can assign to a song, such as house, rock or synthpop.',
      'A group such as Others (a temporary one) only organises genres and is never assigned to a song.',
      'A modifier such as dark, progressive or hardcore qualifies a genre and is never a genre alone.',
      'A bare word that two styles share carries a qualifier: hardcore punk and hardcore techno.',
    ],
  },
  examples: {
    heading: 'Examples',
    items: [
      'Techno-pop is another name for synthpop and has nothing to do with techno music.',
      'Witch house is not a kind of house; it is filed under experimental.',
      'Italo disco is a genre because its sound stays when you drop the place name.',
      'Electronic is a medium, not a genre: you say "a house track", never "an electronic genre".',
    ],
  },
  more: {
    heading: 'Read more',
    text: 'The full reasoning is in the documentation. The model is still being refined.',
    links: [
      ['Genre terminology and the genre model', `${DOCS}genre-terminology.md`],
      ['Decision log (ADR-0038: the genre model)', `${DOCS}decisions.md`],
    ],
  },
};

const p = (text) => el('p', { class: 'ab-text t-body' }, text);
const list = (items) => el('ul', { class: 'ab-list' }, ...items.map((t) => el('li', { class: 'ab-item t-body' }, t)));

function axesTable(t) {
  return el('div', { class: 'ab-tablewrap', role: 'region', 'aria-label': t.caption, tabindex: '0' },
    el('table', { class: 'ab-table' },
      el('caption', { class: 'ab-caption t-caption' }, t.caption),
      el('thead', {}, el('tr', {}, ...t.head.map((h) => el('th', { scope: 'col' }, h)))),
      el('tbody', {}, ...t.rows.map(([a, ...rest]) =>
        el('tr', {}, el('th', { scope: 'row' }, a), ...rest.map((c) => el('td', {}, c)))))));
}

export function renderAbout(root, data = ABOUT) {
  const { genres, kinds, examples, more } = data;
  root.append(
    el('header', { class: 'page-head' }, el('p', { class: 't-eyebrow' }, 'ELECTROPHONE'), el('h1', { class: 't-display' }, data.title)),
    el('article', { class: 'ab' },
      p(data.intro),
      el('section', { class: 'ab-sec' }, el('h2', { class: 't-title' }, genres.heading), p(genres.text), axesTable(genres.table), p(genres.table.note)),
      el('section', { class: 'ab-sec' }, el('h2', { class: 't-title' }, kinds.heading), list(kinds.items)),
      el('section', { class: 'ab-sec' }, el('h2', { class: 't-title' }, examples.heading), list(examples.items)),
      el('section', { class: 'ab-sec' }, el('h2', { class: 't-title' }, more.heading), p(more.text),
        el('ul', { class: 'ab-list' }, ...more.links.map(([label, href]) =>
          el('li', { class: 'ab-item t-body' }, el('a', { href, target: '_blank', rel: 'noopener' }, label)))))));
}
