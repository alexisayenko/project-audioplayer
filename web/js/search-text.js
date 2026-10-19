import { searchText, ofNames } from './credits.js';

const text = (v) => String(v ?? '').trim();
const names = (list) => (Array.isArray(list) ? list.map(text).filter(Boolean) : []);

export function versionSearchParts(song) {
  const v = song?.version;
  if (!v || typeof v !== 'object') return [];
  return [text(v.name), text(v.type ?? v.kind), ...names(v.by ?? v.artists), ...ofNames(v.of ?? v.originalArtists)].filter(Boolean);
}

export function songSearchText(song, extra = []) {
  return searchText(song, [...versionSearchParts(song), ...extra]);
}
