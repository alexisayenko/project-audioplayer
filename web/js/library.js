import { api } from './api.js';
import { store } from './store.js';
import { player } from './player.js';
import { el, toast, fmtTime } from './dom.js';
import { tagEditor } from './tag-editor.js';
import { wikiFields } from './wiki-links.js';
import { tagChip, tagGroups, tagLabel, tagSearchText } from './tagname.js';

const prefs = { query: '', tag: '', sort: 'added' };

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

export function visibleSongs() {
  const q = prefs.query.trim().toLocaleLowerCase();
  const tag = prefs.tag.toLocaleLowerCase();
  const list = store.songs.filter((s) => {
    if (tag && !(s.tags || []).some((t) => t.toLocaleLowerCase() === tag)) return false;
    if (!q) return true;
    const hay = [s.title, s.artist, s.album, ...(s.tags || []).map(tagSearchText)].join('\n').toLocaleLowerCase();
    return hay.includes(q);
  });
  return list.sort(SORTS[prefs.sort][1]);
}

export function renderLibrary(root) {
  const search = el('input', {
    type: 'search', placeholder: 'Search title, artist, album, tags', value: prefs.query,
    'aria-label': 'Search',
    oninput: (e) => { prefs.query = e.target.value; renderList(); },
  });
  const sort = el('select', {
    'aria-label': 'Sort',
    onchange: (e) => { prefs.sort = e.target.value; renderList(); },
  }, Object.entries(SORTS).map(([k, [label]]) => el('option', { value: k, selected: k === prefs.sort }, label)));
  const chips = el('div', { class: 'chip-groups' });
  const count = el('p', { class: 'muted' });
  const list = el('ul', { class: 'songs' });
  const status = el('div');

  root.append(el('div', { class: 'toolbar' }, el('div', { class: 'row' }, search, sort), chips), count, list, status);

  function renderChips() {
    if (prefs.tag && !store.tags.some((t) => t.tag.toLocaleLowerCase() === prefs.tag.toLocaleLowerCase())) prefs.tag = '';
    chips.replaceChildren(...tagGroups(store.tags).map((g) => el('div', { class: 'chip-group' },
      el('span', { class: 'group-name' }, g.name),
      ...g.tags.map((t) => el('button', {
        class: `chip${t.tag.toLocaleLowerCase() === prefs.tag.toLocaleLowerCase() ? ' on' : ''}`,
        title: t.tag,
        onclick: () => { prefs.tag = prefs.tag.toLocaleLowerCase() === t.tag.toLocaleLowerCase() ? '' : t.tag; renderChips(); renderList(); },
      }, tagLabel(t.tag), el('small', {}, t.count))))));
  }

  function renderList() {
    const songs = visibleSongs();
    const cur = player.current;
    count.textContent = !store.loaded ? ''
      : store.songs.length
        ? `${songs.length} of ${store.songs.length} songs`
        : 'No songs yet. Use Add to import one from a YouTube link.';
    const empty = !songs.length && store.loaded && store.songs.length
      ? [el('li', { class: 'empty muted' }, 'No songs match. Clear the search or the tag filter.')]
      : [];
    list.replaceChildren(...empty, ...songs.map((s) => songCard(s, cur)));
  }

  function renderAll() { renderChips(); renderList(); }

  const unsub = store.subscribe(renderAll);
  const unsubPlayer = player.onChange(renderList);

  if (!store.loaded) status.append(el('p', { class: 'muted' }, 'Loading...'));
  const load = () => store.refresh().then(() => status.replaceChildren()).catch((e) => {
    status.replaceChildren(el('p', { class: 'msg error' }, e.message),
      el('button', { class: 'btn', type: 'button', onclick: () => { status.replaceChildren(el('p', { class: 'muted' }, 'Loading...')); load(); } }, 'Retry'));
  });
  load();
  renderAll();

  return () => { unsub(); unsubPlayer(); };
}

const SVG = 'http://www.w3.org/2000/svg';
function icon(paths) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '22');
  svg.setAttribute('height', '22');
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
  const sub = [s.artist, s.album, s.year].filter(Boolean).join(', ');
  return el('li', { class: `song${cur && cur.id === s.id ? ' current' : ''}` },
    coverImg(s),
    el('div', { class: 'info' },
      el('button', { class: 'open', type: 'button', 'aria-label': `Edit ${s.title}`, onclick: () => editDialog(s) }, s.title),
      sub ? el('small', {}, sub) : null),
    el('div', { class: 'side' },
      el('div', { class: 'meta' },
        s.bpm != null ? el('span', { class: 'bpm', title: 'Beats per minute' }, `${Math.round(s.bpm)} BPM`) : null,
        s.duration ? el('span', { class: 'dur' }, fmtTime(s.duration)) : null),
      el('div', { class: 'btns' },
        el('button', { class: 'icon', type: 'button', title: 'Play now', 'aria-label': `Play now: ${s.title}`, onclick: () => player.playNow(s.id) }, playIcon()),
        el('button', { class: 'icon', type: 'button', title: 'Add to current playlist', 'aria-label': `Add to current playlist: ${s.title}`, onclick: () => addToQueue(s) }, addIcon()))),
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
  const editor = tagEditor({ tags: song.tags || [] });
  const dlg = document.getElementById('edit-dialog');
  const f = {
    title: el('input', { type: 'text', value: song.title || '', required: true }),
    artist: el('input', { type: 'text', value: song.artist || '' }),
    album: el('input', { type: 'text', value: song.album || '' }),
    year: el('input', { type: 'number', value: song.year ?? '', min: 0, max: 3000 }),
    bpm: el('input', { type: 'number', value: song.bpm != null ? Math.round(song.bpm) : '', min: 20, max: 300, step: 1, placeholder: 'Unknown' }),
  };
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
