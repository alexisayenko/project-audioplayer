import { player } from './player.js';
import { toast } from './dom.js';

const MESSAGES = { duplicate: 'Already in queue', queued: 'Queued', removed: 'Removed from playlist' };

const NEXT_MESSAGES = { next: 'Playing next', now: 'Playing now', current: 'Already the current song', unavailable: 'Not available to play' };

export function playNextInQueue(s) {
  const r = player.playNext(s.id);
  toast(NEXT_MESSAGES[r] || 'Playing next');
}

export function toggleQueue(s) {
  const r = player.toggleInPlaylist(s.id);
  toast(MESSAGES[r] || 'Added');
}
