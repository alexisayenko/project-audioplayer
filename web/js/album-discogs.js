import { api } from './api.js';
import { el } from './dom.js';
import { icon } from './icons.js';
import { normalType } from './album-video-model.js';

const MAX_GENRES = 4;
const ERRORS = { discogs_unavailable: 'Discogs search is not set up on this server.', discogs_failed: 'Discogs could not be reached. Try again later.' };

export const candidateMeta = (c) => [c.year, c.label, c.trackCount ? `${c.trackCount} tracks` : ''].filter(Boolean).join(' · ');

export function mergeGenres(current, picked) {
  const have = [...new Set((current || []).map((g) => String(g).trim()).filter(Boolean))];
  const fold = new Set(have.map((g) => g.toLowerCase()));
  for (const g of (picked || []).map((x) => String(x).trim())) {
    if (g && have.length < MAX_GENRES && !fold.has(g.toLowerCase())) { have.push(g); fold.add(g.toLowerCase()); }
  }
  return have;
}

export function discogsFinder({ form, editor, onPick, search = api.albumDiscogsFind, resolve = api.albumDiscogsResolve }) {
  const status = el('p', { class: 't-caption muted discogs-status', role: 'status' });
  const list = el('ul', { class: 'discogs-list', 'aria-label': 'Discogs releases' });
  const btn = el('button', { class: 'btn outline small discogs-find', type: 'button' }, icon('search', 'inline'), 'Find on Discogs');
  const dismiss = el('button', { class: 'link-btn t-caption', type: 'button', hidden: true }, 'Dismiss');
  const showAll = el('button', { class: 'link-btn t-caption discogs-all', type: 'button', hidden: true }, 'Show all releases');
  const clear = () => { list.replaceChildren(); dismiss.hidden = true; showAll.hidden = true; };
  dismiss.addEventListener('click', () => { clear(); status.textContent = ''; });

  async function pick(c) {
    if (c.kind === 'master' && !c.type) {
      status.textContent = 'Reading the album on Discogs...';
      try {
        const res = await resolve({ kind: 'master', id: c.id });
        if (res?.candidate) c = { ...c, ...res.candidate };
      } catch (ex) {
        status.textContent = '';
      }
    }
    if (c.url) form.links.inputs.discogs.value = c.url;
    if (c.year) form.yearIn.value = String(c.year);
    if (c.type) form.typeSel.value = normalType(c.type);
    editor.commit();
    const merged = mergeGenres(editor.get(), c.genres);
    editor.addTags(merged.map((g) => `genre:${g}`));
    form.links.paint();
    for (const n of [form.yearIn, form.links.inputs.discogs]) n.dispatchEvent(new Event('input', { bubbles: true }));
    form.typeSel.dispatchEvent(new Event('change', { bubbles: true }));
    onPick?.(c);
    clear();
    status.textContent = `Filled from "${c.artist} - ${c.title}".`;
  }

  function row(c) {
    const thumb = c.cover ? el('img', { class: 'discogs-thumb', src: c.cover, alt: '', loading: 'lazy' }) : el('span', { class: 'discogs-thumb' });
    return el('li', { class: 'song discogs-pick' },
      el('button', { class: 'discogs-choose', type: 'button', 'aria-label': `Use ${c.artist} - ${c.title}`, onclick: () => pick(c) },
        thumb,
        el('span', { class: 'info' },
          el('span', { class: 'title-line' }, el('span', { class: 'ttl t-headline' }, [c.artist, c.title].filter(Boolean).join(' - '))),
          el('span', { class: 'sub-line' }, el('span', { class: 'sub t-subhead' }, candidateMeta(c))))));
  }

  async function run(all) {
    const artist = form.artist();
    const title = form.title();
    if (!title && !artist) { status.textContent = 'Type an album artist or title first.'; return; }
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    status.textContent = 'Searching Discogs...';
    clear();
    let res;
    try {
      res = await search({ artist, title, year: Number(form.year()) || null, ...(all ? { all: true } : {}) });
    } catch (ex) {
      res = { candidates: [], searchError: 'discogs_failed' };
    }
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
    const found = Array.isArray(res?.candidates) ? res.candidates : [];
    status.textContent = found.length ? (all ? 'Pick the release to fill the year, genres, type and link.' : 'Pick the album to fill the year, genres, type and link.') : (ERRORS[res?.searchError] || 'No releases found on Discogs.');
    list.replaceChildren(...found.map(row));
    dismiss.hidden = !found.length;
    showAll.hidden = all || !found.length;
  }

  btn.addEventListener('click', () => run(false));
  showAll.addEventListener('click', () => run(true));

  return { node: el('div', { class: 'discogs-finder' }, el('div', { class: 'row discogs-bar' }, btn, dismiss), status, list, showAll), pick, btn, list, status, showAll };
}
