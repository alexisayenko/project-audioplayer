import { el, toast } from './dom.js';
import { icon } from './icons.js';
import { player } from './player.js';
import { isGuest } from './guest.js';
import { openAdd } from './lazy-ui.js';
import {
  ROLES, SOURCE_TYPES, MAX_SOURCES, roleLabel, sourceTypeLabel, entrySources, sourceCount, sourcesTip, addLinkFor, entryLine,
  loadReferences, genreReferenceData, isReferenceOwner, onReferencesChange, sortEras, groupByEra, eraYears, cleanEras, saveEras,
  addReference, patchReference, deleteReference, cleanSources, buildBody, patchBodyFor,
} from './references.js';

export const EMPTY_REFERENCES = 'No reference tracks yet.';
export const NOT_IN_LIBRARY = 'Not in library';
export const NO_ERA_TRACKS = 'No tracks yet.';
export const OTHER_ERA = 'Other';

export function eraSelect(eras, value = '') {
  return el('select', { 'aria-label': 'Era' },
    el('option', { value: '' }, 'None'),
    ...sortEras(eras).map((e) => el('option', { value: e.id, selected: e.id === value }, e.name)));
}

const roleSelect = (value) => el('select', { 'aria-label': 'Role' }, ROLES.map((r) => el('option', { value: r, selected: r === value }, roleLabel(r))));

function sourceRow(src, onRemove) {
  const type = el('select', { 'aria-label': 'Source type' }, Object.entries(SOURCE_TYPES).map(([k, v]) => el('option', { value: k, selected: k === (src?.type || 'other') }, v)));
  const url = el('input', { type: 'url', placeholder: 'https://', 'aria-label': 'Source link', value: src?.url || '', autocomplete: 'off' });
  const note = el('input', { type: 'text', placeholder: 'Note (optional)', 'aria-label': 'Source note', value: src?.note || '', autocomplete: 'off' });
  const rm = el('button', { class: 'icon sq-btn', type: 'button', title: 'Remove source', 'aria-label': 'Remove source', onclick: () => onRemove() }, icon('clear', 'inline'));
  const node = el('div', { class: 'ref-src-row' }, type, url, note, rm);
  return { node, value: () => ({ type: type.value, url: url.value, note: note.value }) };
}

export function sourcesEditor(initial = []) {
  const rows = [];
  const box = el('div', { class: 'ref-sources-edit', role: 'group', 'aria-label': 'Sources' });
  const add = el('button', { class: 'btn outline small', type: 'button', onclick: () => push() }, icon('plus', 'inline'), 'Add source');
  function sync() { add.hidden = rows.length >= MAX_SOURCES; }
  function push(src) {
    if (rows.length >= MAX_SOURCES) return;
    const row = sourceRow(src, () => { rows.splice(rows.indexOf(row), 1); row.node.remove(); sync(); });
    rows.push(row);
    box.append(row.node);
    sync();
  }
  for (const s of initial) push(s);
  return { node: el('div', {}, box, add), values: () => rows.map((r) => r.value()) };
}

function referenceForm(genre, entry, eras, done) {
  const editing = !!entry;
  const artist = el('input', { type: 'text', placeholder: 'Artist', 'aria-label': 'Artist', value: entry?.artist || '', readonly: editing, autocomplete: 'off' });
  const title = el('input', { type: 'text', placeholder: 'Title', 'aria-label': 'Title', value: entry?.title || '', readonly: editing, autocomplete: 'off' });
  const year = el('input', { type: 'number', placeholder: 'Year', 'aria-label': 'Year', value: entry?.year ?? '', min: '1900', max: '2100' });
  const role = roleSelect(entry?.role || 'archetype');
  const note = el('input', { type: 'text', placeholder: 'Note (optional)', 'aria-label': 'Note', value: entry?.note || '', autocomplete: 'off' });
  const era = eraSelect(eras, entry?.era || '');
  const sources = sourcesEditor(entry ? entrySources(entry) : []);
  const err = el('p', { class: 'msg error t-caption', role: 'alert', hidden: true });
  const save = el('button', { class: 'btn small', type: 'submit' }, editing ? 'Save' : 'Add track');
  const form = el('form', { class: 'ref-form', novalidate: true },
    editing ? null : el('div', { class: 'ref-form-row' }, artist, title),
    el('div', { class: 'ref-form-row' }, year, role),
    eras.length ? era : null,
    note, sources.node, err,
    el('div', { class: 'row end' }, el('button', { class: 'btn outline small', type: 'button', onclick: () => done(false) }, 'Cancel'), save));
  const fail = (text) => { err.textContent = text; err.hidden = false; save.disabled = false; };
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const cleaned = cleanSources(sources.values());
    if (cleaned.error) { fail(cleaned.error); return; }
    const values = { artist: artist.value, title: title.value, year: year.value, role: role.value, note: note.value, sources: cleaned.sources, era: eras.length ? era.value : undefined };
    if (!editing && (!values.artist.trim() || !values.title.trim())) { fail('Artist and title are required.'); return; }
    save.disabled = true;
    try {
      if (editing) {
        const body = patchBodyFor(entry, values);
        if (Object.keys(body).length) await patchReference(genre, entry.id, body);
      } else {
        await addReference(genre, buildBody(values));
      }
      done(true);
    } catch (ex) {
      fail(ex.code === 'reference_exists' ? 'This track is already in the list.' : ex.message || 'Could not save.');
    }
  });
  return form;
}

function sourcesList(entry) {
  return el('ul', { class: 'ref-sources t-caption' }, entrySources(entry).map((s) => el('li', {},
    el('span', { class: 'ref-src-type' }, sourceTypeLabel(s.type)),
    el('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer', 'aria-label': `${sourceTypeLabel(s.type)}: ${s.url} (opens in a new tab)` }, linkText(s.url), icon('externalLink', 'inline')),
    s.note ? el('span', { class: 'muted' }, ` ${s.note}`) : null)));
}

function sourcesToggle(item, extra = '') {
  const n = sourceCount(item);
  if (!n) return { toggle: null, wrap: null };
  const wrap = el('div', { class: 'ref-sources-wrap', hidden: true }, sourcesList(item));
  const toggle = el('button', {
    class: `ref-src-toggle t-caption${extra}`, type: 'button', title: sourcesTip(item), 'aria-expanded': 'false',
    onclick: () => { wrap.hidden = !wrap.hidden; toggle.setAttribute('aria-expanded', String(!wrap.hidden)); },
  }, `${n} ${n === 1 ? 'source' : 'sources'}`);
  return { toggle, wrap };
}

function erasEditor(genre, eras, entries, confirmFn, done) {
  const rows = [];
  const box = el('div', { class: 'era-rows' });
  const err = el('p', { class: 'msg error t-caption', role: 'alert', hidden: true });
  const save = el('button', { class: 'btn small', type: 'submit' }, 'Save eras');
  function push(era) {
    const name = el('input', { type: 'text', placeholder: 'Era name', 'aria-label': 'Era name', value: era?.name || '', autocomplete: 'off' });
    const start = el('input', { type: 'number', placeholder: 'Start year', 'aria-label': 'Start year', value: era?.start ?? '', min: '1900', max: '2100' });
    const end = el('input', { type: 'number', placeholder: 'End year', 'aria-label': 'End year', value: era?.end ?? '', min: '1900', max: '2100' });
    const note = el('input', { type: 'text', placeholder: 'Note (optional)', 'aria-label': 'Era note', value: era?.note || '', autocomplete: 'off' });
    const sources = sourcesEditor(entrySources(era || {}));
    const rm = el('button', {
      class: 'btn outline small era-remove',
      type: 'button',
      onclick: () => {
        const used = era?.id ? entries.filter((e) => e.era === era.id).length : 0;
        if (used && !confirmFn(`${used} reference ${used === 1 ? 'track uses' : 'tracks use'} "${era.name}". Remove the era and leave ${used === 1 ? 'it' : 'them'} without one?`)) return;
        rows.splice(rows.indexOf(row), 1);
        row.node.remove();
      },
    }, icon('clear', 'inline'), 'Remove era');
    const row = {
      node: el('div', { class: 'era-row' }, name, el('div', { class: 'ref-form-row' }, start, end), note, sources.node, el('div', { class: 'row end' }, rm)),
      value: () => ({
        id: era?.id, name: name.value, start: start.value, end: end.value, note: note.value, sources: sources.values(),
      }),
    };
    rows.push(row);
    box.append(row.node);
  }
  for (const e of sortEras(eras)) push(e);
  const form = el('form', { class: 'ref-form era-editor', novalidate: true },
    box,
    el('button', { class: 'btn outline small', type: 'button', onclick: () => push() }, icon('plus', 'inline'), 'Add era'),
    err,
    el('div', { class: 'row end' }, el('button', { class: 'btn outline small', type: 'button', onclick: () => done(false) }, 'Cancel'), save));
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const cleaned = cleanEras(rows.map((r) => r.value()));
    if (cleaned.error) { err.textContent = cleaned.error; err.hidden = false; return; }
    save.disabled = true;
    try {
      await saveEras(genre, cleaned.eras);
      done(true);
    } catch (ex) {
      err.textContent = ex.message || 'Could not save.';
      err.hidden = false;
      save.disabled = false;
    }
  });
  return form;
}

export function linkText(url) {
  try {
    const u = new URL(url);
    const path = u.pathname === '/' ? '' : u.pathname;
    const text = `${u.hostname.replace(/^www\./, '')}${path}`;
    return text.length > 48 ? `${text.slice(0, 47)}...` : text;
  } catch {
    return url;
  }
}

export function createReferencesPanel({ confirmFn = (t) => globalThis.confirm(t) } = {}) {
  const head = el('h3', { class: 'ref-head t-caption' }, 'Reference tracks');
  const list = el('ul', { class: 'ref-list' });
  const adder = el('div', { class: 'ref-add' });
  const node = el('section', { class: 'ref-panel', 'aria-label': 'Reference tracks', hidden: true }, head, list, adder);
  let genre = null;
  let entries = [];
  let eras = [];
  let editingEras = false;
  let editingId = null;
  let adding = false;
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

  async function mutate(run, okText) {
    try {
      await run();
      if (okText) toast(okText);
    } catch (ex) {
      toast(ex.message || 'Could not save');
    }
    await refresh(true);
  }

  function actionNode(e) {
    if (e.in_library && (e.song?.id || e.song_id)) {
      const id = e.song?.id || e.song_id;
      return el('button', { class: 'icon sq-btn ref-play', type: 'button', title: 'Play', 'aria-label': `Play ${entryLine(e)}`, onclick: () => player.playNow(id) }, icon('play', 'inline'));
    }
    const url = addLinkFor(e);
    if (url) return el('button', { class: 'btn outline small ref-add-lib', type: 'button', onclick: (ev) => openAdd({ url, note: `Reference track: ${entryLine(e)}.` }, ev.currentTarget) }, 'Add to library');
    return el('span', { class: 'muted t-caption ref-none' }, NOT_IN_LIBRARY);
  }

  function ownerControls(e) {
    return el('span', { class: 'ref-owner' },
      e.reviewed ? null : el('button', { class: 'icon sq-btn ref-review', type: 'button', title: 'Mark as reviewed', 'aria-label': `Mark as reviewed: ${entryLine(e)}`, onclick: () => mutate(() => patchReference(genre, e.id, { reviewed: true })) }, icon('check', 'inline')),
      el('button', { class: 'icon sq-btn ref-edit', type: 'button', title: 'Edit', 'aria-label': `Edit: ${entryLine(e)}`, onclick: () => { editingId = e.id; paint(); } }, icon('pencil', 'inline')),
      el('button', { class: 'icon sq-btn ref-del', type: 'button', title: 'Delete', 'aria-label': `Delete: ${entryLine(e)}`, onclick: () => { if (confirmFn(`Delete "${entryLine(e)}" from the reference tracks?`)) void mutate(() => deleteReference(genre, e.id), 'Deleted'); } }, icon('clear', 'inline')));
  }

  function item(e, owner) {
    if (owner && editingId === e.id) {
      return el('li', { class: 'ref-item editing', 'data-id': e.id }, el('p', { class: 't-subhead ref-line' }, entryLine(e)), referenceForm(genre, e, eras, (saved) => { editingId = null; if (saved) void refresh(true); else paint(); }));
    }
    const n = sourceCount(e);
    const { toggle, wrap: srcs } = sourcesToggle(e);
    const tick = n >= 2 ? el('span', { class: 'ref-verified t-caption', title: `Backed by ${n} independent sources`, 'aria-label': `Verified by ${n} sources` }, icon('check', 'inline')) : null;
    return el('li', { class: 'ref-item', 'data-id': e.id, 'data-role': e.role },
      el('div', { class: 'ref-main' },
        el('span', { class: `ref-role t-caption role-${e.role}` }, roleLabel(e.role)),
        el('span', { class: 'ref-line t-subhead' }, entryLine(e)),
        e.reviewed ? null : el('span', { class: 'ref-todo t-caption', title: 'Not reviewed yet' }, 'To review'),
        tick, toggle),
      e.note ? el('p', { class: 'ref-note t-caption muted' }, e.note) : null,
      srcs,
      el('div', { class: 'ref-actions' }, actionNode(e), owner ? ownerControls(e) : null));
  }

  function paintAdder(owner) {
    if (!owner) { adder.replaceChildren(); return; }
    if (editingEras) {
      adder.replaceChildren(erasEditor(genre, eras, entries, confirmFn, (saved) => { editingEras = false; if (saved) void refresh(true); else paint(); }));
      return;
    }
    if (adding) {
      adder.replaceChildren(referenceForm(genre, null, eras, (saved) => { adding = false; if (saved) void refresh(true); else paint(); }));
      return;
    }
    adder.replaceChildren(
      el('button', { class: 'btn outline small ref-add-btn', type: 'button', onclick: () => { adding = true; paint(); } }, icon('plus', 'inline'), 'Add a track'),
      el('button', { class: 'btn outline small ref-eras-btn', type: 'button', onclick: () => { editingEras = true; paint(); } }, icon('pencil', 'inline'), 'Edit eras'));
  }

  function eraHeading(era, owner, hasEntries) {
    const years = eraYears(era);
    const { toggle, wrap } = sourcesToggle(era);
    return el('div', { class: 'ref-era-head' },
      el('div', { class: 'ref-era-title' },
        el('h4', { class: 'ref-era-name t-subhead' }, era.name),
        years ? el('span', { class: 'ref-era-years t-caption muted' }, years) : null,
        toggle),
      era.note ? el('p', { class: 'ref-era-note t-caption muted' }, era.note) : null,
      wrap,
      owner && !hasEntries ? el('p', { class: 'ref-era-empty t-caption muted' }, NO_ERA_TRACKS) : null);
  }

  function paintList(owner) {
    const empty = () => [el('li', { class: 'ref-empty muted t-caption' }, EMPTY_REFERENCES)];
    if (!eras.length) return entries.length ? entries.map((e) => item(e, owner)) : empty();
    if (!entries.length && !owner) return empty();
    return groupByEra(entries, eras, { owner }).map((g) => el('li', { class: 'ref-era', 'data-era': g.era?.id || '' },
      g.era ? eraHeading(g.era, owner, g.entries.length > 0) : el('div', { class: 'ref-era-head' }, el('h4', { class: 'ref-era-name t-subhead' }, OTHER_ERA)),
      g.entries.length ? el('ul', { class: 'ref-list' }, g.entries.map((e) => item(e, owner))) : null));
  }

  function paint() {
    const owner = isReferenceOwner();
    node.hidden = !genre || !ready;
    list.replaceChildren(...paintList(owner));
    paintAdder(owner);
  }

  const unsub = onReferencesChange(() => { if (genre) paint(); });

  return {
    node,
    show(name) {
      const next = name || null;
      if (next !== genre) { editingId = null; adding = false; editingEras = false; entries = []; eras = []; }
      genre = next;
      seq += 1;
      if (!genre || isGuest()) { genre = null; ready = false; node.hidden = true; list.replaceChildren(); adder.replaceChildren(); return; }
      ready = true;
      void loadReferences().then(() => { if (genre === next) paint(); });
      void refresh();
    },
    destroy() { genre = null; unsub(); },
  };
}
