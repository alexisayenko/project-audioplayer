import { el, plural } from './dom.js';
import { genreEditor } from './album-genre-editor.js';
import { labelField } from './label-field.js';
import { ALBUM_TYPES } from './album-draft-model.js';
import { artOptions, SOURCE_LABEL, linksNow, linkWarning, setLinkEdit, parseRym } from './album-wizard-model.js';
import { albumLinksPanel } from './album-form.js';
import { suggestGenres, seedGenres, applyRym } from './album-wizard-flow.js';

export function artPicker(ctx) {
  const { draft } = ctx;
  const opts = artOptions(draft);
  if (!opts.some((o) => o.url === draft.art.chosen)) draft.art.chosen = opts[0]?.url || null;
  const group = el('div', { class: 'wiz-art', role: 'radiogroup', 'aria-label': 'Album art' });
  for (const o of opts) {
    const radio = el('input', { type: 'radio', name: 'wiz-art', value: o.url, checked: draft.art.chosen === o.url });
    radio.addEventListener('change', () => { draft.art.chosen = o.url; ctx.touch(); ctx.repaint(); });
    const img = el('img', { class: 'cover wiz-art-img', src: o.url, alt: '', width: '96', height: '96', loading: 'lazy', referrerpolicy: 'no-referrer' });
    img.addEventListener('error', () => { img.hidden = true; });
    group.append(el('label', { class: 'wiz-art-opt' }, radio, img, el('span', { class: 't-caption muted' }, o.label)));
  }
  const empty = el('p', { class: 'muted t-caption' }, 'No art found. The server will look for one.');
  return el('section', { class: 'wiz-sec' },
    el('h3', { class: 't-headline' }, 'Album art'),
    opts.length ? group : empty,
    opts.length ? el('p', { class: 'muted t-caption' }, 'The art goes on the album and on every new song of it.') : null);
}

export function genreArea(ctx) {
  const { draft } = ctx;
  const hints = draft.genreHints;
  const ed = genreEditor(draft.album.genres);
  let seeding = false;
  const status = el('p', { class: 'muted t-caption', role: 'status' });
  const sugs = el('div', { class: 'wiz-sugs', 'aria-label': 'Suggested genres' });
  const rymIn = el('input', { type: 'text', placeholder: 'Paste genres from Rate Your Music', 'aria-label': 'Genres from Rate Your Music', autocomplete: 'off' });
  const rymAdd = el('button', { class: 'btn outline small', type: 'button' }, 'Add');
  const rymNote = el('p', { class: 'muted t-caption wiz-rym-note', role: 'status' });

  const paintLinks = () => ctx.refreshLinks?.();

  const paintSugs = () => {
    const have = new Set(draft.album.genres.map((g) => g.toLowerCase()));
    sugs.replaceChildren(...hints.items.map((s) => {
      const on = !!s.mapped && have.has(s.mapped.toLowerCase());
      const label = SOURCE_LABEL[s.source] || s.source;
      const tip = s.mapped ? `${label}${s.mapped.toLowerCase() === s.name.toLowerCase() ? '' : `: ${s.name}`}` : `${label}: not in the genre tree`;
      const b = el('button', {
        class: `chip wiz-sug${s.mapped ? '' : ' unmapped'}${on ? ' on' : ''}`, type: 'button', title: tip, 'aria-pressed': String(on),
        'aria-disabled': s.mapped ? null : 'true', 'aria-label': `${s.mapped || s.name}, ${tip}`,
      }, s.mapped || s.name, el('small', { class: 'wiz-src', 'aria-hidden': 'true' }, s.mapped ? label : `${label}, not in tree`));
      b.addEventListener('click', () => {
        if (!s.mapped) return;
        if (on) ed.set(draft.album.genres.filter((g) => g.toLowerCase() !== s.mapped.toLowerCase()));
        else ed.add([s.mapped]);
      });
      return b;
    }));
  };

  ed.subscribe(() => {
    draft.album.genres = ed.get();
    if (!seeding) { draft.touched.genres = true; ctx.touch(); }
    paintSugs();
    paintLinks();
  });

  async function load(rymText = '') {
    status.textContent = rymText ? 'Reading the genres...' : 'Looking for genres on Discogs and Wikipedia...';
    await suggestGenres(draft, { rymText });
    if (!ctx.live()) return;
    status.textContent = hints.error || (hints.items.length ? '' : 'No genre suggestions. Type a genre to add it.');
    if (!rymText && !draft.touched.genres) {
      seeding = true;
      ed.set(seedGenres(draft));
      seeding = false;
    }
    paintSugs();
    paintLinks();
  }

  rymAdd.addEventListener('click', async () => {
    const parsed = parseRym(rymIn.value);
    if (!parsed.url && !parsed.genres) { rymNote.textContent = 'Paste the genres from the Rate Your Music page.'; return; }
    if (parsed.url) {
      setLinkEdit(draft, 'rateyourmusic', applyRym(draft, rymIn.value).url);
      rymNote.textContent = 'Linked in the Links below. Rate Your Music cannot be read by the app, so paste its genres here too if you want them.';
      rymIn.value = '';
      ctx.touch();
      paintLinks();
      return;
    }
    rymAdd.disabled = true;
    await load(parsed.genres);
    rymAdd.disabled = false;
    const mine = hints.items.filter((i) => i.source === 'rym');
    const fit = mine.filter((i) => i.mapped);
    ed.add(fit.map((i) => i.mapped));
    const lost = mine.length - fit.length;
    rymNote.textContent = `${fit.length} ${plural(fit.length, 'genre', 'genres')} added${lost ? `, ${lost} not in the genre tree` : ''}.`;
    rymIn.value = '';
  });
  rymIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); rymAdd.click(); } });

  paintSugs();
  paintLinks();
  void load();
  return {
    commit: () => ed.commit(),
    node: el('section', { class: 'wiz-sec' },
      el('h3', { class: 't-headline' }, 'Genres'),
      ed.node, status, sugs,
      el('div', { class: 'wiz-rym' }, rymIn, rymAdd), rymNote),
  };
}

export function labelArea(ctx) {
  const { draft } = ctx;
  const field = labelField({ initial: draft.album.labels });
  field.subscribe(() => {
    draft.album.labels = field.get();
    draft.touched.labels = true;
    ctx.touch();
  });
  return {
    commit: () => field.commit(),
    node: el('section', { class: 'wiz-sec wiz-labels' },
      el('h3', { class: 't-headline' }, 'Labels'),
      field.node,
      el('p', { class: 'muted t-caption' }, 'The labels go on the album and on every new song of it.')),
  };
}

export function typeSelect(ctx) {
  const { draft } = ctx;
  const sel = el('select', { 'aria-label': 'Album type' }, ...ALBUM_TYPES.map(([k, label]) => el('option', { value: k, selected: k === draft.album.type }, label)));
  sel.value = draft.album.type;
  sel.addEventListener('change', () => { draft.album.type = sel.value; draft.touched.type = true; ctx.touch(); });
  return sel;
}

export function linkRows(ctx) {
  const { draft } = ctx;
  const lk = albumLinksPanel(linksNow(draft), 'wiz-links-body');
  const warn = () => lk.panel.setErrors(Object.fromEntries(Object.keys(lk.inputs).map((k) => [k, linkWarning(k, lk.inputs[k].value)]).filter(([, w]) => w)));
  for (const [key, inp] of Object.entries(lk.inputs)) {
    inp.addEventListener('input', () => { setLinkEdit(draft, key, inp.value); warn(); ctx.touch(); });
  }
  warn();
  return {
    node: el('section', { class: 'wiz-sec wiz-links' }, lk.node),
    refresh() {
      const now = linksNow(draft);
      for (const [key, inp] of Object.entries(lk.inputs)) {
        if (globalThis.document?.activeElement === inp) continue;
        inp.value = key in draft.linkEdits ? draft.linkEdits[key] : (now[key] || '');
      }
      lk.paint();
      warn();
    },
  };
}
