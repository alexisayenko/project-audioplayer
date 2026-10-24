import { api, isSignedIn } from './api.js';
import { isGuest } from './guest.js';

const DETAIL_PARALLEL = 6;

export const playlistsOn = () => isSignedIn() && !isGuest();

const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.id.localeCompare(b.id);

export const playlistStore = {
  items: [],
  loaded: false,
  pending: null,
  details: new Map(),
  listeners: new Set(),

  reset() {
    this.items = [];
    this.loaded = false;
    this.pending = null;
    this.details.clear();
    this.notify();
  },

  notify() {
    this.listeners.forEach((fn) => fn());
  },

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  },

  refresh() {
    if (this.pending) return this.pending;
    const run = (async () => {
      const list = await api.playlists();
      this.items = list.sort(byName);
      this.loaded = true;
      for (const [id, d] of this.details) {
        const live = this.items.find((p) => p.id === id);
        if (!live || live.updated !== d.updated) this.details.delete(id);
      }
      this.notify();
    })();
    this.pending = run;
    const clear = () => { if (this.pending === run) this.pending = null; };
    run.then(clear, clear);
    return run;
  },

  find(id) {
    return this.items.find((p) => p.id === id);
  },

  names(except = '') {
    return this.items.filter((p) => p.id !== except).map((p) => p.name);
  },

  async detail(id) {
    const d = await api.playlistDetail(id);
    this.details.set(id, d);
    return d;
  },

  async holding(songIds) {
    await this.refresh();
    const need = this.items.filter((p) => {
      const d = this.details.get(p.id);
      return !d || d.updated !== p.updated;
    });
    for (let i = 0; i < need.length; i += DETAIL_PARALLEL) {
      await Promise.all(need.slice(i, i + DETAIL_PARALLEL).map((p) => this.detail(p.id).catch(() => null))); // NOSONAR batches run in turn to limit parallel requests
    }
    const wanted = new Set(songIds);
    const held = new Set();
    for (const p of this.items) {
      const have = new Set(this.details.get(p.id)?.songs || []);
      if ([...wanted].every((id) => have.has(id))) held.add(p.id);
    }
    return held;
  },

  async create(name, description = '', songIds = []) {
    const made = await api.createPlaylist({ name, description, song_ids: songIds });
    await this.refresh().catch(() => {});
    return made;
  },

  async patch(id, body) {
    const next = await api.patchPlaylist(id, body);
    await this.refresh().catch(() => {});
    return next;
  },

  async remove(id) {
    await api.deletePlaylist(id);
    this.details.delete(id);
    await this.refresh().catch(() => {});
  },

  async add(id, songIds) {
    const result = await api.addToPlaylist(id, songIds);
    this.details.delete(id);
    await this.refresh().catch(() => {});
    return result;
  },

  async removeSong(id, songId) {
    await api.removeFromPlaylist(id, songId);
    this.details.delete(id);
    await this.refresh().catch(() => {});
  },

  async order(id, songIds, keepalive = false) {
    const next = await api.putPlaylistOrder(id, songIds, keepalive);
    this.details.delete(id);
    await this.refresh().catch(() => {});
    return next;
  },
};

if (typeof window !== 'undefined') window.addEventListener('auth-changed', () => playlistStore.reset());
