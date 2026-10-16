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

export const kindFor = (text) => (/mixed\s+by/i.test(text) && !/remix|mashup/i.test(text) ? 'other' : 'remix');

export function initialCredits(song = {}) {
  if (Array.isArray(song.artists)) {
    return {
      artists: song.artists,
      featured: Array.isArray(song.featured) ? song.featured : [],
      version: song.version && song.version.kind ? song.version : null,
      released: song.released ?? null,
    };
  }
  const remixer = String(song.remixer ?? '').trim();
  let version = null;
  if (remixer) version = { kind: kindFor(remixer), name: remixer, by: [], year: song.remix_year ?? null };
  else if (song.remix_year != null) version = { kind: 'other', name: null, by: [], year: song.remix_year };
  return { artists: splitTokens(song.artist ?? ''), featured: [], version, released: song.year ?? null };
}

const sameList = (a, b) => a.length === b.length && a.every((n, i) => n === b[i]);
const missing = (have, want) => want.filter((n) => !have.some((h) => lower(h) === lower(n)));

export function creditsBlock({ tg, song = {}, getTitle, setTitle, emit }) {
  const init = initialCredits(song);
  const iv = init.version;
  const year = (value) => el('input', { type: 'number', value: value ?? '', min: MIN_YEAR, max: maxYear() });
  const f = {
    artists: tg.field('artists', joinTokens(init.artists)),
    featured: tg.field('featured', joinTokens(init.featured)),
    by: tg.field('by', joinTokens(iv?.by ?? [])),
    kind: el('select', { 'aria-label': 'Version' },
      el('option', { value: '' }, 'None'),
      ...Object.entries(KIND_LABELS).map(([k, label]) => el('option', { value: k }, label))),
    name: el('input', { type: 'text', value: iv?.name ?? '', autocomplete: 'off' }),
    vyear: year(iv?.year),
    of: tg.field('of', joinTokens(ofNames(iv?.of))),
    released: year(init.released),
  };
  f.kind.value = iv?.kind ?? '';

  const preview = el('p', { class: 'credits-preview t-caption muted', role: 'status', 'aria-label': 'Preview' });
  const warn = el('p', { class: 't-caption credits-warn', role: 'status', hidden: true });
  const panel = el('div', { class: 'credits-suggest', hidden: true });
  const nameField = field('Version name', f.name);
  const byField = field('Remixed / mixed by', f.by);
  const yearField = field('Version year', f.vyear);
  const ofField = field(ofLabel(iv?.kind), f.of);
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
    artists: nameList(f.artists.value),
    featured: nameList(f.featured.value),
    by: nameList(f.by.value),
    kind: f.kind.value,
    title: getTitle(),
  });

  const versionObject = () => (hasVersion()
    ? { kind: f.kind.value, name: f.name.value.trim() || null, by: nameList(f.by.value), year: validYear(Number(f.vyear.value)), of: OF_KINDS.includes(f.kind.value) ? nameList(f.of.value) : null }
    : null);

  let ask = false;
  const items = () => {
    const cur = current();
    const s = suggest(f.artists.value, cur.title, f.name.value);
    ask = s.notes.includes('mashup_makers_unknown');
    const out = [];
    if (s.artists.length && !sameList(s.artists, cur.artists)) out.push({ key: `artists:${s.artists.join('|')}`, text: `Artists: ${s.artists.join(' | ')}`, apply: () => { f.artists.value = joinTokens(s.artists); } });
    const newFeat = missing(cur.featured, s.featured);
    if (newFeat.length) out.push({ key: `featured:${newFeat.join('|')}`, text: `Featuring: ${newFeat.join(' | ')}`, apply: () => { f.featured.value = joinTokens([...cur.featured, ...newFeat]); } });
    if (s.title && s.title !== cur.title.trim()) out.push({ key: `title:${s.title}`, text: `Title: ${s.title}`, apply: () => setTitle(s.title) });
    if (s.version) {
      const v = s.version;
      const newBy = missing(cur.by, v.by);
      const newName = !f.name.value.trim() && v.name ? v.name : '';
      if (newBy.length || newName || !cur.kind) {
        const parts = [];
        if (!cur.kind) parts.push(v.kind);
        if (newName) parts.push(`"${newName}"`);
        if (newBy.length) parts.push(`by ${newBy.join(' | ')}`);
        if (OF_KINDS.includes(v.kind) && v.of?.length) parts.push(`${ofLabel(v.kind)} ${v.of.join(', ')}`);
        else if (v.kind === 'cover' && s.notes.includes('cover_performer')) parts.push(`Cover performed by ${v.name.replace(/[\s,:-]*\bcover(?:\s+version)?\s*$/i, '').trim()}`);
        out.push({
          key: `version:${v.kind}:${newName}:${newBy.join('|')}`,
          text: `Version: ${parts.join(', ')}`,
          apply: () => {
            if (!cur.kind) { f.kind.value = v.kind; syncYear(); }
            if (newName) f.name.value = newName;
            if (newBy.length) f.by.value = joinTokens([...cur.by, ...newBy]);
            if (OF_KINDS.includes(v.kind) && v.of?.length && !f.of.value.trim()) f.of.value = joinTokens(v.of);
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
    if (ask) panel.append(el('p', { class: 't-caption credits-warn' }, MAKERS_ASK));
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
    const line = displayLine({ title: cur.title, artists: cur.artists, featured: cur.featured, version: versionObject() || undefined });
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
      artists: nameList(f.artists.value),
      featured: nameList(f.featured.value),
      released: f.released.value,
      version: hasVersion()
        ? { kind: f.kind.value, name: f.name.value, by: nameList(f.by.value), year: f.vyear.value, ...(OF_KINDS.includes(f.kind.value) ? { of: nameList(f.of.value) } : {}) }
        : null,
    }),
    set(p = {}) {
      const has = (k) => p[k] !== undefined;
      if (has('artists')) f.artists.value = joinTokens(p.artists ?? []);
      else if (has('artist')) f.artists.value = p.artist ?? '';
      if (has('featured')) f.featured.value = joinTokens(p.featured ?? []);
      if (has('released')) f.released.value = p.released ?? '';
      else if (has('year')) f.released.value = p.year ?? '';
      let yearSet = false;
      if (has('version')) {
        const v = p.version;
        f.kind.value = v?.kind ?? '';
        f.name.value = v?.name ?? '';
        f.by.value = joinTokens(v?.by ?? []);
        f.of.value = joinTokens(ofNames(v?.of));
        f.vyear.value = v?.year ?? '';
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
