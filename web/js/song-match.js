import { songSearchText } from './search-text.js';
import { matchesQuery } from './search-query.js';
import { filterableTags, tagSearchText, withRuntimeDecade } from './tagname.js';

export function songMatches(song, query) {
  const hay = songSearchText(song, filterableTags(withRuntimeDecade(song).tags).map(tagSearchText));
  return matchesQuery(hay, query);
}
