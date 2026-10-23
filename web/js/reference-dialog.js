import { el, toast } from './dom.js';
import { icon } from './icons.js';
import { dialogHead } from './edit-dialog.js';
import { displayLine } from './credits.js';
import { songGenres } from './genre-playing.js';
import { eraSelect } from './genre-references.js';
import { loadVocabulary, searchGenres, resolveGenre } from './genre-vocab.js';
import {
  ROLES, roleLabel, songMarks, isReferenceOwner, genreReferences, genreEras, addReference, deleteReference, markBody,
} from './references.js';

const OTHER = '__other__';

export function referenceBody(song, { role, note, era }) {
  return { song_id: song.id, ...markBody({ role, note, era }) };
}

export function genreChoices(song) {
  return songGenres(song).map((g) => g.key);
}

export function openReferenceDialog(song) {
  if (!isReferenceOwner()) return;
  const dlg = document.getElementById('edit-dialog');
  const own = genreChoices(song);
  let vocab = null;
  const select = el('select', { 'aria-label': 'Genre' },
    ...own.map((g) => el('option', { value: g }, g)),
    el('option', { value: OTHER }, 'Another genre...'));
  const typed = el('input', { type: 'text', placeholder: 'Genre name', 'aria-label': 'Another genre', autocomplete: 'off', hidden: own.length > 0 });
  const hits = el('div', { class: 'pills ref-hits', role: 'listbox', 'aria-label': 'Genre suggestions' });
  const role = el('select', { 'aria-label': 'Role' }, ROLES.map((r) => el('option', { value: r, selected: r === 'archetype' }, roleLabel(r))));
  let era = eraSelect([]);
  const eraField = el('div', { class: 'field', hidden: true }, el('label', {}, 'Era'), era);
  const note = el('input', { type: 'text', placeholder: 'Note (optional)', 'aria-label': 'Note', autocomplete: 'off' });
  const err = el('p', { class: 'msg error t-caption', role: 'alert', hidden: true });
  const save = el('button', { class: 'btn', type: 'submit' }, 'Save');
  const chips = el('div', { class: 'pills ref-marks', role: 'group', 'aria-label': 'Reference marks on this song' });
  if (!own.length) select.value = OTHER;

  const showError = (text) => { err.textContent = text; err.hidden = !text; };
  const other = () => select.value === OTHER;
  const genreName = () => {
    if (!other()) return select.value;
    const hit = resolveGenre(typed.value, vocab);
    return hit ? hit.name : '';
  };

  function paintHits() {
    hits.replaceChildren();
    if (!other() || !vocab || !typed.value.trim()) return;
    for (const g of searchGenres(typed.value, vocab)) {
      hits.append(el('button', { class: 'chip t-subhead', type: 'button', role: 'option', onclick: () => { typed.value = g.name; hits.replaceChildren(); } }, g.name));
    }
  }

  function paintMarks() {
    const marks = songMarks(song.id);
    chips.hidden = !marks.length;
    chips.replaceChildren(...marks.map((m) => el('span', { class: 'chip t-subhead on ref-mark' },
      `${m.genre} (${roleLabel(m.role)})`,
      el('button', { class: 'icon sq-btn', type: 'button', title: 'Remove mark', 'aria-label': `Remove mark: ${m.genre}`, onclick: () => unmark(m.genre) }, icon('clear', 'inline')))));
  }

  async function unmark(genre) {
    try {
      const entry = (await genreReferences(genre, { force: true })).find((e) => e.song_id === song.id || e.song?.id === song.id);
      if (entry) await deleteReference(genre, entry.id);
      paintMarks();
    } catch (ex) {
      showError(ex.message || 'Could not remove the mark.');
    }
  }

  let eraSeq = 0;
  async function paintEras() {
    const mine = ++eraSeq;
    const name = genreName();
    let list = [];
    if (name) {
      try { list = await genreEras(name); } catch { list = []; }
    }
    if (mine !== eraSeq) return;
    const next = eraSelect(list);
    era.replaceWith(next);
    era = next;
    eraField.hidden = !list.length;
  }

  select.addEventListener('change', () => { typed.hidden = !other(); paintHits(); void paintEras(); if (other()) typed.focus(); });
  typed.addEventListener('input', () => { paintHits(); void paintEras(); });

  const form = el('form', { method: 'dialog' },
    dialogHead('Mark as reference', displayLine(song), () => dlg.close()),
    chips,
    el('div', { class: 'field' }, el('label', {}, 'Genre'), select, typed, hits),
    el('div', { class: 'field' }, el('label', {}, 'Role'), role),
    eraField,
    el('div', { class: 'field' }, el('label', {}, 'Note'), note),
    err,
    el('div', { class: 'row end' }, save));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    showError('');
    const genre = genreName();
    if (!genre) { showError('Choose a genre from the list.'); return; }
    save.disabled = true;
    try {
      await addReference(genre, referenceBody(song, { role: role.value, note: note.value, era: era.value }));
      toast(`Marked as reference for ${genre}`);
      dlg.close();
    } catch (ex) {
      showError(ex.code === 'reference_exists' ? `Already a reference for ${genre}.` : ex.message || 'Could not save.');
      save.disabled = false;
    }
  });

  dlg.replaceChildren(form);
  dlg.onclick = (e) => { if (e.target === dlg) dlg.close(); };
  paintMarks();
  void paintEras();
  dlg.showModal();
  (own.length ? select : typed).focus();
  void loadVocabulary().then((v) => { vocab = v; paintHits(); });
}
