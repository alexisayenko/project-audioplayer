import { MIN_YEAR, maxYear } from './constants.js';
import { el, field } from './dom.js';
import { splitTokens, joinTokens } from './tokens.js';
import { displayLine, ofNames, byLabel } from './credits.js';
import { kindOf } from './credits-split.js';
import { OF_KINDS, ofLabel, lower, COVER_SUFFIX, creditSuggestions } from './credits-suggestions.js';
import { planVersionYear, validYear } from './remix-year.js';
import { normalizeVersion } from './version-norm.js';

export const KIND_LABELS = {
  remix: 'Remix',
  live: 'Live',
  acoustic: 'Acoustic',
  extended: 'Extended',
  instrumental: 'Instrumental',
  remaster: 'Remaster',
  edit: 'Edit',
  cover: 'Cover',
  mashup: 'Mashup',
  other: 'Other',
};

const SUGGESTED_TIP = 'Suggested from the YouTube or SoundCloud publish date; type a year to replace it';
const nameList = (v) => splitTokens(v);
const ORIGINAL_SPLIT = /(?<!\s)\s+(?:,|&|\band\b)\s*|(?:,|&|\band\b)\s*/i;

export const kindFor = kindOf;

function legacyVersion(song) {
  const remixer = String(song.remixer ?? '').trim();
  if (remixer) return { type: kindFor(remixer), name: remixer, artists: [], releaseYear: song.remix_year ?? null };
  if (song.remix_year != null) return { type: 'other', name: null, artists: [], releaseYear: song.remix_year };
  return null;
}

export function initialCredits(song = {}) {
  if (Array.isArray(song.mainArtists)) {
    return {
      mainArtists: song.mainArtists,
      featuredArtists: Array.isArray(song.featuredArtists) ? song.featuredArtists : [],
      withArtists: Array.isArray(song.withArtists) ? song.withArtists : [],
      version: song.version?.type ? song.version : legacyVersion(song),
      releaseYear: song.releaseYear ?? song.year ?? null,
    };
  }
  return { mainArtists: splitTokens(song.artist ?? ''), featuredArtists: [], withArtists: [], version: legacyVersion(song), releaseYear: song.year ?? null };
}

export function creditsBlock({ tg, song = {}, getTitle, setTitle, emit }) {
  const init = initialCredits(song);
  const iv = init.version;
  const year = (value) => el('input', { type: 'number', value: value ?? '', min: MIN_YEAR, max: maxYear() });
  const f = {
    artists: tg.field('artists', joinTokens(init.mainArtists)),
    featured: tg.field('featured', joinTokens(init.featuredArtists)),
    withs: tg.field('withs', joinTokens(init.withArtists)),
    by: tg.field('by', joinTokens(iv?.artists ?? [])),
    kind: el('select', { 'aria-label': 'Version' },
      el('option', { value: '' }, 'None'),
      ...Object.entries(KIND_LABELS).map(([k, label]) => el('option', { value: k }, label))),
    name: el('input', { type: 'text', value: iv?.name ?? '', autocomplete: 'off' }),
    vyear: year(iv?.releaseYear),
    of: tg.field('of', joinTokens(ofNames(iv?.originalArtists))),
    released: year(init.releaseYear),
  };
  f.kind.value = iv?.type ?? '';

  const preview = el('p', { class: 'credits-preview t-caption muted', role: 'status', 'aria-label': 'Preview' });
  const warn = el('p', { class: 't-caption credits-warn', role: 'status', hidden: true });
  const panel = el('div', { class: 'credits-suggest', hidden: true });
  f.name.addEventListener('change', () => {
    const fixed = normalizeVersion(f.name.value);
    if (fixed !== f.name.value) { f.name.value = fixed; f.name.dispatchEvent(new Event('input', { bubbles: true })); }
  });
  const nameField = field('Version name', f.name);
  const byField = field(byLabel(iv?.type), f.by);
  const yearField = field('Remix year', f.vyear);
  const ofField = field(ofLabel(iv?.type), f.of);
  const versionRow = el('div', { class: 'remix-row credits-version' }, field('Version', f.kind), nameField);
  const detailRow = el('div', { class: 'remix-row version-row' }, byField, yearField);

  let pubYear = validYear(song.published_year);
  const titleYear = validYear(song.version_year);
  let specYear = null;
  let auto = false;
  let touched = false;
  const hasVersion = () => f.kind.value !== '';
  const syncYear = () => {
    if (touched) return;
    const plan = planVersionYear({ kind: f.kind.value, name: f.name.value, current: f.vyear.value, auto, published: pubYear, specific: titleYear ?? specYear });
    auto = plan.auto;
    f.vyear.classList.toggle('suggested', auto);
    f.vyear.title = auto ? SUGGESTED_TIP : '';
    if (plan.value !== f.vyear.value) f.vyear.value = plan.value;
  };

  const current = () => ({
    mainArtists: nameList(f.artists.value),
    featuredArtists: nameList(f.featured.value),
    withArtists: nameList(f.withs.value),
    artists: nameList(f.by.value),
    type: f.kind.value,
    title: getTitle(),
  });

  const versionObject = () => (hasVersion()
    ? { type: f.kind.value, name: normalizeVersion(f.name.value.trim()) || null, artists: nameList(f.by.value), releaseYear: validYear(Number(f.vyear.value)), originalArtists: OF_KINDS.has(f.kind.value) ? nameList(f.of.value) : null }
    : null);

  const suggestions = creditSuggestions({ f, current, syncYear, setTitle, uploader: song.raw?.artist ?? '' });

  const paintPanel = () => {
    const list = suggestions.items();
    panel.hidden = !list.length;
    panel.replaceChildren();
    if (!list.length) return;
    panel.append(el('p', { class: 't-caption muted' }, 'Suggested split'));
    if (suggestions.ask()) panel.append(el('p', { class: 't-caption credits-warn' }, suggestions.ask()));
    for (const it of list) {
      const apply = el('button', { class: 'link-btn t-caption', type: 'button' }, 'Apply');
      const dismiss = el('button', { class: 'link-btn t-caption', type: 'button' }, 'Dismiss');
      apply.addEventListener('click', () => { it.apply(); emit(); });
      dismiss.addEventListener('click', () => { suggestions.dismiss(it.key); paint(); });
      panel.append(el('div', { class: 'credits-suggest-row t-caption' }, el('span', {}, it.text), apply, dismiss));
    }
  };

  const paintWarn = () => {
    const name = lower(f.name.value);
    const bad = name ? nameList(f.by.value).filter((n) => !name.includes(lower(n))) : [];
    warn.hidden = !bad.length;
    const quoted = bad.map((n) => `"${n}"`).join(', ');
    warn.textContent = bad.length ? `${quoted} not in the version name` : '';
  };

  const paintVisibility = () => {
    const on = hasVersion();
    nameField.hidden = !on;
    detailRow.hidden = !on;
    ofField.hidden = !OF_KINDS.has(f.kind.value);
    const label = ofLabel(f.kind.value);
    ofField.children[0].textContent = label;
    f.of.setLabel(label);
    const by = byLabel(f.kind.value);
    byField.children[0].textContent = by;
    f.by.setLabel(by);
  };

  function paint() {
    paintVisibility();
    const cur = current();
    const line = displayLine({ title: cur.title, mainArtists: cur.mainArtists, featuredArtists: cur.featuredArtists, withArtists: cur.withArtists, version: versionObject() || undefined });
    preview.textContent = line;
    preview.hidden = !line;
    paintWarn();
    paintPanel();
  }

  f.kind.addEventListener('change', () => f.kind.dispatchEvent(new Event('input', { bubbles: true })));
  f.kind.addEventListener('input', () => { syncYear(); paint(); });
  f.vyear.addEventListener('input', () => {
    touched = true;
    auto = false;
    f.vyear.classList.remove('suggested');
    f.vyear.title = '';
  });
  const repaint = () => paint();
  for (const k of ['artists', 'featured', 'withs', 'by', 'name', 'of', 'vyear']) f[k].addEventListener('input', repaint);

  const node = el('div', { class: 'credits-block' },
    field('Artists', f.artists), field('Featuring', f.featured), field('With', f.withs),
    versionRow, detailRow, ofField, warn, preview, panel);
  syncYear();
  paint();

  return {
    node,
    f,
    paint,
    values: () => ({
      mainArtists: nameList(f.artists.value),
      featuredArtists: nameList(f.featured.value),
      withArtists: nameList(f.withs.value),
      releaseYear: f.released.value,
      version: hasVersion()
        ? { type: f.kind.value, name: normalizeVersion(f.name.value), artists: nameList(f.by.value), releaseYear: f.vyear.value, ...(OF_KINDS.has(f.kind.value) ? { originalArtists: nameList(f.of.value) } : {}) }
        : null,
    }),
    set(p = {}) {
      const has = (k) => p[k] !== undefined;
      if (has('mainArtists')) f.artists.value = joinTokens(p.mainArtists ?? []);
      else if (has('artist')) f.artists.value = p.artist ?? '';
      if (has('featuredArtists')) f.featured.value = joinTokens(p.featuredArtists ?? []);
      if (has('withArtists')) f.withs.value = joinTokens(p.withArtists ?? []);
      if (has('releaseYear')) f.released.value = p.releaseYear ?? '';
      else if (has('year')) f.released.value = p.year ?? '';
      let yearSet = false;
      if (has('version')) {
        const v = p.version;
        f.kind.value = v?.type ?? '';
        f.name.value = v?.name ?? '';
        f.by.value = joinTokens(v?.artists ?? []);
        f.of.value = joinTokens(ofNames(v?.originalArtists));
        f.vyear.value = v?.releaseYear ?? '';
        yearSet = true;
      } else if (has('remixer')) {
        const text = String(p.remixer ?? '').trim();
        f.name.value = text;
        f.kind.value = text ? (f.kind.value || kindFor(text)) : '';
      }
      if (!yearSet && has('remix_year')) {
        f.vyear.value = p.remix_year ?? '';
        yearSet = true;
      }
      if (yearSet) {
        auto = false;
        f.vyear.classList.remove('suggested');
        f.vyear.title = '';
      }
      suggestions.reset();
      paint();
    },
    setOriginal(artist) {
      suggestions.setOriginal(typeof artist === 'string' ? splitTokens(artist).flatMap((a) => a.split(ORIGINAL_SPLIT)).filter(Boolean) : []);
      paint();
    },
    setPublished(y) {
      const v = validYear(y);
      if (v != null) pubYear = v;
    },
    setSpecific(y) {
      specYear = validYear(y);
      syncYear();
    },
    resetYear(y) {
      pubYear = validYear(y);
      specYear = null;
      touched = false;
      syncYear();
    },
    hasVersion,
    versionObject,
    syncYear,
  };
}
export const PATTERNS = { COVER_SUFFIX, ORIGINAL_SPLIT };
