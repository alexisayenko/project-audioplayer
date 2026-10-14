import { el } from './dom.js';
import { canonicalCountry, countryName, isHistoricalCountry } from './countries.js';

const namers = {};
try {
  namers.country = new Intl.DisplayNames(['en'], { type: 'region' });
} catch { /* no Intl.DisplayNames: raw codes are shown */ }

const GROUP_NAMES = { decade: 'Decade', country: 'Country' };
const FIRST = ['genre', 'decade', 'country'];
const DECADE = /^\d{2}s$/;

export const isHiddenTag = (tag) => /^lang:/i.test(tag);
export const visibleTags = (tags) => (tags || []).filter((t) => !isHiddenTag(t));

export function splitTag(tag) {
  const i = tag.indexOf(':');
  return i > 0 ? { key: tag.slice(0, i), value: tag.slice(i + 1) } : { key: '', value: tag };
}

export function decadeTag(year) {
  return Number.isInteger(year) && year >= 1950 && year <= 2029 ? `decade:${String(year % 100 - (year % 10)).padStart(2, '0')}s` : null;
}

export function withDecade(tags, year) {
  const derived = decadeTag(year);
  if (!derived) return [...tags];
  const out = [];
  let placed = false;
  for (const t of tags) {
    if (/^decade:/i.test(t)) {
      if (!placed) out.push(derived);
      placed = true;
    } else out.push(t);
  }
  return placed ? out : [...out, derived];
}

export const decadeRank = (tag) => {
  const n = Number(splitTag(tag).value.slice(0, 2));
  if (Number.isNaN(n)) return 999;
  return n < 50 ? n + 100 : n;
};

export function valueLabel(key, value) {
  if (key === 'decade' && DECADE.test(value)) return `the ${value}`;
  const namer = namers[key];
  if (!namer) return value;
  try {
    const code = key === 'country' ? canonicalCountry(value) : null;
    if (key === 'country' && !code) return value;
    if (code && isHistoricalCountry(code)) return countryName(code);
    const name = namer.of(key === 'country' ? code.toUpperCase() : value);
    return name && name.toLocaleLowerCase() !== value.toLocaleLowerCase() ? name : value;
  } catch {
    return value;
  }
}

export function tagLabel(tag) {
  const { key, value } = splitTag(tag);
  return valueLabel(key, value);
}

export function tagText(tag) {
  const { key, value } = splitTag(tag);
  return key ? `${key}:${valueLabel(key, value)}` : tag;
}

export function tagSearchText(tag) {
  return `${tag}\n${tagLabel(tag)}`;
}

export function groupName(key) {
  return key ? GROUP_NAMES[key] || key[0].toLocaleUpperCase() + key.slice(1) : 'Tags';
}

export function canonicalTag(tag) {
  const { key, value } = splitTag(String(tag));
  if (key.toLowerCase() === 'country') {
    const code = canonicalCountry(value);
    return code ? `country:${code}` : tag;
  }
  return tag;
}

export function mergeTagCounts(tagCounts) {
  const merged = new Map();
  for (const t of tagCounts) {
    const tag = canonicalTag(t.tag);
    const e = merged.get(tag);
    if (e) e.count += t.count;
    else merged.set(tag, { ...t, tag });
  }
  return [...merged.values()];
}

export function tagGroups(tagCounts) {
  const groups = new Map();
  for (const t of mergeTagCounts(tagCounts)) {
    const { key } = splitTag(t.tag);
    groups.set(key, [...(groups.get(key) || []), t]);
  }
  const rank = (k) => {
    if (k === '') return 2;
    return FIRST.includes(k) ? 0 : 1;
  };
  const order = [...groups.keys()].sort((a, b) => rank(a) - rank(b)
    || (rank(a) === 0 ? FIRST.indexOf(a) - FIRST.indexOf(b) : a.localeCompare(b)));
  return order.map((key) => ({
    key,
    name: groupName(key),
    tags: groups.get(key).sort(key === 'decade'
      ? (a, b) => decadeRank(a.tag) - decadeRank(b.tag) || a.tag.localeCompare(b.tag)
      : (a, b) => tagLabel(a.tag).localeCompare(tagLabel(b.tag))),
  }));
}

export const CATEGORIES = [
  { id: 'tags', name: 'Tags', keys: null },
  { id: 'genres', name: 'Genres', keys: ['genre'] },
  { id: 'years', name: 'Years', keys: ['decade'] },
  { id: 'countries', name: 'Countries', keys: ['country'] },
];

export function categoryOf(tag) {
  const { key } = splitTag(tag);
  const k = key.toLocaleLowerCase();
  const hit = CATEGORIES.find((c) => c.keys?.includes(k));
  return hit ? hit.id : 'tags';
}

export function categoryTags(tagCounts, id) {
  const list = mergeTagCounts(tagCounts).filter((t) => categoryOf(t.tag) === id);
  return id === 'years'
    ? list.sort((a, b) => decadeRank(a.tag) - decadeRank(b.tag) || a.tag.localeCompare(b.tag))
    : list.sort((a, b) => b.count - a.count || tagLabel(a.tag).localeCompare(tagLabel(b.tag)));
}

export function tagChip(t) {
  const { key, value } = splitTag(t);
  return key
    ? el('span', { class: 'tag ns t-caption', title: t }, el('span', { class: 'ns-key' }, key), valueLabel(key, value))
    : el('span', { class: 'tag t-caption' }, t);
}
