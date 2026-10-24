import { api } from './api.js';
import { toast } from './dom.js';

export function saveText(text, name) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

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
