import { baseRow, albumOf, albumIssues, albumPayload, nameOf, countLine, splitArtists, trackClock } from './album-draft-model.js';

export const MAX_SELECTED = 200;

export function playlistState(preview, address = '') {
  const tracks = Array.isArray(preview.tracks) ? preview.tracks : [];
  const playlist = preview.playlist || {};
  return {
    kind: 'playlist',
    url: address,
    playlist,
    discogsMatch: typeof preview.discogsMatch === 'string' ? preview.discogsMatch : '',
    warnings: [],
    rows: tracks.map((t, i) => baseRow(t, i, {
      position: t.position, videoId: t.videoId, durationS: Number.isFinite(t.durationS) ? t.durationS : null, url: t.url || '', songId: t.songId || null,
    })),
    album: albumOf(preview, address, playlist.url || address),
  };
}

export const rowIssue = (st, i) => {
  const r = st.rows[i];
  return r.include && !r.title.trim() ? 'Title is empty.' : '';
};

export function issues(st) {
  const out = albumIssues(st);
  if (!st.album.albumArtist.trim()) out.push('Give the album an artist.');
  const included = st.rows.filter((r) => r.include);
  if (!included.length) out.push('Tick at least one track.');
  if (included.length > MAX_SELECTED) out.push(`At most ${MAX_SELECTED} tracks.`);
  st.rows.forEach((_, i) => { if (rowIssue(st, i)) out.push(`Track ${i + 1}: ${rowIssue(st, i)}`); });
  return out;
}

export function summary(st) {
  const included = st.rows.filter((r) => r.include);
  const seconds = included.reduce((acc, r) => acc + (r.durationS || 0), 0);
  return countLine(included.length, seconds, issues(st).length);
}

export const trackLabel = (st, i) => {
  const r = st.rows[i];
  return { ...nameOf(r), length: r.durationS ? trackClock(r.durationS) : '' };
};

export const toDownload = (st) => st.rows.filter((r) => r.include && !r.songId).length;

export function payload(st) {
  return {
    playlistUrl: st.url,
    album: albumPayload(st),
    selected: st.rows.filter((r) => r.include).map((r) => ({
      position: r.position, videoId: r.videoId, title: r.title.trim(), durationS: r.durationS ?? null, artists: splitArtists(r.artists), version: r.version.trim() || null,
      ...(r.useExisting && r.match && !r.songId ? { useExistingSongId: r.match.songId } : {}),
    })),
  };
}
