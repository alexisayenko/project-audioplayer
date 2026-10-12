import { api } from './api.js';
import { store } from './store.js';
import { toast } from './dom.js';

const items = new Map();
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn());

export const downloads = {
  list: () => [...items.values()].filter((d) => !store.get(d.id)),
  get: (id) => items.get(id),
  onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },

  track(id, info) {
    if (items.has(id)) return;
    const d = { id, title: info.title || 'Untitled', artist: info.artist || '', thumbnail: info.thumbnail || '', duration: info.duration || 0, progress: 0 };
    items.set(id, d);
    emit();
    d.timer = setInterval(() => tick(d), 1000);
  },
};

function drop(d) {
  clearInterval(d.timer);
  items.delete(d.id);
  emit();
}

async function tick(d) {
  try {
    const st = await api.status(d.id);
    d.progress = st.progress || 0;
    if (st.status === 'error') {
      toast(`Download failed: ${st.error}`);
      drop(d);
    } else if (st.status === 'done') {
      clearInterval(d.timer);
      try { await store.refresh(); } catch { /* list reloads on next visit */ }
      toast('Saved to your library');
      drop(d);
    } else {
      emit();
    }
  } catch (ex) {
    toast(ex.message);
    drop(d);
  }
}
