import { readFileSync } from 'node:fs';

export function realVocab() {
  const file = JSON.parse(readFileSync(new URL('../../server/data/genre_levels.json', import.meta.url), 'utf8'));
  const { _meta, families, modifiers, subfamilies, ...levels } = file;
  void _meta;
  void subfamilies;
  const entries = Object.entries(families);
  return {
    families: Object.keys(families), genres: [], aliases: {}, levels, modifiers,
    family_synonyms: Object.fromEntries(entries.map(([k, v]) => [k, v.synonyms || []])),
    groups: Object.fromEntries(entries.filter(([, v]) => v.group).map(([k, v]) => [k, { kind: 'organisational', temporary: v.temporary === true, assignable: false, synonyms: v.synonyms || [], note: '', ...(v.colour ? { colour: v.colour } : {}) }])),
    forms: Object.fromEntries(entries.filter(([, v]) => 'discogs' in v).map(([k, v]) => [k, { level: 1, ...v }])),
  };
}
