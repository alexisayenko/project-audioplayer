import { el } from './dom.js';
import { icon } from './icons.js';
import { player } from './player.js';
import { isGuest } from './guest.js';
import { openAdd, openSongCard } from './lazy-ui.js';
import { store } from './store.js';
import { api } from './api.js';
import {
  roleLabel, sourceTypeLabel, entrySources, addLinkFor, entryLine,
  loadReferences, genreReferenceData, onReferencesChange, sortEras, sortEntries,
} from './references.js';

export const EMPTY_REFERENCES = 'No reference tracks yet.';
export const NOT_IN_LIBRARY = 'Not in library';

const isCurrent = (id) => player.currentId === id;

function paintPlay(btn, e) {
  const on = isCurrent(btn.getAttribute('data-song')) && player.playing;
  const label = on ? 'Pause' : 'Play';
  btn.title = label;
  btn.setAttribute('aria-label', `${label} ${entryLine(e)}`);
  btn.setAttribute('data-state', on ? 'playing' : 'idle');
  btn.replaceChildren(icon(on ? 'pause' : 'play', 'inline'));
}

export function eraSelect(eras, value = '') {
  return el('select', { 'aria-label': 'Era' },
    el('option', { value: '' }, 'None'),
    ...sortEras(eras).map((e) => el('option', { value: e.id, selected: e.id === value }, e.name)));
}

export function linkText(url) {
  try {
    const u = new URL(url);
    const path = u.pathname === '/' ? '' : u.pathname;
    const text = `${u.hostname.replace(/^www\./, '')}${path}`;
    return text.length > 48 ? `${text.slice(0, 45)}...` : text;
  } catch {
    return url;
  }
}

const DATE_PREFIX = /^\s*(?:c\.?\s*|circa\s+|from\s+|since\s+)?\d{4}s?(?:\s*(?:-|–|—|to|until)\s*(?:(?:early|late|mid)\s+)?(?:\d{2,4}s?|present|now)|\s+onward)?\s*[.:;,–—-]*\s*/i;

export function eraNoteText(note) {
  const text = typeof note === 'string' ? note.trim() : '';
  if (!text) return '';
  const rest = text.replace(DATE_PREFIX, '').trim();
  if (rest === text) return text;
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

export function eraSpan(era) {
  const start = Number.isInteger(era?.start) ? era.start : null;
  const end = Number.isInteger(era?.end) ? era.end : null;
  if (start != null && end != null) {
    if (start === end) return String(start);
    const short = Math.floor(start / 100) === Math.floor(end / 100) ? String(end % 100).padStart(2, '0') : String(end);
    return `${start}-${short}`;
  }
  if (start != null) return `${start}-`;
  if (end != null) return `-${end}`;
  return '';
}

export function createReferencesPanel() {
  const node = el('section', { class: 'ref-panel', 'aria-label': 'Eras and reference tracks', hidden: true });
  let genre = null;
  let entries = [];
  let eras = [];
  let seq = 0;
  let ready = false;
  let unsubPlayer = null;
  const playing = new Map();

  function syncPlay() {
    for (const [btn, e] of playing) paintPlay(btn, e);
  }

  function stopPlayer() {
    if (unsubPlayer) { unsubPlayer(); unsubPlayer = null; }
    playing.clear();
  }

  async function refresh(force = false) {
    const mine = ++seq;
    const name = genre;
    if (!name) return;
    try {
      const got = await genreReferenceData(name, { force });
      if (mine !== seq || name !== genre) return;
      entries = got.references;
      eras = got.eras;
    } catch {
      if (mine !== seq) return;
      entries = [];
      eras = [];
    }
    paint();
  }

  function actionNode(e) {
    if (e.in_library && (e.song?.id || e.song_id)) {
      const id = e.song?.id || e.song_id;
      const btn = el('button', { class: 'icon sq-btn ref-play', type: 'button', 'data-song': id, onclick: () => (isCurrent(id) ? player.toggle() : player.playNow(id)) });
      paintPlay(btn, e);
      playing.set(btn, e);
      return btn;
    }
    const url = addLinkFor(e);
    if (url) return el('button', { class: 'btn outline small ref-add-lib', type: 'button', onclick: (ev) => openAdd({ url, note: `Reference track: ${entryLine(e)}.` }, ev.currentTarget) }, 'Add to library');
    return el('span', { class: 'muted t-caption ref-none' }, NOT_IN_LIBRARY);
  }

  function srcLinks(item) {
    return entrySources(item).map((s) => el('a', {
      class: 'ref-src', href: s.url, target: '_blank', rel: 'noopener noreferrer', title: `${sourceTypeLabel(s.type)}: ${linkText(s.url)}`,
      'aria-label': `${sourceTypeLabel(s.type)}: ${s.url} (opens in a new tab)`,
    }, icon('externalLink', 'inline')));
  }

  function titleNode(e) {
    const id = e.in_library ? (e.song?.id || e.song_id) : null;
    const song = id ? (store.get(id) || e.song) : null;
    if (!song) return el('span', { class: 'ref-title t-subhead' }, e.title);
    return el('button', { class: 'ref-title ref-line-btn t-subhead', type: 'button', onclick: (ev) => { void openSongCard(song, ev.currentTarget); } }, e.title);
  }

  function coverNode(e) {
    const id = e.in_library ? (e.song?.id || e.song_id) : null;
    const s = id ? (store.get(id) || e.song) : null;
    const img = el('img', { class: 'cover ref-cover', alt: '', loading: 'lazy' });
    if (s?.cover) img.src = api.coverUrl(s.id, s.cover_v);
    img.addEventListener('error', () => img.removeAttribute('src'));
    return img;
  }

  function item(e) {
    return el('li', { class: 'ref-item', 'data-id': e.id, 'data-role': e.role },
      el('div', { class: 'ref-main' },
        coverNode(e),
        el('div', { class: 'ref-text' },
          titleNode(e),
          el('div', { class: 'ref-sub-line' },
            el('span', { class: `ref-role t-caption role-${e.role}` }, roleLabel(e.role)),
            el('span', { class: 'ref-sub t-caption' }, `${e.artist}${e.year ? ` · ${e.year}` : ''}`))),
        ...srcLinks(e),
        el('span', { class: 'ref-actions' }, actionNode(e))),
      e.note ? el('p', { class: 'ref-note t-caption muted' }, e.note) : null);
  }

  function phase(era) {
    const years = eraSpan(era);
    const srcs = entrySources(era);
    return el('li', { class: 'ref-phase', 'data-era': era.id },
      el('span', { class: 'ref-node', 'aria-hidden': 'true' }),
      el('div', { class: 'ref-phase-title' },
        years ? el('span', { class: 'ref-era-years t-caption muted' }, years) : null,
        el('h4', { class: 'ref-era-name t-subhead' }, era.name),
        srcs.length ? el('span', { class: 'ref-cites t-caption', role: 'group', 'aria-label': 'Sources' }, ...srcs.map((s, i) => el('a', {
          class: 'ref-cite', href: s.url, target: '_blank', rel: 'noopener noreferrer', title: `${sourceTypeLabel(s.type)}: ${linkText(s.url)}`,
          'aria-label': `Source ${i + 1}: ${sourceTypeLabel(s.type)} (opens in a new tab)`,
        }, `[${i + 1}]`))) : null),
      eraNoteText(era.note) ? el('p', { class: 'ref-era-note t-caption muted' }, eraNoteText(era.note)) : null);
  }

  function paintParts() {
    const phases = sortEras(eras);
    if (!phases.length && !entries.length) return [el('p', { class: 'ref-empty muted t-caption' }, EMPTY_REFERENCES)];
    const parts = [el('hr', { class: 'ref-rule' })];
    if (phases.length) parts.push(el('ol', { class: 'ref-timeline', 'aria-label': 'Eras' }, phases.map(phase)), el('hr', { class: 'ref-rule' }));
    if (entries.length) parts.push(el('h3', { class: 'ref-head t-caption' }, 'Reference tracks'), el('ul', { class: 'ref-list' }, sortEntries(entries).map(item)));
    return parts;
  }

  function paint() {
    playing.clear();
    node.hidden = !genre || !ready;
    node.replaceChildren(...(node.hidden ? [] : paintParts()));
    if (playing.size && !unsubPlayer) unsubPlayer = player.onChange(syncPlay);
    else if (!playing.size) stopPlayer();
  }

  const unsub = onReferencesChange(() => { if (genre) paint(); });

  return {
    node,
    show(name) {
      const next = name || null;
      if (next !== genre) { entries = []; eras = []; }
      genre = next;
      seq += 1;
      if (!genre || isGuest()) { genre = null; ready = false; node.hidden = true; node.replaceChildren(); stopPlayer(); return; }
      ready = true;
      void loadReferences().then(() => { if (genre === next) paint(); });
      void refresh();
    },
    destroy() { genre = null; unsub(); stopPlayer(); },
  };
}
