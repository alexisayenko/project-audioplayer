import { api } from './api.js';
import { store } from './store.js';
import { player } from './player.js';
import { el, toast, fmtTime } from './dom.js';
import { icon } from './icons.js';
import { openMenu } from './menu.js';
import { downloads } from './downloads.js';
import { openAdd } from './add.js';
import { editDialog } from './edit-dialog.js';
import { tagLabel, tagSearchText, categoryOf, categoryTags, CATEGORIES } from './tagname.js';

const prefs = { query: '', sel: new Set(), sort: 'added' };

const SORTS = {
  added: ['Recently added', (a, b) => (b.added_at || '').localeCompare(a.added_at || '')],
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
  const total = el('span', { class: 'muted t-caption' });
  const summary = el('p', { class: 'muted t-caption', role: 'status' });
  const list = el('ul', { class: 'songs' });
  const addAll = el('button', { class: 'btn outline small', type: 'button', hidden: true });
  addAll.addEventListener('click', () => {
    const songs = visibleSongs();
    const only = prefs.sel.size === 1 ? store.tags.find((t) => prefs.sel.has(t.tag.toLocaleLowerCase())) : null;
    const { added, already } = player.addListed(songs, only ? only.tag : '');
    toast(`Added ${added} ${added === 1 ? 'song' : 'songs'}${already ? ` (${already} already in queue)` : ''}`);
  });
  const status = el('div');
  const head = el('div', { class: 'table-head', 'aria-hidden': 'true' },
    el('span', {}, '#'), el('span'), el('span', {}, 'Title'), el('span', {}, 'Artist'), el('span', { class: 'c-album' }, 'Album'), el('span', { class: 'c-year' }, 'Year'), el('span', { class: 'c-dur' }, 'Time'), el('span'));
  const group = el('div', { class: 'group' }, head, list);

  root.append(
    el('header', { class: 'page-head lib-head' },
      el('div', { class: 'page-title' },
        el('p', { class: 't-eyebrow' }, 'ELECTROPHONE'),
        el('h1', { class: 't-display' }, 'Library')),
      el('div', { class: 'head-actions' }, total,
        el('button', { class: 'btn primary glow', type: 'button', onclick: openAdd }, icon('plus', 18), 'Add song'))),
    el('div', { class: 'toolbar' },
      el('label', { class: 'search' }, icon('search', 18), search),
      cats),
    el('div', { class: 'sortbar' },
      el('label', { class: 'sort t-headline' }, sort, icon('chevron', 16)),
      summary, addAll),
    group,
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
    const result = el('button', { class: 'btn primary glow big', type: 'button' });
    const sub = el('p', { class: 't-caption muted' });
    const pills = el('div', { class: 'pills' });
    const mine = () => values.filter((v) => draft.has(v.tag.toLocaleLowerCase())).length;
    const refresh = () => {
      const n = visibleSongs(draft).length;
      result.textContent = `Show ${n} ${n === 1 ? 'song' : 'songs'}`;
      sub.textContent = `${values.length} in your library · ${mine()} selected`;
      for (const b of pills.children) {
        b.setAttribute('aria-pressed', String(draft.has(b.dataset.key)));
        b.classList.toggle('on', draft.has(b.dataset.key));
      }
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
    const clear = el('button', { class: 'link-btn t-subhead strong', type: 'button', onclick: () => { for (const v of values) draft.delete(v.tag.toLocaleLowerCase()); refresh(); } }, 'Clear');
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

  function selectedNames() {
    return [...prefs.sel].map((k) => store.tags.find((t) => t.tag.toLocaleLowerCase() === k)).filter(Boolean).slice(0, 3).map((t) => tagLabel(t.tag));
  }

  function renderList() {
    const songs = visibleSongs();
    const cur = player.current;
    const pending = downloads.list();
    const filtered = !!(prefs.sel.size || prefs.query.trim());
    total.textContent = store.loaded ? `${store.songs.length} ${store.songs.length === 1 ? 'song' : 'songs'}` : '';
    summary.textContent = !store.loaded ? ''
      : !store.songs.length ? ''
        : filtered ? `${songs.length} ${songs.length === 1 ? 'song matches' : 'songs match'}${prefs.sel.size ? ` · ${selectedNames().join(', ')}` : ''}`
          : '';
    addAll.hidden = !(store.loaded && filtered && songs.length);
    addAll.textContent = `Add all ${songs.length} to playlist`;
    const nothing = store.loaded && !store.songs.length && !pending.length;
    group.hidden = nothing || (!store.loaded && !pending.length);
    paintStatus(nothing);
    const empty = !songs.length && store.loaded && store.songs.length
      ? [el('li', { class: 'empty muted t-subhead' }, 'No songs match. Clear the search or the filters.')]
      : [];
    let n = 0;
    list.replaceChildren(
      ...(filtered ? [] : pending.map((d) => pendingRow(d, ++n))),
      ...empty,
      ...songs.map((s) => songRow(s, cur, ++n)));
  }

  function renderAll() { renderChips(); renderList(); }

  const unsub = store.subscribe(renderAll);
  const unsubPlayer = player.onChange(renderList);
  const unsubDownloads = downloads.onChange(renderList);

  let loadError = null;
  function paintStatus(nothing) {
    if (loadError) {
      status.replaceChildren(el('div', { class: 'state card' },
        el('p', { class: 'msg error' }, loadError),
        el('button', { class: 'btn', type: 'button', onclick: () => { loadError = null; load(); renderList(); } }, 'Retry')));
    } else if (!store.loaded) {
      status.replaceChildren(el('p', { class: 'muted t-subhead state', role: 'status' }, 'Loading your library...'));
    } else if (nothing) {
      status.replaceChildren(el('div', { class: 'state card' },
        el('p', { class: 't-headline' }, 'No songs yet'),
        el('p', { class: 'muted t-subhead' }, 'Paste a YouTube link and the server downloads the audio into your library.'),
        el('button', { class: 'btn primary glow', type: 'button', onclick: openAdd }, icon('plus', 18), 'Add song')));
    } else {
      status.replaceChildren();
    }
  }
  const load = () => store.refresh().catch((e) => { loadError = e.message; renderList(); });
  load();
  renderAll();

  return () => { unsub(); unsubPlayer(); unsubDownloads(); const d = document.getElementById('filter-sheet'); if (d.open) d.close(); };
}

function cover(s) {
  const img = el('img', { class: 'cover', alt: '', loading: 'lazy' });
  if (s && s.cover) img.src = api.coverUrl(s.id);
  img.addEventListener('error', () => img.removeAttribute('src'));
  return img;
}

function songRow(s, cur, n) {
  const here = cur && cur.id === s.id;
  const more = el('button', { class: 'more', type: 'button', 'aria-label': `More: ${s.title}`, 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, icon('more', 20));
  more.addEventListener('click', () => openMenu(more, [
    { label: 'Play now', run: () => player.playNow(s.id) },
    { label: 'Add to playlist', run: () => addToQueue(s) },
    { label: 'Edit song', run: () => editDialog(s) },
  ]));
  return el('li', { class: `song${here ? ' current' : ''}`, 'aria-current': here ? 'true' : null },
    el('span', { class: 'c-idx t-time' }, n),
    cover(s),
    el('div', { class: 'info' },
      el('button', { class: 'open t-headline', type: 'button', title: 'Play now', onclick: () => player.playNow(s.id) }, s.title),
      s.artist ? el('small', { class: 'sub t-subhead' }, s.artist) : null),
    el('span', { class: 'c-artist t-subhead' }, s.artist || ''),
    el('span', { class: 'c-album t-subhead' }, s.album || ''),
    el('span', { class: 'c-year t-subhead' }, s.year || ''),
    el('span', { class: 'c-dur t-time' }, s.duration ? fmtTime(s.duration) : ''),
    more);
}

function pendingRow(d, n) {
  const pct = `Downloading ${Math.round((d.progress || 0) * 100)}%`;
  const img = el('img', { class: 'cover', alt: '', loading: 'lazy' });
  if (d.thumbnail) img.src = d.thumbnail;
  img.addEventListener('error', () => img.removeAttribute('src'));
  return el('li', { class: 'song pending' },
    el('span', { class: 'c-idx t-time' }, n),
    img,
    el('div', { class: 'info' },
      el('span', { class: 'open t-headline' }, d.title),
      d.artist ? el('small', { class: 'sub t-subhead' }, d.artist) : null),
    el('span', { class: 'c-artist t-subhead' }, d.artist || ''),
    el('span', { class: 'c-album' }),
    el('span', { class: 'c-year' }),
    el('span', { class: 'c-dur t-subhead dl', role: 'status' }, pct),
    el('span'));
}

function addToQueue(s) {
  const r = player.add(s.id);
  toast(r === 'duplicate' ? 'Already in queue' : r === 'queued' ? 'Queued' : 'Added');
}
