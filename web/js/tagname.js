import { el } from './dom.js';

const namers = {};
try {
  namers.country = new Intl.DisplayNames(['en'], { type: 'region' });
  namers.lang = new Intl.DisplayNames(['en'], { type: 'language' });
} catch { /* no Intl.DisplayNames: raw codes are shown */ }

const GROUP_NAMES = { country: 'Country', lang: 'Language' };
const FIRST = ['genre', 'country', 'lang'];

export function splitTag(tag) {
  const i = tag.indexOf(':');
  return i > 0 ? { key: tag.slice(0, i), value: tag.slice(i + 1) } : { key: '', value: tag };
}

export function valueLabel(key, value) {
  const namer = namers[key];
  if (!namer) return value;
  try {
    const name = namer.of(key === 'country' ? value.toUpperCase() : value);
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

export function tagGroups(tagCounts) {
  const groups = new Map();
  for (const t of tagCounts) {
    const { key } = splitTag(t.tag);
    groups.set(key, [...(groups.get(key) || []), t]);
  }
  const rank = (k) => (k === '' ? 2 : FIRST.includes(k) ? 0 : 1);
  const order = [...groups.keys()].sort((a, b) => rank(a) - rank(b)
    || (rank(a) === 0 ? FIRST.indexOf(a) - FIRST.indexOf(b) : a.localeCompare(b)));
  return order.map((key) => ({
    key,
    name: groupName(key),
    tags: groups.get(key).sort((a, b) => tagLabel(a.tag).localeCompare(tagLabel(b.tag))),
  }));
}

export function tagChip(t) {
  const { key, value } = splitTag(t);
  return key
    ? el('span', { class: 'tag ns', title: t }, el('span', { class: 'ns-key' }, key), valueLabel(key, value))
    : el('span', { class: 'tag' }, t);
}
