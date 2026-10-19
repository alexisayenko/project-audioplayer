export const SOURCES = [
  { key: 'wikipedia', label: 'Wikipedia', icon: 'srcWikipedia' },
  { key: 'apple-music', label: 'Apple Music', icon: 'srcAppleMusic' },
  { key: 'spotify', label: 'Spotify', icon: 'srcSpotify' },
  { key: 'discogs', label: 'Discogs', icon: 'srcDiscogs' },
  { key: 'musicbrainz', label: 'MusicBrainz', icon: 'srcMusicbrainz' },
];

const norm = (s) => String(s).trim().toLowerCase().replace(/[\s_]+/g, '-');

export function cleanSourceLinks(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((l) => l && typeof l.source === 'string' && typeof l.url === 'string' && /^https?:\/\//i.test(l.url))
    .map((l) => ({ source: norm(l.source), url: l.url, kind: l.kind === 'search' ? 'search' : 'page' }));
}
