import { player } from './player.js';
import { plural, toast } from './dom.js';

export function addAllToQueue(songs, tag = '') {
  const { added, already, fetching } = player.addListed(songs, tag);
  const note = already ? ` (${already} already in queue)` : '';
  const dl = fetching ? `, ${fetching} downloading` : '';
  toast(`Added ${added} ${plural(added, 'song', 'songs')}${dl}${note}`);
}

export function playAll(songs, tags = []) {
  const { count, skipped, replaced, fetching } = player.playListed(songs, tags);
  if (!count) { toast('Nothing to play'); return; }
  const note = (fetching ? `, ${fetching} downloading` : '') + (skipped ? `, ${skipped} without audio skipped` : '');
  toast(`Playing ${count} ${plural(count, 'song', 'songs')}${replaced ? ' (queue replaced)' : ''}${note}`);
}
