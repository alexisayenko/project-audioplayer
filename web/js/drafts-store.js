import { api } from './api.js';
import { toast } from './dom.js';
import { TOAST_ACTION_MS } from './constants.js';
import { mergePaste, replaceDraft } from './drafts-model.js';

export const draftStore = {
  items: [],
  loaded: false,
  limit: 500,
  error: '',
  hidden: new Set(),
  timers: new Map(),
  subs: new Set(),
  pending: null,
  get visible() { return this.items.filter((d) => !this.hidden.has(d.id)); },
  get count() { return this.visible.length; },
  subscribe(fn) { this.subs.add(fn); return () => this.subs.delete(fn); },
  emit() { Array.from(this.subs, (fn) => fn()); },
  reset() {
    for (const t of this.timers.values()) clearTimeout(t);
    Object.assign(this, { items: [], loaded: false, limit: 500, error: '', hidden: new Set(), timers: new Map(), pending: null });
  },
  load() {
    this.pending ??= this.fetchAll().finally(() => { this.pending = null; });
    return this.pending;
  },
  async fetchAll() {
    try {
      const got = await api.drafts();
      this.items = Array.isArray(got?.drafts) ? got.drafts : [];
      this.limit = got?.limit ?? this.limit;
      this.loaded = true;
      this.error = '';
    } catch (ex) {
      this.error = ex.message;
    }
    this.emit();
  },
  async paste(lines, origins) {
    const resp = await api.addDrafts(lines, origins);
    this.items = mergePaste(this.items, resp);
    this.loaded = true;
    this.emit();
    return resp;
  },
  async edit(id, body) {
    const one = await api.patchDraft(id, body);
    this.items = replaceDraft(this.items, one);
    this.emit();
    return one;
  },
  async refresh(id) {
    const resp = await api.refreshDraft(id);
    this.items = replaceDraft(this.items, resp.draft);
    this.emit();
    return resp;
  },
  softDelete(id) {
    this.hidden.add(id);
    this.timers.set(id, setTimeout(() => { void this.commitDelete(id); }, TOAST_ACTION_MS));
    this.emit();
  },
  undo(id) {
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    this.hidden.delete(id);
    this.emit();
  },
  async commitDelete(id) {
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    try {
      await api.removeDraft(id);
    } catch (ex) {
      if (ex.status !== 404) {
        this.hidden.delete(id);
        this.emit();
        toast(`Could not delete the draft: ${ex.message}`);
        return;
      }
    }
    this.items = this.items.filter((d) => d.id !== id);
    this.hidden.delete(id);
    this.emit();
  },
  flush() { return Promise.all([...this.timers.keys()].map((id) => this.commitDelete(id))); },
  forget(ids) {
    const gone = new Set(ids ?? []);
    if (!gone.size) return;
    this.items = this.items.filter((d) => !gone.has(d.id));
    this.emit();
  },
  async dropAfterAdd(id) {
    this.hidden.add(id);
    this.emit();
    await this.commitDelete(id);
  },
};

if (typeof window !== 'undefined') window.addEventListener('auth-changed', () => { draftStore.reset(); draftStore.emit(); });
