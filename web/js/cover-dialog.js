import { api } from './api.js';
import { store } from './store.js';
import { el, toast } from './dom.js';
import { can } from './guest.js';
import { fileProblem, urlProblem, coverError, COVER_TYPES } from './cover-edit.js';

export const MAX_SUGGESTIONS = 4;

const OPTIONS = [
  { key: 'url', label: 'From address' },
  { key: 'file', label: 'Upload' },
  { key: 'wiki', label: 'Wikipedia' },
  { key: 'default', label: 'Default image' },
];

export const canChangeCover = () => can('edit');

export const hasOwnCover = (song) => song?.cover_source === 'custom' || song?.cover_source === 'default';

export function filePreviewError(file) {
  const bad = fileProblem(file);
  if (!bad) return '';
  return bad === 'Use a JPEG, PNG or WebP image.' ? 'Choose a JPEG, PNG or WebP image.' : bad;
}

function makeObjectUrl(file) {
  try { return URL.createObjectURL(file); } catch { return ''; }
}

function dropUrl(url) {
  if (!url) return;
  try { URL.revokeObjectURL(url); } catch { /* not an object URL */ }
}

export function openCoverDialog(song, opener = null) {
  if (!canChangeCover()) return null;
  const id = song.id;
  const dlg = el('dialog', { class: 'cover-dlg', 'aria-labelledby': 'cover-dlg-title' });
  let choice = null;
  let objectUrl = '';
  let saving = false;
  let wikiState = 'idle';
  let suggestions = [];

  const close = () => { if (!saving) dlg.close(); };
  const title = el('h2', { id: 'cover-dlg-title', class: 't-title' }, 'Change cover');
  const cancelTop = el('button', { type: 'button', class: 'link-btn t-headline', onclick: close }, 'Cancel');
  const head = el('div', { class: 'dlg-head' }, title, cancelTop);

  const frame = el('div', { class: 'cover-preview' });
  const previewImg = el('img', { class: 'cover cover-preview-img noart', alt: '' });
  const previewNote = el('p', { class: 't-caption muted', role: 'status' });
  frame.append(previewImg);

  const err = el('p', { class: 'msg error', role: 'alert', hidden: true });
  const status = el('p', { class: 't-caption muted', role: 'status' });

  const tabs = el('div', { class: 'cover-options', role: 'group', 'aria-label': 'Cover source' });
  const tabBtns = new Map();
  for (const o of OPTIONS) {
    const b = el('button', { type: 'button', class: 'btn outline small', 'aria-pressed': 'false', onclick: () => pick(o.key) }, o.label);
    tabBtns.set(o.key, b);
    tabs.append(b);
  }

  const urlIn = el('input', { type: 'url', placeholder: 'https://...', 'aria-label': 'Image address', autocomplete: 'off' });
  const urlPanel = el('div', { class: 'cover-panel', hidden: true }, urlIn);

  const fileIn = el('input', { type: 'file', accept: COVER_TYPES.join(','), hidden: true, tabindex: '-1' });
  const fileBtn = el('button', { type: 'button', class: 'btn outline small', onclick: () => fileIn.click() }, 'Choose a file');
  const filePanel = el('div', { class: 'cover-panel', hidden: true }, fileBtn,
    el('p', { class: 't-caption muted' }, 'JPEG, PNG or WebP, at most 5 MB. You can also drop a file here.'), fileIn);

  const wikiBody = el('div', { class: 'cover-wiki' });
  const wikiPanel = el('div', { class: 'cover-panel', hidden: true }, wikiBody);
  const wikiSource = el('p', { class: 't-caption', hidden: true });

  const defPanel = el('div', { class: 'cover-panel', hidden: true },
    el('p', { class: 't-caption muted' }, 'Use the neutral placeholder and keep it.'));

  const panels = { url: urlPanel, file: filePanel, wiki: wikiPanel, default: defPanel };

  const save = el('button', { type: 'button', class: 'btn primary small', disabled: true, onclick: () => void doSave() }, 'Save');
  const cancel = el('button', { type: 'button', class: 'btn outline small', onclick: close }, 'Cancel');
  const remove = el('button', { type: 'button', class: 'btn danger small', hidden: !hasOwnCover(store.get(id) || song), onclick: () => void doRemove() }, 'Remove custom cover');
  const actions = el('div', { class: 'row end cover-actions' }, remove, cancel, save);

  const controls = () => [...tabBtns.values(), urlIn, fileBtn, save, cancel, remove, cancelTop, ...wikiBody.querySelectorAll('button')];

  const setError = (text) => {
    err.textContent = text || '';
    err.hidden = !text;
  };

  const showPreview = (src, note = '') => {
    if (src) previewImg.setAttribute('src', src); else previewImg.removeAttribute('src');
    previewImg.classList.toggle('noart', !src);
    previewNote.textContent = note;
  };

  const releaseFile = () => { dropUrl(objectUrl); objectUrl = ''; };

  const setChoice = (next, problem = '') => {
    choice = next;
    save.disabled = !next || !!problem || saving;
    setError(problem);
  };

  const busy = (on) => {
    saving = on;
    for (const c of controls()) c.disabled = on || (c === save && !choice);
    status.textContent = on ? 'Saving...' : '';
  };

  const paintWiki = () => {
    wikiBody.replaceChildren();
    if (wikiState === 'loading') { wikiBody.append(el('p', { class: 't-caption muted', role: 'status' }, 'Looking for covers...')); return; }
    if (wikiState === 'error') { wikiBody.append(el('p', { class: 't-caption muted', role: 'status' }, 'Could not load Wikipedia covers.')); return; }
    if (!suggestions.length) { wikiBody.append(el('p', { class: 't-caption muted', role: 'status' }, 'No Wikipedia covers found for this song.')); return; }
    const list = el('div', { class: 'cover-suggestions', role: 'group', 'aria-label': 'Wikipedia covers' });
    for (const s of suggestions) {
      const img = el('img', { class: 'cover', alt: '', src: s.thumb || s.url });
      const b = el('button', {
        type: 'button', class: 'cover-suggestion', 'aria-pressed': String(choice?.s === s), title: s.title || 'Wikipedia cover',
        onclick: () => pickSuggestion(s),
      }, img, el('span', { class: 't-caption' }, s.title || 'Wikipedia'));
      list.append(b);
    }
    wikiBody.append(list, wikiSource);
  };

  function pickSuggestion(s) {
    setChoice({ kind: 'wiki', body: { url: s.url }, s });
    showPreview(s.thumb || s.url);
    wikiSource.replaceChildren();
    if (s.page) {
      wikiSource.append('Source: ', el('a', { href: s.page, target: '_blank', rel: 'noopener noreferrer' }, s.title || 'Wikipedia'));
    }
    wikiSource.hidden = !s.page;
    paintWiki();
  }

  async function loadWiki() {
    if (wikiState !== 'idle') return;
    wikiState = 'loading';
    paintWiki();
    try {
      const res = await api.coverSuggestions(id);
      suggestions = (res?.suggestions || []).slice(0, MAX_SUGGESTIONS);
      wikiState = 'done';
    } catch {
      wikiState = 'idle';
      wikiBody.replaceChildren(el('p', { class: 't-caption muted', role: 'status' }, 'Could not load Wikipedia covers.'),
        el('button', { type: 'button', class: 'btn outline small', onclick: () => void loadWiki() }, 'Try again'));
      return;
    }
    if (dlg.isConnected) paintWiki();
  }

  function pick(key) {
    if (saving) return;
    for (const [k, b] of tabBtns) b.setAttribute('aria-pressed', String(k === key));
    for (const [k, p] of Object.entries(panels)) p.hidden = k !== key;
    releaseFile();
    setError('');
    if (key === 'default') {
      setChoice({ kind: 'default', body: { default: true } });
      showPreview('', 'The neutral placeholder.');
    } else if (key === 'url') {
      onUrl();
      urlIn.focus();
    } else if (key === 'file') {
      setChoice(null);
      showPreview('');
    } else {
      setChoice(null);
      showPreview('');
      void loadWiki();
    }
  }

  function onUrl() {
    const text = urlIn.value.trim();
    if (!text) { setChoice(null); showPreview(''); return; }
    const bad = urlProblem(text);
    if (bad) { setChoice(null, bad); showPreview(''); return; }
    setChoice({ kind: 'url', body: { url: text } });
    showPreview(text);
  }

  previewImg.addEventListener('error', () => {
    if (!previewImg.getAttribute('src')) return;
    previewImg.removeAttribute('src');
    previewImg.classList.add('noart');
    previewNote.textContent = choice?.kind === 'url' ? 'Cannot preview this address. It may still work.' : 'Cannot preview this image.';
  });

  function takeFile(f) {
    pick('file');
    releaseFile();
    const bad = filePreviewError(f);
    if (bad) { setChoice(null, bad); showPreview(''); return; }
    objectUrl = makeObjectUrl(f);
    setChoice({ kind: 'file', body: f });
    showPreview(objectUrl, f.name || '');
  }

  fileIn.addEventListener('change', () => {
    const f = fileIn.files?.[0];
    fileIn.value = '';
    if (f) takeFile(f);
  });
  urlIn.addEventListener('input', onUrl);
  urlIn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); if (choice && !save.disabled) void doSave(); }
  });
  dlg.addEventListener('dragover', (e) => { e.preventDefault(); dlg.classList.add('dropping'); });
  dlg.addEventListener('dragleave', () => dlg.classList.remove('dropping'));
  dlg.addEventListener('drop', (e) => {
    e.preventDefault();
    dlg.classList.remove('dropping');
    if (saving) return;
    const f = e.dataTransfer?.files?.[0];
    if (f) takeFile(f);
  });

  async function run(call, done) {
    busy(true);
    setError('');
    try {
      await call();
      await store.refresh();
      toast(done);
      saving = false;
      dlg.close();
    } catch (ex) {
      busy(false);
      setError(coverError(ex));
    }
  }

  async function doSave() {
    if (!choice || saving) return;
    const body = choice.body;
    await run(() => api.setCover(id, body), choice.kind === 'default' ? 'Default image set' : 'Cover updated');
  }

  async function doRemove() {
    if (saving) return;
    await run(() => api.deleteCover(id), 'Cover removed');
  }

  dlg.addEventListener('cancel', (e) => { if (saving) e.preventDefault(); });
  dlg.addEventListener('close', () => {
    releaseFile();
    dlg.remove();
    if (opener?.isConnected) opener.focus();
  }, { once: true });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });

  dlg.append(head, tabs, urlPanel, filePanel, wikiPanel, defPanel, frame, previewNote, err, status, actions);
  (document.body || document.documentElement).append(dlg);
  dlg.showModal();
  tabBtns.get('url').focus();
  return { dialog: dlg, pick, close };
}
