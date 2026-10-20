import { el, fmtTime, toast } from './dom.js';
import { icon } from './icons.js';
import { serviceIcon, LABELS } from './service-icons.js';
import { artistLine, titleNodes } from './credits.js';
import { openAdd } from './add.js';
import { draftStore } from './drafts-store.js';
import { store } from './store.js';
import { api } from './api.js';
import { hasPlaylist, runImport, summarizeImport, existingVideoIds } from './drafts-import.js';
import {
  MAX_LINE, PLACEHOLDER, EMPTY_TEXT, LINK_NOTE, prepare, lineParts, rawLine, isFetchable, canRefresh, titleOf, statusOf, countText, summarize,
} from './drafts-model.js';

export { draftStore };

const MARK_ICON = { library: 'check', fetched: 'check', failed: 'warning' };

function srcLink(d) {
  if (!d.url) return null;
  const kind = isFetchable(d) ? d.source : 'other';
  const label = kind === 'other' ? 'Open the link' : `Open on ${LABELS[kind]}`;
  return el('a', { class: `src-logo src-${kind}`, href: d.url, target: '_blank', rel: 'noopener', 'aria-label': `${label}: ${titleOf(d)}`, title: label }, serviceIcon(kind));
}

function subLine(d) {
  const bits = [];
  const artists = artistLine(d);
  if (artists) bits.push(artists);
  if (Number.isInteger(d.year)) bits.push(el('span', { title: 'Upload year: a suggestion for the version year, not the release year' }, String(d.year)));
  if (d.duration) bits.push(fmtTime(d.duration));
  if (!bits.length) return null;
  const out = [];
  bits.forEach((b, i) => { if (i) out.push(' · '); out.push(b); });
  return el('small', { class: 'sub t-subhead' }, out);
}

function statusMark(d) {
  const st = statusOf(d);
  return el('span', { class: `draft-mark ${st.kind}` }, MARK_ICON[st.kind] ? icon(MARK_ICON[st.kind], 'inline') : null, st.label);
}

function thumb(d) {
  const img = el('img', { class: 'cover', alt: '', loading: 'lazy', referrerpolicy: 'no-referrer' });
  if (d.thumbnail) img.src = d.thumbnail;
  img.addEventListener('error', () => img.removeAttribute('src'));
  return img;
}

/** The drafts view: the paste box, the list and its actions. Returns a cleanup that sends pending deletes. */
export function mountDrafts(host) {
  const editing = new Map();
  const editError = new Map();
  const busy = new Set();
  let focusId = null;

  const box = el('textarea', { class: 'drafts-box', rows: 4, placeholder: PLACEHOLDER, 'aria-label': 'Paste songs for the draft list', spellcheck: false, autocomplete: 'off' });
  const addBtn = el('button', { class: 'btn primary glow', type: 'submit' }, icon('plus', 'action'), 'Add to drafts');
  const hint = el('span', { class: 'muted t-caption' }, 'Ctrl+Enter or Cmd+Enter adds too.');
  const form = el('form', { class: 'drafts-paste card' }, box, el('div', { class: 'drafts-foot' }, hint, addBtn));
  const message = el('div', { class: 'drafts-msg', role: 'status' });
  const progress = el('div', { class: 'drafts-import', role: 'status', hidden: true });
  const bar = el('div', { class: 'drafts-bar' });
  const list = el('ul', { class: 'drafts-list' });
  const group = el('div', { class: 'group' }, list);
  const state = el('div', { class: 'drafts-state' });
  host.replaceChildren(form, message, progress, bar, group, state);

  const say = (text, kind = '') => message.replaceChildren(text ? el('p', { class: `msg ${kind}`.trim() }, text) : '');

  let importing = false;

  function paintProgress(p, cancel) {
    const text = p.phase === 'reading' ? 'Reading the playlist...' : `Adding ${p.done} of ${p.total}...`;
    const bits = [el('span', { class: 't-subhead' }, text)];
    if (p.phase === 'adding' && p.total) bits.push(el('progress', { max: p.total, value: p.done, 'aria-label': text }));
    bits.push(el('button', { class: 'btn outline small', type: 'button', disabled: cancel.aborted, onclick: () => { cancel.aborted = true; paintProgress(p, cancel); } }, cancel.aborted ? 'Stopping...' : 'Cancel'));
    progress.replaceChildren(...bits);
    progress.hidden = false;
  }

  async function importLists(prep) {
    const cancel = { aborted: false };
    importing = true;
    say('');
    paintProgress({ phase: 'reading', done: 0, total: 0 }, cancel);
    let r;
    try {
      r = await runImport({
        lines: prep.lines,
        fetchPlaylist: (url) => api.youtubePlaylist(url),
        addLines: (part) => draftStore.paste(part),
        ids: existingVideoIds({ drafts: draftStore.visible, songs: store.songs }),
        onProgress: (p) => paintProgress(p, cancel),
        isCancelled: () => cancel.aborted,
      });
    } finally {
      importing = false;
      progress.hidden = true;
      progress.replaceChildren();
    }
    if (!r.cancelled && !r.failed && !r.errors.length) box.value = prep.rest.join('\n');
    say(summarizeImport(r), r.failed || r.errors.length ? 'error' : r.added ? 'ok' : '');
  }

  async function submit() {
    if (importing) return;
    const prep = prepare(box.value);
    if (!prep.lines.length) { say(prep.counts.tooLong ? `Every line is over the ${MAX_LINE} character limit.` : 'Paste at least one line first.', 'error'); return; }
    addBtn.disabled = true;
    addBtn.lastChild.textContent = 'Adding...';
    try {
      if (hasPlaylist(prep.lines)) {
        await importLists(prep);
        return;
      }
      say('Adding and looking up the links...');
      const resp = await draftStore.paste(prep.lines);
      box.value = prep.rest.join('\n');
      say(summarize(resp.counts, prep.counts), resp.counts.created || resp.counts.updated ? 'ok' : '');
    } catch (ex) {
      say(ex.message, 'error');
    } finally {
      addBtn.disabled = false;
      addBtn.lastChild.textContent = 'Add to drafts';
    }
  }
  form.addEventListener('submit', (e) => { e.preventDefault(); void submit(); });
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void submit(); }
  });

  function addToLibrary(d) {
    openAdd({ draft: d, onSaved: () => { void draftStore.dropAfterAdd(d.id); } });
  }

  async function refresh(d) {
    busy.add(d.id);
    paint();
    try {
      const resp = await draftStore.refresh(d.id);
      if (resp.rateLimited) toast('YouTube is limiting requests. Try again later.');
      else if (resp.error) toast(`Could not fetch: ${resp.error}`);
    } catch (ex) {
      toast(ex.message);
    } finally {
      busy.delete(d.id);
      paint();
    }
  }

  function remove(d) {
    draftStore.softDelete(d.id);
    toast('Draft deleted', { label: 'Undo', run: () => draftStore.undo(d.id) });
  }

  function startEdit(d) {
    editing.set(d.id, rawLine(d));
    editError.delete(d.id);
    focusId = d.id;
    paint();
  }

  function editForm(d) {
    const input = el('input', { type: 'text', class: 'draft-edit-input', value: editing.get(d.id), 'aria-label': `Edit draft: ${titleOf(d)}`, autocomplete: 'off' });
    input.addEventListener('input', () => editing.set(d.id, input.value));
    const err = editError.get(d.id);
    const f = el('form', { class: 'draft-edit' },
      el('div', { class: 'row' }, input,
        el('button', { class: 'btn fill small', type: 'submit' }, 'Save'),
        el('button', { class: 'btn outline small', type: 'button', onclick: () => { editing.delete(d.id); paint(); } }, 'Cancel')),
      err ? el('p', { class: 'msg error' }, err) : null);
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const parts = lineParts(input.value);
      if (!parts.text && !parts.url) { editError.set(d.id, 'A draft needs a text or a link.'); paint(); return; }
      try {
        await draftStore.edit(d.id, parts);
        editing.delete(d.id);
        editError.delete(d.id);
      } catch (ex) {
        editError.set(d.id, ex.message);
      }
      paint();
    });
    return f;
  }

  function actions(d) {
    const name = titleOf(d);
    const working = busy.has(d.id);
    return el('div', { class: 'draft-actions' },
      srcLink(d),
      el('button', { class: 'btn fill small', type: 'button', 'aria-label': `Add to Library: ${name}`, onclick: () => addToLibrary(d) }, icon('plus', 'inline'), 'Add to Library'),
      canRefresh(d) ? el('button', { class: 'link-btn', type: 'button', disabled: working, 'aria-label': `Refresh: ${name}`, onclick: () => { void refresh(d); } }, working ? 'Fetching...' : 'Refresh') : null,
      el('button', { class: 'link-btn', type: 'button', 'aria-label': `Edit: ${name}`, onclick: () => startEdit(d) }, 'Edit'),
      el('button', { class: 'link-btn danger-text', type: 'button', 'aria-label': `Delete: ${name}`, onclick: () => remove(d) }, 'Delete'));
  }

  function row(d) {
    const link = d.source === 'link';
    const head = d.title
      ? el('span', { class: 'draft-title t-headline' }, titleNodes(d))
      : el('span', { class: 'draft-title t-headline muted', title: d.url || rawLine(d) }, titleOf(d));
    const info = editing.has(d.id)
      ? el('div', { class: 'info' }, editForm(d))
      : el('div', { class: 'info' },
        el('div', { class: 'title-line' }, head),
        subLine(d),
        el('div', { class: 'draft-meta' }, statusMark(d), link ? el('small', { class: 'muted t-caption' }, LINK_NOTE) : null));
    return el('li', { class: `draft${d.inLibrary ? ' in-library' : ''}`, 'data-id': d.id }, thumb(d), info, actions(d));
  }

  function paintBar() {
    const n = draftStore.count;
    if (!n) { bar.replaceChildren(); return; }
    bar.replaceChildren(el('p', { class: 'muted t-caption' }, `${countText(n)} of ${draftStore.limit}`));
  }

  function paintState(n) {
    if (draftStore.error && !draftStore.loaded) {
      state.replaceChildren(el('div', { class: 'state card' }, el('p', { class: 'msg error' }, draftStore.error),
        el('button', { class: 'btn', type: 'button', onclick: () => { void draftStore.load(); } }, 'Retry')));
    } else if (!draftStore.loaded) {
      state.replaceChildren(el('p', { class: 'muted t-subhead state', role: 'status' }, 'Loading drafts...'));
    } else if (!n) {
      state.replaceChildren(el('p', { class: 'muted t-subhead state drafts-empty' }, EMPTY_TEXT));
    } else {
      state.replaceChildren();
    }
  }

  function paint() {
    const rows = draftStore.visible;
    group.hidden = !rows.length;
    list.replaceChildren(...rows.map(row));
    paintBar();
    paintState(rows.length);
    if (focusId) {
      list.querySelector(`li.draft[data-id="${CSS.escape(focusId)}"] .draft-edit-input`)?.focus();
      focusId = null;
    }
  }

  const unsub = draftStore.subscribe(paint);
  if (draftStore.loaded) paint();
  else { paint(); void draftStore.load(); }
  const onHide = () => { void draftStore.flush(); };
  window.addEventListener('pagehide', onHide);
  return () => { unsub(); window.removeEventListener('pagehide', onHide); void draftStore.flush(); };
}
