import { player } from './player.js';
import { toast } from './dom.js';

const MESSAGES = { duplicate: 'Already in queue', queued: 'Queued', removed: 'Removed from playlist' };

export function toggleQueue(s) {
  const r = player.toggleInPlaylist(s.id);
  toast(MESSAGES[r] || 'Added');
}
