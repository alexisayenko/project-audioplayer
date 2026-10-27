import { el } from './dom.js';
import { icon } from './icons.js';
import { nameOf, trackClock } from './album-draft-model.js';
import { formatClock, parseClock } from './album-video-model.js';
import {
  reviewRows, reassign, reviewView, rowIssueFor, estLength, lengthGap, trackArtists, LENGTH_WARN_S,
} from './album-wizard-model.js';

const clock = (s) => (s ? trackClock(s) : '');

export function mountRows(ctx, onChange) {
  const { draft } = ctx;
  const list = el('ul', { class: 'av-rows wiz-rows', 'aria-label': 'Tracks to import' });
  const ui = new Map();
  const video = draft.kind === 'video';

  const srcName = (r) => {
    const n = nameOf({ ...r, artists: trackArtists(draft, r) });
    return n.version ? `${n.name} [${n.version}]` : n.name;
  };
  const optionText = (r, i, rows, self) => {
    const owner = rows.find((x) => x !== self && x.disc && x.src === r);
    const len = clock(estLength(draft, r));
    return `${i + 1}. ${srcName(r)}${len ? ` (${len})` : ''}${owner ? ` - used for track ${owner.disc.no}` : ''}`;
  };

  function startField(r) {
    const input = el('input', { type: 'text', class: 'av-start', value: r.startText, inputMode: 'numeric', autocomplete: 'off', 'aria-label': `Start of ${r.title || 'track'}`, placeholder: '00:00:00' });
    input.addEventListener('input', () => {
      const t = parseClock(input.value);
      r.badStart = t === null;
      if (t !== null) { r.start = t; r.startText = input.value; }
      onChange();
    });
    input.addEventListener('change', () => { if (!r.badStart) { input.value = formatClock(r.start); r.startText = input.value; } });
    return input;
  }

  function textField(r, key, label, extra = {}) {
    const value = key === 'artists' ? trackArtists(draft, r) : r[key];
    const input = el('input', { type: 'text', value, autocomplete: 'off', 'aria-label': `${label} of ${r.title || 'track'}`, placeholder: label, ...extra });
    input.addEventListener('input', () => {
      r[key] = input.value;
      if (key === 'artists' && !input.value.trim()) r.artists = '';
      ctx.touch();
      onChange();
    });
    return input;
  }

  function matchLine(row, rows) {
    if (!row.disc) return el('div', { class: 'wiz-match muted t-caption' }, 'Not on the Discogs list. Tick it to add it after the others.');
    const select = el('select', { 'aria-label': `YouTube track for ${row.disc.no}. ${row.disc.title}`, 'data-row': row.id },
      el('option', { value: '', selected: !row.src }, 'No match, skip this track'),
      ...draft.st.rows.map((r, i) => el('option', { value: String(r.key), selected: row.src === r }, optionText(r, i, rows, row))));
    select.addEventListener('change', () => {
      reassign(draft, row.disc.no, select.value === '' ? null : Number(select.value));
      ctx.touch();
      onChange(true, row.id);
    });
    const gap = row.src ? lengthGap(draft, row) : 0;
    return el('div', { class: 'wiz-match' },
      select,
      gap > LENGTH_WARN_S ? el('span', { class: 't-caption av-warn', title: `The lengths differ by ${gap} s` }, 'Length differs, check the match') : null);
  }

  function rowNode(row, rows) {
    const { disc, src, st } = row;
    const name = disc ? disc.title : srcName(src);
    const no = disc ? disc.no : '';
    const lenText = disc ? clock(disc.durationS) : clock(estLength(draft, src));
    const box = el('input', { type: 'checkbox', checked: !!st?.include, disabled: !src, 'aria-label': `Import ${no ? `track ${no}` : name}` });
    if (st) box.addEventListener('change', () => { st.include = box.checked; if (!box.checked) st.useExisting = false; ctx.touch(); onChange(); });
    const edit = src ? el('button', { class: 'icon sq-btn av-edit', type: 'button', title: 'Edit track', 'aria-label': `Edit ${name}`, 'aria-expanded': 'false' }, icon('pencil', 'inline')) : null;
    const fields = src ? [
      ...(video ? [startField(src)] : []),
      textField(src, 'artists', 'Artist', { class: 'av-artist' }),
      textField(src, 'title', 'Title', { class: 'av-title' }),
      textField(src, 'version', 'Version', { class: 'av-version' }),
    ] : [];
    const useDisc = disc && src ? el('label', { class: 't-caption av-use' }, el('input', { type: 'checkbox', checked: !!st.useDisc }), 'Use the Discogs title') : null;
    useDisc?.querySelector('input').addEventListener('change', (e) => { st.useDisc = e.target.checked; ctx.touch(); onChange(); });
    const line2 = el('div', { class: 'av-line2', hidden: true }, ...fields);
    const issue = el('p', { class: 'av-issue t-caption', role: 'alert', hidden: true });
    const meta = [];
    if (src?.match) {
      const use = el('input', { type: 'checkbox', checked: !!st.useExisting, 'aria-label': `Use the existing song for ${name}` });
      use.addEventListener('change', () => { st.useExisting = use.checked; if (use.checked) { st.include = true; box.checked = true; } ctx.touch(); onChange(); });
      meta.push(el('span', { class: 'chip tint album-in-library', title: [src.match.title, (src.match.artists || []).join(' & ')].filter(Boolean).join(' - ') }, 'In library'),
        el('label', { class: 't-caption av-use' }, use, 'Use existing'));
    } else if (src?.songId) {
      meta.push(el('span', { class: 'chip tint album-in-library' }, 'In library'));
    }
    for (const w of src?.warnings || []) meta.push(el('span', { class: 't-caption muted av-warn' }, w));
    const lineName = el('span', { class: 'av-label t-body' }, name, lenText ? el('span', { class: 'muted' }, ` (${lenText})`) : null);
    const li = el('li', { class: 'av-row wiz-row', 'data-row': row.id },
      el('div', { class: 'av-line1' },
        el('label', { class: 'av-inc' }, box),
        no ? el('span', { class: 'album-no muted t-caption' }, `${no}.`) : null,
        lineName,
        el('span', { class: 'av-icons' }, edit)),
      matchLine(row, rows),
      line2,
      useDisc,
      meta.length ? el('div', { class: 'av-meta' }, ...meta) : null,
      issue);
    if (edit) edit.addEventListener('click', () => {
      const open = line2.hidden;
      line2.hidden = !open;
      edit.setAttribute('aria-expanded', String(open));
    });
    line2.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      line2.hidden = true;
      edit?.setAttribute('aria-expanded', 'false');
      edit?.focus();
    });
    ui.set(row.id, { issue, row, lineName });
    return li;
  }

  function draw(focusRow = '') {
    ui.clear();
    const rows = reviewRows(draft);
    const nodes = [];
    let extrasHead = false;
    for (const row of rows) {
      if (!row.disc && rows.some((x) => x.disc) && !extrasHead) {
        extrasHead = true;
        nodes.push(el('li', { class: 'wiz-extras-head t-caption muted', 'aria-hidden': 'true' }, `Other tracks from the ${draft.kind === 'video' ? 'video' : 'playlist'}`));
      }
      nodes.push(rowNode(row, rows));
    }
    list.replaceChildren(...nodes);
    if (focusRow) list.querySelector(`select[data-row="${focusRow}"]`)?.focus();
    return rows;
  }

  function paintRows() {
    const view = reviewView(draft);
    for (const { issue, row, lineName } of ui.values()) {
      const bad = row.src && row.st?.include ? rowIssueFor(draft, view, row.src) : '';
      issue.textContent = bad;
      issue.hidden = !bad;
      if (!row.disc && row.src) lineName.childNodes[0].textContent = srcName(row.src);
    }
  }

  function setAll(on) {
    for (const row of reviewRows(draft)) if (row.src && row.st) { row.st.include = on; if (!on) row.st.useExisting = false; }
    draw();
  }

  return { node: list, draw, paintRows, setAll, allOn: () => reviewRows(draft).filter((r) => r.src).every((r) => r.st.include) };
}
