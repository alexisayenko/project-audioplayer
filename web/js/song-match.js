import { songSearchText } from './search-text.js';
import { matchesQuery } from './search-query.js';
import { filterableTags, tagSearchText, withRuntimeDecade } from './tagname.js';
import { labelsOf } from './label-names.js';

export function songMatches(song, query) {
  const hay = songSearchText(song, [...filterableTags(withRuntimeDecade(song).tags).map(tagSearchText), ...labelsOf(song)]);
  return matchesQuery(hay, query);
}
