import { api } from './api.js';
import { toast } from './dom.js';

export function downloadSong(song) {
  const a = document.createElement('a');
  a.href = api.downloadUrl(song.id);
  a.download = '';
  a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
  toast('Download started');
}
