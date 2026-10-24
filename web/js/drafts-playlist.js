import { api } from './api.js';
import { toast, plural } from './dom.js';
import { playlistStore } from './playlists-store.js';
import { draftStore } from './drafts-store.js';

export const MSG_FULL = 'That playlist is full (2000 songs). The songs are in your Library.';
export const MSG_TOO_MANY = 'You have the maximum of 200 playlists. The songs are in your Library.';

export function stepError(ex) {
  if (ex?.code === 'too_many_songs') return MSG_FULL;
  if (ex?.code === 'too_many_playlists') return MSG_TOO_MANY;
  return `Could not add to the playlist: ${ex?.message || 'try again'}. The songs are in your Library.`;
}

export function stepText(r) {
  const name = r.playlist.name;
  return r.added ? `Added ${r.added} ${plural(r.added, 'song', 'songs')} to playlist ${name}` : `Already in playlist ${name}`;
}

/**
 * The playlist step of a draft that came from a YouTube playlist: the server puts the song (`songId`, or the library match of the draft when omitted)
 * and every sibling draft already in the Library into the user's playlist of that YouTube playlist, in YouTube order; the swept siblings are removed from the Drafts.
 * Resolves to true when it worked.
 */
export async function addDraftToPlaylist(draft, songId, open = (id) => { window.location.hash = `#/playlists/${id}`; }) {
  try {
    const r = await api.draftToPlaylist(draft.id, songId);
    draftStore.forget(r.dropped);
    playlistStore.details.delete(r.playlist.id);
    playlistStore.refresh().catch(() => {});
    toast(stepText(r), { label: 'Open', run: () => open(r.playlist.id) });
    return true;
  } catch (ex) {
    toast(stepError(ex));
    return false;
  }
}
