import { api } from './api.js';
import { store } from './store.js';
import { player } from './player.js';
import { el, toast, fmtTime, pageHead } from './dom.js';
import { tagEditor } from './tag-editor.js';
import { wikiFields } from './wiki-links.js';
import { tagChip, tagLabel, tagSearchText, categoryOf, categoryTags, CATEGORIES } from './tagname.js';

const prefs = { query: '', sel: new Set(), sort: 'added' };

const SORTS = {
  added: ['Newest first', (a, b) => (b.added_at || '').localeCompare(a.added_at || '')],
  title: ['Title', (a, b) => cmp(a.title, b.title)],
  artist: ['Artist', (a, b) => cmp(a.artist, b.artist) || cmp(a.title, b.title)],
  year: ['Year', (a, b) => (b.year || 0) - (a.year || 0)],
  bpm: ['BPM', (a, b) => (a.bpm == null) - (b.bpm == null) || (a.bpm || 0) - (b.bpm || 0)],
};

function cmp(a, b) {
  return (a || '').localeCompare(b || '', undefined, { sensitivity: 'base' });
}

function matchesSelection(song, sel) {
  if (!sel.size) return true;
  const mine = new Set((song.tags || []).map((t) => t.toLocaleLowerCase()));
  const byCat = new Map();
  for (const t of sel) {
    const c = categoryOf(t);
    byCat.set(c, [...(byCat.get(c) || []), t]);
  }
  return [...byCat.values()].every((tags) => tags.some((t) => mine.has(t)));
}

export function visibleSongs(sel = prefs.sel) {
  const q = prefs.query.trim().toLocaleLowerCase();
  const list = store.songs.filter((s) => {
    if (!matchesSelection(s, sel)) return false;
    if (!q) return true;
    const hay = [s.title, s.artist, s.album, ...(s.tags || []).map(tagSearchText)].join('\n').toLocaleLowerCase();
    return hay.includes(q);
  });
  return list.sort(SORTS[prefs.sort][1]);
}

function selectedIn(catId) {
  return store.tags.filter((t) => categoryOf(t.tag) === catId && prefs.sel.has(t.tag.toLocaleLowerCase())).length;
}

export function renderLibrary(root) {
  const search = el('input', {
    type: 'search', placeholder: 'Search songs, artists, albums', value: prefs.query,
    'aria-label': 'Search',
    oninput: (e) => { prefs.query = e.target.value; renderList(); },
  });
  const sort = el('select', {
    'aria-label': 'Sort',
    onchange: (e) => { prefs.sort = e.target.value; renderList(); },
  }, Object.entries(SORTS).map(([k, [label]]) => el('option', { value: k, selected: k === prefs.sort }, label)));
  const cats = el('div', { class: 'cats', role: 'group', 'aria-label': 'Filter by category' });
  const count = el('p', { class: 'muted t-subhead', role: 'status' });
  const list = el('ul', { class: 'songs' });
  const addAll = el('button', { class: 'btn outline', type: 'button', hidden: true });
  addAll.addEventListener('click', () => {
    const songs = visibleSongs();
    const only = prefs.sel.size === 1 ? store.tags.find((t) => prefs.sel.has(t.tag.toLocaleLowerCase())) : null;
    const { added, already } = player.addListed(songs, only ? only.tag : '');
    toast(`Added ${added} ${added === 1 ? 'song' : 'songs'}${already ? ` (${already} already in queue)` : ''}`);
  });
  const status = el('div');
  const head = el('div', { class: 'table-head t-eyebrow', 'aria-hidden': 'true' },
    el('span'), el('span'), el('span', {}, 'Title'), el('span', {}, 'Artist'), el('span', { class: 'c-album' }, 'Album'), el('span', { class: 'c-year' }, 'Year'), el('span', { class: 'c-dur' }, 'Time'), el('span'));

  root.append(
    pageHead('Library'),
    el('div', { class: 'toolbar' }, el('div', { class: 'row' }, search, sort), cats),
    el('div', { class: 'row count-row' }, count, addAll),
    el('div', { class: 'group' }, head, list),
    status);

  function renderChips() {
    for (const t of [...prefs.sel]) if (!store.tags.some((x) => x.tag.toLocaleLowerCase() === t)) prefs.sel.delete(t);
    cats.replaceChildren(...CATEGORIES.map((c) => {
      const values = store.tags.filter((t) => categoryOf(t.tag) === c.id).length;
      const n = selectedIn(c.id);
      const b = el('button', {
        class: `cat-chip${n ? ' on' : ''}`, type: 'button', disabled: !values,
        'aria-haspopup': 'dialog',
        onclick: () => openSheet(c, b),
      }, c.name, el('small', { class: 't-caption' }, n || values));
      b.setAttribute('aria-label', n ? `${c.name}, ${n} selected` : `${c.name}, ${values}`);
      return b;
    }));
  }

  function openSheet(cat, opener) {
    const dlg = document.getElementById('filter-sheet');
    const values = categoryTags(store.tags, cat.id);
    const draft = new Set(prefs.sel);
    const result = el('button', { class: 'btn primary glow', type: 'button' });
    const sub = el('p', { class: 't-caption muted' });
    const pills = el('div', { class: 'pills' });
    const mine = () => values.filter((v) => draft.has(v.tag.toLocaleLowerCase())).length;
    const refresh = () => {
      const n = visibleSongs(draft).length;
      result.textContent = `Show ${n} ${n === 1 ? 'song' : 'songs'}`;
      sub.textContent = `${store.songs.length} in your library \u00b7 ${mine()} selected`;
      for (const b of pills.children) b.setAttribute('aria-pressed', String(draft.has(b.dataset.key)));
      for (const b of pills.children) b.classList.toggle('on', draft.has(b.dataset.key));
    };
    pills.append(...values.map((v) => {
      const key = v.tag.toLocaleLowerCase();
      return el('button', {
        class: 'chip t-subhead', type: 'button', title: v.tag, 'data-key': key, 'aria-pressed': 'false',
        onclick: () => { if (draft.has(key)) draft.delete(key); else draft.add(key); refresh(); },
      }, tagLabel(v.tag), el('small', { class: 't-caption' }, v.count));
    }));
    result.addEventListener('click', () => {
      for (const v of values) prefs.sel.delete(v.tag.toLocaleLowerCase());
      for (const k of draft) if (categoryOf(k) === cat.id) prefs.sel.add(k);
      dlg.close();
      renderAll();
    });
    const clear = el('button', { class: 'link-btn t-headline', type: 'button', onclick: () => { for (const v of values) draft.delete(v.tag.toLocaleLowerCase()); refresh(); } }, 'Clear');
    dlg.replaceChildren(
      el('span', { class: 'grab', 'aria-hidden': 'true' }),
      el('div', { class: 'sheet-head' },
        el('div', {}, el('h2', { id: 'sheet-title', class: 't-title' }, cat.name), sub),
        clear),
      pills,
      result);
    refresh();
    dlg.onclick = (e) => { if (e.target === dlg) dlg.close(); };
    dlg.showModal();
    result.focus();
    dlg.addEventListener('close', () => opener.isConnected && opener.focus(), { once: true });
  }

  function renderList() {
    const songs = visibleSongs();
    const cur = player.current;
    count.textContent = !store.loaded ? ''
      : store.songs.length
        ? `${songs.length} of ${store.songs.length} songs`
        : 'No songs yet. Use Add to import one from a YouTube link.';
    const filtered = !!(prefs.sel.size || prefs.query.trim());
    addAll.hidden = !(store.loaded && filtered && songs.length);
    addAll.textContent = `Add all ${songs.length} to playlist`;
    const empty = !songs.length && store.loaded && store.songs.length
      ? [el('li', { class: 'empty muted t-subhead' }, 'No songs match. Clear the search or the filters.')]
      : [];
    list.replaceChildren(...empty, ...songs.map((s) => songCard(s, cur)));
  }

  function renderAll() { renderChips(); renderList(); }

  const unsub = store.subscribe(renderAll);
  const unsubPlayer = player.onChange(renderList);

  if (!store.loaded) status.append(el('p', { class: 'muted t-subhead' }, 'Loading...'));
  const load = () => store.refresh().then(() => status.replaceChildren()).catch((e) => {
    status.replaceChildren(el('p', { class: 'msg error' }, e.message),
      el('button', { class: 'btn', type: 'button', onclick: () => { status.replaceChildren(el('p', { class: 'muted t-subhead' }, 'Loading...')); load(); } }, 'Retry'));
  });
  load();
  renderAll();

  return () => { unsub(); unsubPlayer(); const d = document.getElementById('filter-sheet'); if (d.open) d.close(); };
}

const SVG = 'http://www.w3.org/2000/svg';
function icon(paths) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '20');
  svg.setAttribute('height', '20');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  for (const d of paths) {
    const p = document.createElementNS(SVG, 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  return svg;
}
const playIcon = () => icon(['M7 4.5v15l12-7.5z']);
const addIcon = () => icon(['M4 7h9', 'M4 12h9', 'M4 17h9', 'M18 8v8', 'M14 12h8']);

function songCard(s, cur) {
  return el('li', { class: `song${cur && cur.id === s.id ? ' current' : ''}`, 'aria-current': cur && cur.id === s.id ? 'true' : null },
    coverImg(s),
    el('div', { class: 'info' },
      el('button', { class: 'open t-headline', type: 'button', 'aria-label': `Edit ${s.title}`, onclick: () => editDialog(s) }, s.title),
      s.artist ? el('small', { class: 'artist t-subhead' }, s.artist) : null),
    el('span', { class: 'c-album t-subhead' }, s.album || ''),
    el('span', { class: 'c-year t-subhead' }, s.year || ''),
    el('div', { class: 'meta' },
      s.duration ? el('span', { class: 'dur t-time' }, fmtTime(s.duration)) : null,
      s.bpm != null ? el('span', { class: 'bpm t-time', title: 'Beats per minute' }, `${Math.round(s.bpm)} BPM`) : null),
    el('div', { class: 'btns' },
      el('button', { class: 'icon', type: 'button', title: 'Play now', 'aria-label': `Play now: ${s.title}`, onclick: () => player.playNow(s.id) }, playIcon()),
      el('button', { class: 'icon', type: 'button', title: 'Add to current playlist', 'aria-label': `Add to current playlist: ${s.title}`, onclick: () => addToQueue(s) }, addIcon())),
    (s.tags || []).length ? el('div', { class: 'tags' }, s.tags.map(tagChip)) : null);
}

function addToQueue(s) {
  const r = player.add(s.id);
  toast(r === 'duplicate' ? 'Already in queue' : r === 'queued' ? 'Queued' : 'Added');
}

function coverImg(s) {
  const img = el('img', { class: 'cover', alt: '', loading: 'lazy' });
  if (s.cover) img.src = api.coverUrl(s.id);
  img.addEventListener('error', () => img.removeAttribute('src'));
  return img;
}

function removeSong(s) {
  const dlg = document.getElementById('edit-dialog');
  const err = el('p', { class: 'msg error', hidden: true });
  const del = el('button', { type: 'submit', class: 'btn danger' }, 'Delete');
  const form = el('form', { method: 'dialog' },
    el('h2', {}, 'Delete song?'),
    el('p', {}, `"${s.title}" will be removed from the library. The audio file and cover are deleted from the server.`),
    err,
    el('div', { class: 'row end' },
      el('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, 'Cancel'),
      del));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    del.disabled = true;
    try {
      await api.remove(s.id);
      dlg.close();
      await store.refresh();
      toast('Deleted');
    } catch (ex) {
      if (ex.status === 404) {
        dlg.close();
        await store.refresh().catch(() => {});
        return;
      }
      err.textContent = ex.message;
      err.hidden = false;
      del.disabled = false;
    }
  });
  dlg.replaceChildren(form);
  dlg.showModal();
  del.focus();
}

function editDialog(song) {
  const dlg = document.getElementById('edit-dialog');
  const f = {
    title: el('input', { type: 'text', value: song.title || '', required: true }),
    artist: el('input', { type: 'text', value: song.artist || '' }),
    album: el('input', { type: 'text', value: song.album || '' }),
    year: el('input', { type: 'number', value: song.year ?? '', min: 0, max: 3000 }),
    bpm: el('input', { type: 'number', value: song.bpm != null ? Math.round(song.bpm) : '', min: 20, max: 300, step: 1, placeholder: 'Unknown' }),
  };
  const editor = tagEditor({ tags: song.tags || [], year: f.year });
  const err = el('p', { class: 'msg error', hidden: true });
  const wikiMsg = el('div');
  const wiki = wikiFields({
    song: song.wikipedia_song, artist: song.wikipedia_artist, year: f.year, editor,
    onMessage: (text, kind) => wikiMsg.replaceChildren(el('p', { class: `msg ${kind}` }, text)),
  });
  const field = (label, input) => el('div', {}, el('label', {}, label), input);
  const redetect = el('button', { type: 'button', class: 'btn' }, 'Re-detect');
  redetect.addEventListener('click', async () => {
    redetect.disabled = true;
    redetect.textContent = 'Detecting...';
    try {
      const updated = await api.detectBpm(song.id);
      f.bpm.value = updated.bpm != null ? Math.round(updated.bpm) : '';
      err.hidden = true;
      await store.refresh();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    } finally {
      redetect.disabled = false;
      redetect.textContent = 'Re-detect';
    }
  });
  const form = el('form', { method: 'dialog' },
    el('h2', {}, 'Edit song'),
    field('Title', f.title), field('Artist', f.artist),
    el('div', { class: 'grid2' }, field('Album', f.album), field('Year', f.year)),
    el('div', {}, el('label', {}, 'BPM (heuristic, may be off by half or double)'), el('div', { class: 'row' }, f.bpm, redetect)),
    wiki.node, wikiMsg,
    el('div', {}, el('label', {}, 'Tags'), editor.node),
    err,
    el('div', { class: 'row end' },
      el('button', { type: 'button', class: 'btn danger del-left', onclick: () => removeSong(song) }, 'Delete'),
      el('button', { type: 'button', class: 'btn', onclick: () => dlg.close() }, 'Cancel'),
      el('button', { type: 'submit', class: 'btn primary' }, 'Save')));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api.patch(song.id, {
        title: f.title.value,
        artist: f.artist.value,
        album: f.album.value,
        year: f.year.value === '' ? null : Number(f.year.value),
        bpm: f.bpm.value === '' ? null : Math.round(Number(f.bpm.value)),
        tags: editor.getTags(),
        ...wiki.values(),
      });
      dlg.close();
      await store.refresh();
      toast('Saved');
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    }
  });
  dlg.replaceChildren(form);
  dlg.showModal();
}
