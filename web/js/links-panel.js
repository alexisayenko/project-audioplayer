import { el } from './dom.js';
import { serviceIcon, serviceIcons, LABELS } from './service-icons.js';
import { loadCollapsed, saveCollapsed, PANEL_KEYS } from './collapsible.js';

const httpUrl = (v) => (typeof v === 'string' && /^https?:\/\/\S+$/i.test(v.trim()) ? v.trim() : null);

let seq = 0;
const ensureId = (r) => {
  if (!r.msg.id) r.msg.id = `lk-err-${seq += 1}`;
  return r.msg.id;
};

export const LINK_ROWS = [
  { key: 'youtube', kind: 'youtube', label: 'YouTube link' },
  { key: 'soundcloud', kind: 'soundcloud', label: 'SoundCloud link' },
  { key: 'wikipedia_song', kind: 'wikipedia', label: 'Wikipedia: song' },
  { key: 'wikipedia_artist', kind: 'wikipedia', label: 'Wikipedia: band' },
  { key: 'wikipedia_album', kind: 'wikipedia', label: 'Wikipedia: album' },
  { key: 'spotify', kind: 'spotify', label: 'Spotify link' },
  { key: 'musicbrainz', kind: 'musicbrainz', label: 'MusicBrainz link' },
  { key: 'discogs', kind: 'discogs', label: 'Discogs link' },
];

export function linksPanel({ inputs, readOnly = [], storage = globalThis.localStorage, id = 'song-links' } = {}) {
  const summary = serviceIcons({ onlyOn: true });
  summary.node.classList.add('lk-summary');
  const chev = el('span', { class: 'cl-chev', 'aria-hidden': 'true' }, '▾');
  const head = el('button', { class: 'lk-head', type: 'button', 'aria-controls': id }, chev, el('span', { class: 'lk-title' }, 'Links'));
  const body = el('div', { class: 'lk-body', id });
  const bar = el('div', { class: 'lk-bar' }, head, summary.node);
  const root = el('div', { class: 'lk-clip' }, body);

  const rows = LINK_ROWS.map((r) => {
    const inp = inputs[r.key] || el('input', { type: 'text', placeholder: r.label, 'aria-label': r.label, autocomplete: 'off', spellcheck: 'false' });
    if (readOnly.includes(r.key)) inp.readOnly = true;
    inp.setAttribute('placeholder', r.label);
    inp.setAttribute('aria-label', r.label);
    const slot = el('span', { class: 'lk-ico' });
    const msg = el('p', { class: 'lk-err t-caption', role: 'alert', hidden: true });
    body.append(el('div', { class: 'lk-row' }, slot, inp), msg);
    return { ...r, inp, slot, msg };
  });

  const paintRow = (r, url) => {
    const link = httpUrl(url);
    const icon = serviceIcon(r.kind, { size: 20 });
    const node = el(link ? 'a' : 'span', { class: `svc svc-${r.kind}${link ? ' on' : ' off'}` });
    node.title = link ? `Open ${LABELS[r.kind]}` : `${LABELS[r.kind]} (empty)`;
    if (link) {
      node.href = link;
      node.target = '_blank';
      node.rel = 'noopener';
      node.setAttribute('aria-label', `Open ${r.label}`);
    } else node.setAttribute('aria-hidden', 'true');
    node.append(icon);
    r.slot.replaceChildren(node);
  };

  const set = (collapsed) => {
    root.classList.toggle('collapsed', collapsed);
    head.classList.toggle('collapsed', collapsed);
    head.setAttribute('aria-expanded', String(!collapsed));
    head.title = collapsed ? 'Show links' : 'Hide links';
  };
  set(loadCollapsed(storage, PANEL_KEYS.links, 0));
  head.addEventListener('click', () => {
    const v = !root.classList.contains('collapsed');
    set(v);
    saveCollapsed(storage, PANEL_KEYS.links, v);
  });

  return {
    bar,
    clip: root,
    head,
    summary,
    rows,
    setErrors(errors = {}) {
      for (const r of rows) {
        const m = errors[r.key] || '';
        r.msg.textContent = m;
        r.msg.hidden = !m;
        if (m) r.inp.setAttribute('aria-invalid', 'true');
        else r.inp.removeAttribute('aria-invalid');
        if (m) r.inp.setAttribute('aria-describedby', ensureId(r));
        else r.inp.removeAttribute('aria-describedby');
      }
    },
    paint(urls, summaryStates) {
      for (const r of rows) paintRow(r, urls[r.key] ?? r.inp.value);
      summary.setState(summaryStates);
    },
  };
}
