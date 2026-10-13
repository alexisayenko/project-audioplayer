const PROVIDERS = { youtube: 'YouTube', soundcloud: 'SoundCloud', spotify: 'Spotify', applemusic: 'Apple Music', shazam: 'Shazam' };

export function hasAudio(song) {
  if (!song) return false;
  if (song.audio_state) return song.audio_state === 'server';
  return song.file !== null;
}

export function sourceLink(song) {
  const list = Array.isArray(song?.sources) ? song.sources : [];
  const src = list.find((s) => s && /^https?:\/\//i.test(s.url || ''));
  if (!src) return null;
  const name = PROVIDERS[src.source] || (src.source ? src.source[0].toUpperCase() + src.source.slice(1) : '');
  return { url: src.url, source: src.source || '', label: name ? `Open on ${name}` : 'Open original link' };
}
