import { el, fmtTime } from './dom.js';
import { icon } from './icons.js';
import { isGuest } from './guest.js';
import { openAdd, openSongCard } from './lazy-ui.js';
import { store } from './store.js';
import { api } from './api.js';
import { hasAudio } from './playable.js';
import { autodl } from './autodl.js';
import { ringModel } from './dl-progress.js';
import { paintRing } from './dl-ring.js';
import { fetchControl } from './dl-control.js';
import {
  roleLabel, sourceTypeLabel, entrySources, addPrefillFor, entryLine,
  loadReferences, genreReferenceData, onReferencesChange, sortEras, sortEntries,
} from './references.js';

export const EMPTY_REFERENCES = 'No reference tracks yet.';
export const NOT_IN_LIBRARY = 'Not in library';

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

const artistYear = (e) => {
  const year = e.year ? ` · ${e.year}` : '';
  return `${e.artist}${year}`;
};

export function createReferencesPanel({ compact = false } = {}) {
  const node = el('section', { class: compact ? 'ref-panel is-compact' : 'ref-panel', 'aria-label': 'Eras and reference tracks', hidden: true });
  let genre = null;
  let historyOpen = false;
  let entries = [];
  let eras = [];
  let seq = 0;
  let ready = false;
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
    if (e.in_library && (e.song?.id || e.song_id)) return null;
    const prefill = addPrefillFor(e);
    const open = (ev) => openAdd({ ...prefill, note: `Reference track: ${entryLine(e)}.` }, ev.currentTarget);
    if (compact) {
      if (!prefill) return null;
      return el('button', {
        class: 'icon sq-btn ref-add-lib ref-add-quick', type: 'button', title: 'Add to library', 'aria-label': `Add to library: ${entryLine(e)}`, onclick: open,
      }, icon('plus', 'inline'));
    }
    if (prefill) return el('button', { class: 'btn outline small ref-add-lib', type: 'button', onclick: open }, 'Add to library');
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
    if (!song) return el('span', { class: 'open ref-title t-headline' }, el('span', { class: 'ttl' }, e.title));
    return el('button', { class: 'open ref-title t-headline', type: 'button', onclick: (ev) => { void openSongCard(song, ev.currentTarget); } }, el('span', { class: 'ttl' }, e.title));
  }

  function coverNode(e) {
    const id = e.in_library ? (e.song?.id || e.song_id) : null;
    const s = id ? (store.get(id) || e.song) : null;
    const img = el('img', { class: 'cover', alt: '', loading: 'lazy' });
    if (s?.cover) img.src = api.coverUrl(s.id, s.cover_v);
    img.addEventListener('error', () => img.removeAttribute('src'));
    return el('div', { class: 'row-cover' }, compact ? el('span', { class: 'cover-mark', 'aria-hidden': 'true' }, icon('coverPlaceholder')) : null, img);
  }

  function lengthNode(e) {
    const id = e.in_library ? (e.song?.id || e.song_id) : null;
    const duration = id ? (store.get(id) || e.song)?.duration : null;
    return Number.isFinite(duration) && duration > 0 ? el('span', { class: 'title-len t-time', title: 'Length' }, fmtTime(duration)) : null;
  }

  function librarySong(e) {
    const id = e.in_library ? (e.song?.id || e.song_id) : null;
    return id ? (store.get(id) || e.song || null) : null;
  }

  function needsAudio(e) {
    const song = librarySong(e);
    if (!song) return false;
    return song.audio_state ? song.audio_state === 'none' : !hasAudio(song);
  }

  function trailingNode(e) {
    if (!e.in_library || !(e.song?.id || e.song_id)) return actionNode(e);
    if (needsAudio(e)) return fetchControl(e.song?.id || e.song_id, entryLine(e));
    return lengthNode(e);
  }

  function compactItem(e) {
    return el('li', { class: 'song ref-item', 'data-id': e.id, 'data-role': e.role, 'data-song': needsAudio(e) ? (e.song?.id || e.song_id) : null, title: e.note || null },
      coverNode(e),
      el('div', { class: 'info' },
        el('div', { class: 'title-line' }, titleNode(e), trailingNode(e)),
        el('div', { class: 'sub-line' },
          el('small', { class: 'sub t-subhead', title: artistYear(e) }, el('span', { class: 'ref-artist' }, e.artist), e.year ? el('span', { class: 'ref-year' }, ` · ${e.year}`) : null),
          el('span', { class: 'ref-role t-caption' }, roleLabel(e.role)))));
  }

  function item(e) {
    if (compact) return compactItem(e);
    return el('li', { class: 'song ref-item', 'data-id': e.id, 'data-role': e.role },
      coverNode(e),
      el('div', { class: 'info' },
        el('div', { class: 'title-line' }, titleNode(e), ...srcLinks(e)),
        el('div', { class: 'sub-line' }, el('small', { class: 'sub t-subhead' }, artistYear(e))),
        actionNode(e),
        e.note ? el('p', { class: 'ref-note t-caption muted' }, e.note) : null),
      el('span', { class: 'ref-role t-caption' }, roleLabel(e.role)));
  }

  function phase(era) {
    const years = eraSpan(era);
    return el('li', { class: 'ref-phase', 'data-era': era.id },
      el('span', { class: 'ref-node', 'aria-hidden': 'true' }),
      el('div', { class: 'ref-phase-title' },
        years ? el('span', { class: 'ref-era-years t-caption muted' }, years) : null,
        el('h4', { class: 'ref-era-name t-subhead' }, era.name)),
      eraNoteText(era.note) ? el('p', { class: 'ref-era-note t-caption muted' }, eraNoteText(era.note)) : null);
  }

  function historyNode(phases) {
    const details = el('details', { class: 'ref-history', open: historyOpen },
      el('summary', { class: 'ref-history-head t-caption' }, el('span', {}, 'History'), icon('chevron', 'inline')),
      el('ol', { class: 'ref-timeline', 'aria-label': 'Eras' }, phases.map(phase)));
    details.addEventListener('toggle', () => { historyOpen = details.open; });
    return details;
  }

  function paintCompact() {
    const phases = sortEras(eras);
    if (!phases.length && !entries.length) return [el('p', { class: 'ref-empty muted t-caption' }, EMPTY_REFERENCES)];
    const parts = [];
    if (phases.length) parts.push(historyNode(phases));
    if (entries.length) parts.push(el('h3', { class: 'ref-head t-caption' }, `Reference tracks · ${entries.length}`), el('ul', { class: 'ref-list' }, sortEntries(entries).map(item)));
    return parts;
  }

  function paintParts() {
    if (compact) return paintCompact();
    const phases = sortEras(eras);
    if (!phases.length && !entries.length) return [el('p', { class: 'ref-empty muted t-caption' }, EMPTY_REFERENCES)];
    const parts = [el('hr', { class: 'ref-rule' })];
    if (phases.length) parts.push(el('ol', { class: 'ref-timeline', 'aria-label': 'Eras' }, phases.map(phase)), el('hr', { class: 'ref-rule' }));
    if (entries.length) parts.push(el('h3', { class: 'ref-head t-caption' }, 'Reference tracks'), el('ul', { class: 'ref-list' }, sortEntries(entries).map(item)));
    return parts;
  }

  function paint() {
    node.hidden = !genre || !ready;
    node.replaceChildren(...(node.hidden ? [] : paintParts()));
  }

  function paintDownloads() {
    if (!genre || !ready) return;
    for (const row of node.querySelectorAll('.ref-item[data-song]')) {
      const model = ringModel(autodl.view(row.dataset.song));
      const ring = row.querySelector('.dl-ring');
      if (!model && !ring) continue;
      if (!model || !ring || !paintRing(ring, model)) { paint(); return; }
    }
  }

  const unsubRefs = onReferencesChange(() => { if (genre) paint(); });
  const unsubStore = compact ? store.subscribe(() => { if (genre && ready) paint(); }) : null;
  const unsubDl = compact ? autodl.onChange(paintDownloads) : null;
  const unsub = () => { unsubRefs(); unsubStore?.(); unsubDl?.(); };

  return {
    node,
    show(name) {
      const next = name || null;
      if (next !== genre) { entries = []; eras = []; }
      genre = next;
      seq += 1;
      historyOpen = false;
      if (!genre || isGuest()) { genre = null; ready = false; node.hidden = true; node.replaceChildren(); return; }
      ready = true;
      void loadReferences().then(() => { if (genre === next) paint(); });
      void refresh();
    },
    destroy() { genre = null; unsub(); },
  };
}
