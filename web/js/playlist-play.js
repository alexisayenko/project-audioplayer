import { store } from './store.js';
import { player } from './player.js';
import { toast, plural } from './dom.js';
import { LIBRARY_FRESH_MS } from './constants.js';
import { playlistStore } from './playlists-store.js';

export function playSongs(songs, shuffled = false) {
  const wasShuffle = player.shuffleOn;
  if (shuffled !== wasShuffle) player.setShuffle(shuffled);
  const r = songs.length ? player.playListed(songs, []) : { count: 0, skipped: 0 };
  if (!r.count) {
    if (shuffled !== wasShuffle) player.setShuffle(wasShuffle);
    toast('No playable songs');
    return;
  }
  const mode = shuffled ? ' (shuffled)' : (wasShuffle ? ' (shuffle off)' : '');
  if (r.skipped) toast(`${r.skipped} ${plural(r.skipped, 'song', 'songs')} without audio skipped`);
  else toast(`Playing ${r.count} ${plural(r.count, 'song', 'songs')}${mode}${r.fetching ? `, ${r.fetching} downloading` : ''}`);
}

export async function playPlaylist(id) {
  try {
    if (!store.loaded) await store.refresh({ maxAgeMs: LIBRARY_FRESH_MS });
    const detail = await playlistStore.detail(id);
    playSongs(detail.songs.map((sid) => store.get(sid)).filter(Boolean), false);
  } catch (ex) {
    toast(`Could not play the playlist: ${ex.message}`);
  }
}
