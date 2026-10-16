import { MIN_YEAR, maxYear } from './constants.js';
import { el, field } from './dom.js';
import { splitTokens, joinTokens } from './tokens.js';
import { displayLine, ofNames } from './credits.js';
import { suggest } from './credits-split.js';
import { planVersionYear, validYear } from './remix-year.js';

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
const lower = (s) => String(s ?? '').trim().toLowerCase();
const nameList = (v) => splitTokens(v);
const OF_KINDS = ['cover', 'mashup'];
const ofLabel = (kind) => (kind === 'mashup' ? 'Mashup of' : 'Cover of');
const MAKERS_ASK = 'Who made this mashup? Confirm or edit Artists; sources go in Mashup of.';
const COVER_ASK = 'Who performs this cover? Pick the reading that matches; the usual one is listed first.';

export const kindFor = (text) => (/mixed\s+by/i.test(text) && !/remix|mashup/i.test(text) ? 'other' : 'remix');

export function initialCredits(song = {}) {
  if (Array.isArray(song.mainArtists)) {
    return {
      mainArtists: song.mainArtists,
      featuredArtists: Array.isArray(song.featuredArtists) ? song.featuredArtists : [],
      version: song.version && song.version.type ? song.version : null,
      releaseYear: song.releaseYear ?? null,
    };
  }
  const remixer = String(song.remixer ?? '').trim();
  let version = null;
  if (remixer) version = { type: kindFor(remixer), name: remixer, artists: [], releaseYear: song.remix_year ?? null };
  else if (song.remix_year != null) version = { type: 'other', name: null, artists: [], releaseYear: song.remix_year };
  return { mainArtists: splitTokens(song.artist ?? ''), featuredArtists: [], version, releaseYear: song.year ?? null };
}

const sameList = (a, b) => a.length === b.length && a.every((n, i) => n === b[i]);
const missing = (have, want) => want.filter((n) => !have.some((h) => lower(h) === lower(n)));

export function creditsBlock({ tg, song = {}, getTitle, setTitle, emit }) {
  const init = initialCredits(song);
  const iv = init.version;
  const year = (value) => el('input', { type: 'number', value: value ?? '', min: MIN_YEAR, max: maxYear() });
  const f = {
    artists: tg.field('artists', joinTokens(init.mainArtists)),
    featured: tg.field('featured', joinTokens(init.featuredArtists)),
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
  const nameField = field('Version name', f.name);
  const byField = field('Remixed / mixed by', f.by);
  const yearField = field('Version year', f.vyear);
  const ofField = field(ofLabel(iv?.type), f.of);
  const versionRow = el('div', { class: 'remix-row credits-version' }, field('Version', f.kind), nameField);
  const detailRow = el('div', { class: 'remix-row version-row' }, byField, yearField);

  let pubYear = validYear(song.published_year);
  let specYear = null;
  let auto = false;
  let touched = false;
  const dismissed = new Set();

  const hasVersion = () => f.kind.value !== '';
  const syncYear = () => {
    if (touched) return;
    const plan = planVersionYear({ kind: f.kind.value, name: f.name.value, current: f.vyear.value, auto, published: pubYear, specific: specYear });
    auto = plan.auto;
    f.vyear.classList.toggle('suggested', auto);
    f.vyear.title = auto ? SUGGESTED_TIP : '';
    if (plan.value !== f.vyear.value) f.vyear.value = plan.value;
  };

  const current = () => ({
    mainArtists: nameList(f.artists.value),
    featuredArtists: nameList(f.featured.value),
    artists: nameList(f.by.value),
    type: f.kind.value,
    title: getTitle(),
  });

  const versionObject = () => (hasVersion()
    ? { type: f.kind.value, name: f.name.value.trim() || null, artists: nameList(f.by.value), releaseYear: validYear(Number(f.vyear.value)), originalArtists: OF_KINDS.includes(f.kind.value) ? nameList(f.of.value) : null }
    : null);

  let ask = '';
  let knownOriginal = [];
  const readingRow = (r, i, cur) => {
    const v = r.version;
    return {
      key: `reading:${i}:${r.artists.join('|')}:${(v.of ?? []).join('|')}`,
      text: `Reading ${i + 1}: Artists ${r.artists.join(' | ')}, ${ofLabel(v.kind)} ${v.of.join(', ')}, Title ${r.title}`,
      apply: () => {
        f.artists.value = joinTokens(r.artists);
        if (r.title && r.title !== cur.title.trim()) setTitle(r.title);
        f.kind.value = v.kind;
        syncYear();
        if (!f.name.value.trim() && v.name) f.name.value = v.name;
        f.of.value = joinTokens(v.of);
      },
    };
  };
  const items = () => {
    const cur = current();
    const s = suggest(f.artists.value, cur.title, f.name.value, { uploader: song.raw?.artist ?? '', original: knownOriginal });
    ask = s.notes.includes('mashup_makers_unknown') ? MAKERS_ASK : '';
    if (s.alternatives) {
      ask = COVER_ASK;
      return s.alternatives.map((r, i) => readingRow(r, i, cur)).filter((i) => !dismissed.has(i.key));
    }
    const out = [];
    if (s.mainArtists.length && !sameList(s.mainArtists, cur.mainArtists)) out.push({ key: `artists:${s.mainArtists.join('|')}`, text: `Artists: ${s.mainArtists.join(' | ')}`, apply: () => { f.artists.value = joinTokens(s.mainArtists); } });
    const newFeat = missing(cur.featuredArtists, s.featuredArtists);
    if (newFeat.length) out.push({ key: `featured:${newFeat.join('|')}`, text: `Featuring: ${newFeat.join(' | ')}`, apply: () => { f.featured.value = joinTokens([...cur.featuredArtists, ...newFeat]); } });
    if (s.title && s.title !== cur.title.trim()) out.push({ key: `title:${s.title}`, text: `Title: ${s.title}`, apply: () => setTitle(s.title) });
    if (s.version) {
      const v = s.version;
      const newBy = missing(cur.artists, v.artists);
      const newName = !f.name.value.trim() && v.name ? v.name : '';
      if (newBy.length || newName || !cur.type) {
        const parts = [];
        if (!cur.type) parts.push(v.type);
        if (newName) parts.push(`"${newName}"`);
        if (newBy.length) parts.push(`by ${newBy.join(' | ')}`);
        if (OF_KINDS.includes(v.type) && v.originalArtists?.length) parts.push(`${ofLabel(v.type)} ${v.originalArtists.join(', ')}`);
        else if (v.type === 'cover' && s.notes.includes('cover_performer')) parts.push(`Cover performed by ${v.name.replace(/[\s,:-]*\bcover(?:\s+version)?\s*$/i, '').trim()}`);
        out.push({
          key: `version:${v.type}:${newName}:${newBy.join('|')}`,
          text: `Version: ${parts.join(', ')}`,
          apply: () => {
            if (!cur.type) { f.kind.value = v.type; syncYear(); }
            if (newName) f.name.value = newName;
            if (newBy.length) f.by.value = joinTokens([...cur.artists, ...newBy]);
            if (OF_KINDS.includes(v.type) && v.originalArtists?.length && !f.of.value.trim()) f.of.value = joinTokens(v.originalArtists);
          },
        });
      }
    }
    return out.filter((i) => !dismissed.has(i.key));
  };

  const paintPanel = () => {
    const list = items();
    panel.hidden = !list.length;
    panel.replaceChildren();
    if (!list.length) return;
    panel.append(el('p', { class: 't-caption muted' }, 'Suggested split'));
    if (ask) panel.append(el('p', { class: 't-caption credits-warn' }, ask));
    for (const it of list) {
      const apply = el('button', { class: 'link-btn t-caption', type: 'button' }, 'Apply');
      const dismiss = el('button', { class: 'link-btn t-caption', type: 'button' }, 'Dismiss');
      apply.addEventListener('click', () => { it.apply(); emit(); });
      dismiss.addEventListener('click', () => { dismissed.add(it.key); paint(); });
      panel.append(el('div', { class: 'credits-suggest-row t-caption' }, el('span', {}, it.text), apply, dismiss));
    }
  };

  const paintWarn = () => {
    const name = lower(f.name.value);
    const bad = name ? nameList(f.by.value).filter((n) => !name.includes(lower(n))) : [];
    warn.hidden = !bad.length;
    warn.textContent = bad.length ? `${bad.map((n) => `"${n}"`).join(', ')} not in the version name` : '';
  };

  const paintVisibility = () => {
    const on = hasVersion();
    nameField.hidden = !on;
    detailRow.hidden = !on;
    ofField.hidden = !OF_KINDS.includes(f.kind.value);
    const label = ofLabel(f.kind.value);
    ofField.children[0].textContent = label;
    f.of.setLabel(label);
  };

  function paint() {
    paintVisibility();
    const cur = current();
    const line = displayLine({ title: cur.title, mainArtists: cur.mainArtists, featuredArtists: cur.featuredArtists, version: versionObject() || undefined });
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
  for (const k of ['artists', 'featured', 'by', 'name', 'of', 'vyear']) f[k].addEventListener('input', repaint);

  const node = el('div', { class: 'credits-block' },
    field('Artists', f.artists), field('Featuring', f.featured),
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
      releaseYear: f.released.value,
      version: hasVersion()
        ? { type: f.kind.value, name: f.name.value, artists: nameList(f.by.value), releaseYear: f.vyear.value, ...(OF_KINDS.includes(f.kind.value) ? { originalArtists: nameList(f.of.value) } : {}) }
        : null,
    }),
    set(p = {}) {
      const has = (k) => p[k] !== undefined;
      if (has('mainArtists')) f.artists.value = joinTokens(p.mainArtists ?? []);
      else if (has('artist')) f.artists.value = p.artist ?? '';
      if (has('featuredArtists')) f.featured.value = joinTokens(p.featuredArtists ?? []);
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
      dismissed.clear();
      paint();
    },
    setOriginal(artist) {
      knownOriginal = typeof artist === 'string' ? splitTokens(artist).flatMap((a) => a.split(/\s*(?:,|&|\band\b)\s*/i)).filter(Boolean) : [];
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
