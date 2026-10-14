export const yearValue = (v) => (v === '' || v == null ? null : Number(v));

const sourceUrl = (s) => {
  if (typeof s === 'string') return s;
  return typeof s?.url === 'string' ? s.url : '';
};

export function sourceList(source) {
  let raw = [];
  if (Array.isArray(source)) raw = source;
  else if (source) raw = [source];
  const seen = new Set();
  const out = [];
  for (const s of raw) {
    const url = sourceUrl(s);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({ url });
  }
  return out;
}

export const songSources = (song) => sourceList([...(Array.isArray(song?.sources) ? song.sources : []), song?.source_url]);

function songFields(v) {
  return {
    title: v.title,
    artist: v.artist,
    album: v.album,
    remixer: v.remixer,
    year: yearValue(v.year),
    ...(v.remix_year !== undefined ? { remix_year: yearValue(v.remix_year) } : {}),
  };
}

const wikiFieldsOf = (v) => ({ wikipedia_song: v.wikipedia_song ?? null, wikipedia_artist: v.wikipedia_artist ?? null, musicbrainz_url: v.musicbrainz_url ?? null, discogs_url: v.discogs_url ?? null });

export function addBody(v) {
  const { remix_year: remixYear, ...rest } = songFields(v);
  return { ...rest, ...(remixYear == null ? {} : { remix_year: remixYear }), ...wikiFieldsOf(v) };
}

export function patchBody(v) {
  return { ...songFields(v), tags: v.tags, ...wikiFieldsOf(v) };
}

export function metadataBody(v, sources) {
  return {
    title: String(v.title ?? '').trim(),
    artist: String(v.artist ?? '').trim(),
    sources: sourceList(sources),
    ...(v.wikipedia_song ? { wiki_song: v.wikipedia_song } : {}),
    ...(v.wikipedia_artist ? { wiki_artist: v.wikipedia_artist } : {}),
  };
}
