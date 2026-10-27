import { el } from './dom.js';
import { serviceIcon } from './service-icons.js';
import { albumFields } from './album-form.js';
import { discogsFinder } from './album-discogs.js';
import { icon } from './icons.js';
import { renumber } from './album-draft-model.js';

export const checkedAll = (st) => st.rows.length > 0 && st.rows.every((r) => r.include);

export function mountAlbumDraft({ body, st, editor, say, onBack, hooks, head, intro = [], createLabel, createIcon = 'plus', footNote, submit, linksId = 'album-links-add' }) {
  const ui = new Map();
  const stat = el('p', { class: 't-subhead av-summary', role: 'status' });
  const problems = el('p', { class: 't-caption muted av-problems', role: 'status' });
  const create = el('button', { class: 'btn primary glow', type: 'button' }, icon(createIcon, 'nav'), createLabel);
  const rows = el('ul', { class: 'av-rows' });
  const toggleAll = el('button', { class: 'link-btn t-caption av-select-all', type: 'button' });

  function paint() {
    stat.textContent = hooks.summary(st);
    const all = hooks.issues(st);
    problems.textContent = all.length ? all[0] : '';
    create.disabled = all.length > 0;
    toggleAll.textContent = checkedAll(st) ? 'Select none' : 'Select all';
    hooks.paintAll?.(st, ctx);
    st.rows.forEach((r, i) => {
      const u = ui.get(r.key);
      if (!u) return;
      u.no.textContent = `${r.no}.`;
      const bad = hooks.rowIssue(st, i);
      const lab = hooks.label(st, i);
      u.name.textContent = lab.name;
      u.version.textContent = lab.version ? `[${lab.version}]` : '';
      u.version.hidden = !lab.version;
      u.len.textContent = lab.length ? `(${lab.length})` : '';
      u.len.hidden = !lab.length;
      u.flag.hidden = !bad;
      u.issue.textContent = bad;
      u.issue.hidden = !bad;
      u.link.href = hooks.link(r);
      u.extra?.paint?.(r, bad);
    });
  }

  function textField(r, key, label, extra = {}) {
    const input = el('input', { type: 'text', value: r[key], autocomplete: 'off', 'aria-label': `${label} of track ${r.no}`, placeholder: label, ...extra });
    input.addEventListener('input', () => { r[key] = input.value; paint(); });
    return input;
  }

  function rowNode(r) {
    const box = el('input', { type: 'checkbox', checked: r.include, 'aria-label': `Include track ${r.no}` });
    box.addEventListener('change', () => { r.include = box.checked; if (!r.include) hooks.onExclude?.(r); paint(); });
    const extra = hooks.editFields?.(r, paint) || { nodes: [] };
    const u = {
      no: el('span', { class: 'album-no muted t-caption' }),
      name: el('span', { class: 'av-name' }),
      version: el('span', { class: 'av-ver muted', hidden: true }),
      len: el('span', { class: 'av-len muted' }),
      flag: el('span', { class: 'av-flag', title: 'Needs attention', 'aria-label': 'Needs attention', hidden: true }, '!'),
      issue: el('p', { class: 'av-issue t-caption', role: 'alert', hidden: true }),
      link: el('a', { class: 'icon sq-btn av-yt', href: hooks.link(r), target: '_blank', rel: 'noopener', title: hooks.linkTitle, 'aria-label': hooks.linkTitle }, serviceIcon('youtube', { size: 'inline' })),
      extra,
    };
    const meta = hooks.meta?.(r, { box, paint }) || [];
    const remove = el('button', { class: 'icon sq-btn av-remove', type: 'button', title: 'Remove', 'aria-label': 'Remove', onclick: () => {
      st.rows.splice(st.rows.indexOf(r), 1);
      renumber(st);
      drawRows();
      paint();
    } }, icon('clear', 'inline'));
    const edit = el('button', { class: 'icon sq-btn av-edit', type: 'button', title: 'Edit track', 'aria-label': 'Edit track', 'aria-expanded': String(!!r.editing) }, icon('pencil', 'inline'));
    const line2 = el('div', { class: 'av-line2', hidden: !r.editing },
      ...extra.nodes,
      textField(r, 'artists', 'Artist', { class: 'av-artist' }),
      textField(r, 'title', 'Title', { class: 'av-title' }),
      textField(r, 'version', 'Version', { class: 'av-version' }));
    const setEditing = (on) => {
      r.editing = on;
      line2.hidden = !on;
      edit.setAttribute('aria-expanded', String(on));
    };
    edit.addEventListener('click', () => setEditing(!r.editing));
    line2.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      setEditing(false);
    });
    ui.set(r.key, u);
    return el('li', { class: 'av-row' },
      el('div', { class: 'av-line1' },
        el('label', { class: 'av-inc' }, box),
        u.no,
        el('span', { class: 'av-label t-body' }, u.name, ' ', u.version, ' ', u.len),
        u.flag,
        el('span', { class: 'av-icons' }, edit, u.link, remove)),
      line2,
      meta.length ? el('div', { class: 'av-meta' }, ...meta) : null,
      u.issue);
  }

  function drawRows() {
    ui.clear();
    rows.replaceChildren(...st.rows.map(rowNode));
  }

  toggleAll.addEventListener('click', () => {
    const on = !checkedAll(st);
    for (const r of st.rows) { r.include = on; if (!on) hooks.onExclude?.(r); }
    drawRows();
    paint();
  });

  const artistAll = el('button', { class: 'btn outline small', type: 'button', onclick: () => {
    if (!st.album.albumArtist.trim()) { say('Type the album artist first.'); return; }
    say('');
    for (const r of st.rows) r.artists = st.album.albumArtist;
    drawRows();
    paint();
  } }, 'Use album artist for all tracks');

  const form = albumFields({ title: st.album.title, artist: st.album.albumArtist, year: st.album.year, type: st.album.type, genres: editor, links: st.album.links, linksId });
  const syncAlbum = () => {
    st.album.title = form.title();
    st.album.albumArtist = form.artist();
    st.album.year = form.year();
    st.album.links = form.links.get();
    paint();
  };
  for (const n of [form.titleF, form.artistsF, form.yearIn, ...Object.values(form.links.inputs)]) n.addEventListener('input', syncAlbum);
  form.typeSel.addEventListener('change', () => { st.album.type = form.typeSel.value; });

  const coverImg = el('img', { class: 'cover av-cover', alt: 'Album cover', width: '96', height: '96' });
  const paintCover = () => {
    if (st.album.coverUrl) coverImg.src = st.album.coverUrl;
    coverImg.hidden = !st.album.coverUrl;
  };
  coverImg.addEventListener('error', () => { coverImg.hidden = true; });
  paintCover();
  const finder = discogsFinder({ form, editor, onPick: (c) => { if (c.cover) { st.album.coverUrl = c.cover; paintCover(); } } });
  const matched = st.discogsMatch ? el('div', { class: 'muted t-caption av-matched' }, 'Matched on Discogs: ', el('a', { href: st.discogsMatch, target: '_blank', rel: 'noopener noreferrer' }, st.discogsMatch.replace('https://www.', ''))) : null;
  const cancel = el('button', { class: 'btn outline', type: 'button', onclick: () => { say(''); onBack(); } }, 'Back');

  const ctx = { st, ui, paint, drawRows, say, body, form, editor, create };
  async function run() {
    editor.commit();
    st.album.genres = editor.get();
    syncAlbum();
    form.links.paint();
    say('');
    create.disabled = true;
    await submit(ctx);
  }
  ctx.run = run;
  create.addEventListener('click', () => { void run(); });

  body.replaceChildren(el('div', { class: 'add-card album-video' },
    head, ...(matched ? [matched] : []), coverImg, form.node, finder.node,
    el('div', { class: 'av-bar-row' }, stat, toggleAll),
    rows,
    el('div', { class: 'av-bottom' }, ...(hooks.bottom?.(ctx) || []), artistAll, ...(hooks.bottomAfter?.(ctx) || [])),
    problems,
    typeof footNote === 'string' ? el('p', { class: 't-caption muted' }, footNote) : footNote,
    el('div', { class: 'add-foot' }, cancel, create)));
  drawRows();
  paint();
  return ctx;
}

export const headBlock = (title, line, warnings = []) => el('div', { class: 'av-head' },
  el('div', { class: 't-headline' }, title),
  el('div', { class: 'muted t-caption' }, line),
  ...warnings.map((w) => el('div', { class: 'muted t-caption av-warn' }, w)));
