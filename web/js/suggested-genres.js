import { el } from './dom.js';
import { icon } from './icons.js';

const BADGES = {
  musicbrainz: { text: 'MusicBrainz', title: 'MusicBrainz' },
  wikipedia_song: { text: 'Wikipedia', title: 'Wikipedia song page' },
  wikipedia_artist: { text: 'Wikipedia', title: 'Wikipedia artist page' },
  discogs: { text: 'Discogs', title: 'Discogs' },
  youtube: { text: 'YouTube', title: 'YouTube or SoundCloud link' },
  original: { text: 'original', title: 'The original recording' },
  remixer: { text: 'remixer', title: 'The remixer\'s own genres' },
};

const REASONS = {
  single_source: 'Only one source named it',
  insufficient_agreement: 'Not enough sources agree',
  ambiguous_name: 'Ambiguous name, confirm it',
  no_shared_family: 'Does not fit the genres that agree',
  over_cap: 'More than five genres were found',
  original: 'Found for the original recording',
  remixer: 'Found for the remixer',
};

export const badgeFor = (source) => BADGES[source] || { text: String(source), title: String(source) };
export const reasonText = (reason) => REASONS[reason] || '';

const clean = (v) => String(v ?? '').trim().toLowerCase();

export function suggestedGenres(resp, have = []) {
  const taken = new Set(have.map((t) => String(t).toLowerCase()));
  const originals = Array.isArray(resp?.original_genres) ? resp.original_genres : [];
  const raw = Array.isArray(resp?.genre_suggestions)
    ? resp.genre_suggestions
    : originals
      .filter((t) => typeof t === 'string' && /^genre:\S/i.test(t))
      .map((t) => ({ genre: t.slice(t.indexOf(':') + 1), sources: ['original'], reason: 'original' }));
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    const genre = clean(item?.genre).replace(/^genre:/, '');
    if (!genre || seen.has(genre) || taken.has(`genre:${genre}`)) continue;
    seen.add(genre);
    const sources = Array.isArray(item.sources) ? item.sources.filter((s) => typeof s === 'string' && s) : [];
    out.push({ genre, sources, reason: typeof item.reason === 'string' ? item.reason : '' });
  }
  return out;
}

function badges(sources) {
  const seen = new Set();
  const out = [];
  for (const s of sources) {
    const b = badgeFor(s);
    if (seen.has(b.text)) continue;
    seen.add(b.text);
    const titles = sources.filter((x) => badgeFor(x).text === b.text).map((x) => badgeFor(x).title);
    out.push(el('small', { class: 'sg-badge', title: [...new Set(titles)].join(', ') }, b.text));
  }
  return out;
}

export function suggestedBox({ have = () => [], onPick }) {
  const list = el('div', { class: 'chips' });
  const node = el('div', { class: 'suggested-genres', hidden: true }, el('span', { class: 'group-name' }, 'Suggested genres'), list);
  let items = [];
  let shown = 0;
  const dismissed = new Set();
  const taken = () => new Set(have().map((t) => String(t).toLowerCase()));
  const render = () => {
    const mine = taken();
    const visible = items.filter((i) => !dismissed.has(i.genre) && !mine.has(`genre:${i.genre}`));
    list.replaceChildren(...visible.map((i) => {
      const why = reasonText(i.reason);
      const add = el('button', { class: 'sg-add', type: 'button', title: why ? `${why}. Click to add` : 'Click to add' }, i.genre);
      add.addEventListener('click', () => {
        items = items.filter((x) => x.genre !== i.genre);
        onPick(`genre:${i.genre}`);
        render();
      });
      const x = el('button', { class: 'x sg-dismiss', type: 'button', 'aria-label': `Dismiss ${i.genre}`, title: 'Dismiss' }, icon('clear', 'inline'));
      x.addEventListener('click', () => {
        dismissed.add(i.genre);
        render();
        list.querySelector?.('.sg-add')?.focus?.();
      });
      return el('span', { class: 'chip suggest' }, add, ...badges(i.sources), x);
    }));
    shown = visible.length;
    node.hidden = !visible.length;
  };
  return {
    node,
    set(next) {
      items = next.map((i) => ({ ...i }));
      render();
    },
    refresh: render,
    count: () => shown,
    clear() {
      items = [];
      render();
    },
    forget() {
      dismissed.clear();
      items = [];
      render();
    },
  };
}
