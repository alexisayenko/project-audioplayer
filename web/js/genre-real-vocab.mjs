import { readFileSync } from 'node:fs';

export function realVocab() {
  const file = JSON.parse(readFileSync(new URL('../../server/data/genre_levels.json', import.meta.url), 'utf8'));
  const { _meta, families, flavours, subfamilies, ...levels } = file;
  void _meta;
  void subfamilies;
  return {
    families: Object.keys(families), genres: [], aliases: {}, levels, flavours,
    family_synonyms: Object.fromEntries(Object.entries(families).map(([k, v]) => [k, v.synonyms || []])),
  };
}
