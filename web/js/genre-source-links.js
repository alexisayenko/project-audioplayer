export const SOURCES = [
  { key: 'wikipedia', label: 'Wikipedia', icon: 'srcWikipedia' },
  { key: 'apple-music', label: 'Apple Music', icon: 'srcAppleMusic' },
  { key: 'spotify', label: 'Spotify', icon: 'srcSpotify' },
  { key: 'discogs', label: 'Discogs', icon: 'srcDiscogs' },
  { key: 'rym', label: 'Rate Your Music', icon: 'srcRym' },
  { key: 'musicbrainz', label: 'MusicBrainz', icon: 'srcMusicbrainz' },
];

const norm = (s) => String(s).trim().toLowerCase().replace(/[\s_]+/g, '-');

export function cleanSourceLinks(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((l) => l && typeof l.source === 'string' && typeof l.url === 'string' && /^https?:\/\//i.test(l.url))
    .map((l) => ({ source: norm(l.source), url: l.url, kind: l.kind === 'search' ? 'search' : 'page' }));
}

export const SHOWN_SOURCES = ['wikipedia', 'rym'];

export function shownSourceLinks(list) {
  const links = cleanSourceLinks(list);
  return SHOWN_SOURCES.map((key) => {
    const link = links.find((l) => norm(l.source) === key);
    const meta = SOURCES.find((s) => s.key === key);
    return link ? { ...link, label: meta.label, icon: meta.icon } : null;
  }).filter(Boolean);
}
