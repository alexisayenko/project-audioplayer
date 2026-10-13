import { api } from './api.js';
import { store } from './store.js';
import { tagEditor } from './tag-editor.js';
import { el, field } from './dom.js';
import { tokenGroup } from './token-field.js';
import { wikiFields } from './wiki-links.js';
import { chipField } from './chip-field.js';
import { serviceIcons } from './service-icons.js';
import { planMetadata, statusText, serviceState, suggestion, suggestionText } from './metadata-apply.js';
import { metadataBody, sourceList } from './song-payload.js';

const bpmText = (v) => (v != null ? `${Math.round(v)} BPM` : 'Not detected yet');

export function songForm({ mode = 'add', song = {}, source = null, onChange = null } = {}) {
  const isAdd = mode === 'add';
  const initial = { ...song };
  const tg = tokenGroup();
  const f = {
    title: tg.field('title', initial.title || ''),
    artist: tg.field('artist', initial.artist || ''),
    remixer: tg.field('remixer', initial.remixer || ''),
    album: el('input', { type: 'text', value: initial.album || '' }),
    year: el('input', { type: 'number', value: initial.year ?? '', min: 0, max: 3000 }),
  };
  const editor = tagEditor({ tags: initial.tags || [], suggested: isAdd ? initial.tags || [] : [], year: f.year, hideNs: true });
  const genres = chipField('genre', editor);
  const countries = chipField('country', editor);
  const wiki = wikiFields({ song: initial.wikipedia_song, artist: initial.wikipedia_artist });

  let gen = 0;
  const pending = new Set();
  const begin = () => {
    const ctl = new AbortController();
    pending.add(ctl);
    const mine = gen;
    return { signal: ctl.signal, live: () => mine === gen, done: () => pending.delete(ctl) };
  };
  const abortAll = () => {
    gen += 1;
    for (const ctl of pending) ctl.abort();
    pending.clear();
  };

  const icons = serviceIcons();
  const metaBtn = el('button', { class: 'btn outline small', type: 'button' }, 'Get metadata');
  const metaMsg = el('p', { class: 't-caption muted', role: 'status' });
  const hint = el('button', { class: 'link-btn t-caption wiki-hint', type: 'button', hidden: true });
  let suggest = null;
  const cur = () => ({ title: f.title.value, artist: f.artist.value });
  const emit = () => f.title.dispatchEvent(new Event('input', { bubbles: true }));
  const paintHint = () => {
    const sug = suggest ? suggestion(suggest, cur()) : null;
    hint.hidden = !sug;
    hint.textContent = sug ? `Wikipedia says: ${suggestionText(sug, cur())}` : '';
  };
  hint.addEventListener('click', () => {
    const sug = suggestion(suggest, cur());
    if (!sug) return;
    if (sug.artist) f.artist.value = sug.artist;
    if (sug.title) f.title.value = sug.title;
    paintHint();
    emit();
  });
  f.title.addEventListener('input', paintHint);
  f.artist.addEventListener('input', paintHint);

  const resetMeta = () => {
    suggest = null;
    icons.reset();
    metaMsg.textContent = '';
    paintHint();
  };
  const applyMeta = (resp) => {
    const plan = planMetadata(resp, { album: f.album.value, year: f.year.value, tags: editor.peek() });
    if (plan.album != null) f.album.value = plan.album;
    if (plan.year != null) {
      f.year.value = plan.year;
      f.year.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (plan.tags.length) editor.addTags(plan.tags);
    f.album.dispatchEvent(new Event('input', { bubbles: true }));
    metaMsg.textContent = statusText(plan);
  };
  metaBtn.addEventListener('click', async () => {
    const wv = wiki.values();
    const src = typeof source === 'function' ? source() : source;
    const body = metadataBody({ title: f.title.value, artist: f.artist.value, ...wv }, sourceList(src));
    const req = begin();
    resetMeta();
    metaBtn.disabled = true;
    metaBtn.replaceChildren(el('span', { class: 'spin', 'aria-hidden': 'true' }), 'Getting metadata...');
    icons.setBusy(true);
    try {
      const resp = await api.metadata(body, req.signal);
      if (!req.live()) return;
      icons.setBusy(false);
      icons.setState(serviceState(resp?.services));
      suggest = resp?.suggest || null;
      applyMeta(resp);
      paintHint();
    } catch {
      if (!req.live()) return;
      icons.reset();
      metaMsg.textContent = 'Couldn\'t load metadata';
    } finally {
      req.done();
      if (req.live()) {
        metaBtn.disabled = false;
        metaBtn.textContent = 'Get metadata';
      }
    }
  });

  let bpmRow;
  if (isAdd) {
    bpmRow = el('p', { class: 't-caption muted' }, 'BPM is detected after saving');
  } else {
    const bpmValue = el('span', { title: 'Heuristic, may be off by half or double' }, bpmText(initial.bpm));
    const bpmErr = el('p', { class: 'msg error', hidden: true });
    const redetect = el('button', { type: 'button', class: 'btn outline small' }, 'Re-detect');
    redetect.addEventListener('click', async () => {
      redetect.disabled = true;
      redetect.textContent = 'Detecting...';
      try {
        const updated = await api.detectBpm(initial.id);
        bpmValue.textContent = bpmText(updated.bpm);
        bpmErr.hidden = true;
        await store.refresh();
      } catch (ex) {
        bpmErr.textContent = ex.message;
        bpmErr.hidden = false;
      } finally {
        redetect.disabled = false;
        redetect.textContent = 'Re-detect';
      }
    });
    bpmRow = el('div', { class: 'field' }, el('label', {}, 'BPM'), el('div', { class: 'row' }, bpmValue, redetect), bpmErr);
  }

  const node = el('div', { class: 'add-fields' },
    field('Title', f.title), field('Artist', f.artist),
    field('Remix & additional production', f.remixer),
    hint,
    el('div', { class: 'meta-row' }, metaBtn, icons.node),
    metaMsg,
    el('div', { class: 'grid2' }, field('Album', f.album), field('Year', f.year)),
    bpmRow,
    genres.node, countries.node,
    el('div', { class: 'field' }, el('label', {}, 'Tags'), editor.node),
    wiki.node);
  if (onChange) node.addEventListener('input', onChange);

  const values = ({ commit = true } = {}) => {
    if (commit) {
      genres.commit();
      countries.commit();
    }
    return {
      title: f.title.value,
      artist: f.artist.value,
      remixer: f.remixer.value,
      album: f.album.value,
      year: f.year.value,
      tags: editor.getTags(),
      ...wiki.values(),
    };
  };
  const setValues = (p = {}) => {
    for (const k of ['title', 'artist', 'remixer', 'album']) if (p[k] !== undefined) f[k].value = p[k] ?? '';
    if (p.year !== undefined) f.year.value = p.year ?? '';
    wiki.set({ song: p.wikipedia_song, artist: p.wikipedia_artist });
    emit();
  };

  return {
    node,
    values,
    setValues,
    focus: () => f.title.focus(),
    reset() {
      abortAll();
      resetMeta();
      metaBtn.disabled = false;
      metaBtn.textContent = 'Get metadata';
      setValues({ title: initial.title || '', artist: initial.artist || '', remixer: initial.remixer || '', album: initial.album || '', year: initial.year ?? '', wikipedia_song: initial.wikipedia_song || '', wikipedia_artist: initial.wikipedia_artist || '' });
    },
    destroy: abortAll,
  };
}
