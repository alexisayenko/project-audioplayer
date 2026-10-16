const SOURCE_NAMES = { acoustid: 'AcoustID', musicbrainz: 'MusicBrainz', wikidata: 'Wikidata', discogs: 'Discogs' };

export function disabledReason({ id, audio, available }) {
  if (!id) return 'Save the song and download its audio first';
  if (!audio) return 'Download the audio to the server first';
  if (available && !available.acoustid && !available.discogs) return 'Not configured on the server (needs an AcoustID key or a Discogs token)';
  return null;
}

export function matchedText(matched) {
  if (!matched?.title) return '';
  const who = matched.artist ? `${matched.artist} - ${matched.title}` : matched.title;
  const pct = Number.isFinite(matched.confidence) ? ` (${Math.round(matched.confidence * 100)}%)` : '';
  return `Matched: ${who}${pct}`;
}

export const sourcesText = (sources) => (Array.isArray(sources) ? sources : []).map((s) => SOURCE_NAMES[s] || s).join(', ');

export function statusLine(res) {
  const r = res || {};
  if (r.status === 'unavailable') return 'Not configured on the server';
  if (r.status === 'no_match') return 'Nothing identified';
  if (r.status !== 'ok') return '';
  const head = matchedText(r.matched) || 'Suggestions';
  const src = sourcesText(r.sources);
  return src ? `${head} · ${src}` : head;
}

export function yearAction(res, currentYear) {
  const y = res?.suggested_year;
  if (!Number.isInteger(y) || y <= 0) return null;
  return String(currentYear ?? '').trim() === String(y) ? null : y;
}

const HTTP = /^https?:\/\//i;

export function linkPlan(res) {
  const l = res?.links && typeof res.links === 'object' ? res.links : {};
  const pick = (v) => (typeof v === 'string' && HTTP.test(v) ? v : null);
  const plan = { wikipedia_song: pick(l.wikipedia_song), wikipedia_artist: pick(l.wikipedia_artist), wikipedia_album: pick(l.wikipedia_album), musicbrainz_url: pick(l.musicbrainz), discogs_url: pick(l.discogs) };
  return Object.values(plan).some(Boolean) ? plan : null;
}

export const suggestedTags = (res) => (Array.isArray(res?.suggested_tags) ? res.suggested_tags : []).filter((t) => typeof t === 'string' && /^(genre|country):\S/i.test(t));
