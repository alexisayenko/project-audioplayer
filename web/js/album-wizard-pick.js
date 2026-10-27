import { el, plural } from './dom.js';
import { searchDiscogs, resolvePick, resolveLink, RESOLVE_FAILED } from './album-wizard-flow.js';
import { offline, OFFLINE_MESSAGE } from './album-wizard-model.js';
import { parseDiscogsLink, LINK_ERRORS } from './discogs-link.js';

export const candidateKey = (c) => (c === 'none' ? 'none' : `${c.kind}:${c.id}`);
export const UNREACHABLE_MESSAGE = 'The server could not be reached. Check the connection and try again.';

export function candidateMeta(c) {
  const kind = c.kind === 'master' ? 'Master' : 'Release';
  const tracks = c.trackCount ? `${c.trackCount} ${plural(c.trackCount, 'track', 'tracks')}` : '';
  return [c.year, tracks, c.label, c.country, kind].filter(Boolean).join(' · ');
}

export function mountPick(ctx) {
  const { draft } = ctx;
  const dg = draft.discogs;
  let chosen = dg.pick ? candidateKey(dg.pick) : '';
  let prior = '';
  const note = el('p', { class: 'muted t-subhead', role: 'status' });
  const list = el('div', { class: 'wiz-cands', role: 'radiogroup', 'aria-label': 'Discogs albums' });
  const all = el('button', { class: 'link-btn t-caption discogs-all', type: 'button' }, 'Show all releases');

  const option = (c, { none = false, linked = false } = {}) => {
    const key = candidateKey(c);
    const radio = el('input', { type: 'radio', name: 'wiz-discogs', value: key, checked: chosen === key });
    radio.addEventListener('change', () => { chosen = key; ctx.touch(); });
    const art = !none && c.cover ? el('img', { class: 'discogs-thumb', src: c.cover, alt: '', loading: 'lazy' }) : el('span', { class: 'discogs-thumb' });
    return el('label', { class: `wiz-cand${none ? ' wiz-none' : ''}${linked ? ' wiz-linked' : ''}` },
      radio,
      none ? null : art,
      el('span', { class: 'info' },
        el('span', { class: 'ttl t-headline' }, none ? 'None of these' : [c.artist, c.title].filter(Boolean).join(' - ')),
        el('span', { class: 'sub t-caption muted' }, none ? 'Use the YouTube tracks as they are.' : [linked ? 'From your link' : '', candidateMeta(c)].filter(Boolean).join(' · '))));
  };

  const paint = () => {
    const linkedKey = dg.linked ? candidateKey(dg.linked) : '';
    const found = dg.candidates.filter((c) => candidateKey(c) !== linkedKey);
    list.replaceChildren(...(dg.linked ? [option(dg.linked, { linked: true })] : []), ...found.map((c) => option(c)), option('none', { none: true }));
    note.textContent = found.length || dg.linked ? 'Pick the album that matches. It fills the track list, genres and art.' : dg.error;
    all.hidden = dg.all || !dg.candidates.length;
    if (!chosen && !found.length && !dg.linked) chosen = 'none';
    const sel = list.querySelector(`input[value="${chosen}"]`);
    if (sel) sel.checked = true;
  };

  all.addEventListener('click', async () => {
    if (offline()) { ctx.say(OFFLINE_MESSAGE); return; }
    ctx.say('');
    ctx.busy(true, 'Searching Discogs...');
    await searchDiscogs(draft, { all: true });
    ctx.busy(false);
    chosen = '';
    paint();
  });

  const linkInput = el('input', {
    type: 'text', id: 'wiz-discogs-url', placeholder: 'discogs.com/master/... or discogs.com/release/...', 'aria-label': 'Discogs album address',
    autocomplete: 'off', inputMode: 'url', value: dg.linked?.url || '',
  });
  const useBtn = el('button', { class: 'btn fill small wiz-use', type: 'button', 'aria-label': 'Use this Discogs link' }, 'Use');
  const linkNote = el('p', { class: 'msg error wiz-link-error t-caption', role: 'alert', hidden: true });
  const showError = (text) => { linkNote.textContent = text; linkNote.hidden = !text; };
  let busy = false;
  const paintUse = () => { useBtn.disabled = busy || !linkInput.value.trim(); };
  ctx.watchBusy((on) => { busy = on; useBtn.toggleAttribute('aria-busy', on); paintUse(); });
  paintUse();

  async function apply() {
    const text = linkInput.value.trim();
    if (!text || busy) return;
    showError('');
    const parsed = parseDiscogsLink(text);
    if (!parsed.ok) { showError(parsed.error); linkInput.focus(); return; }
    if (offline()) { showError(OFFLINE_MESSAGE); return; }
    ctx.say('');
    ctx.busy(true, 'Reading the album on Discogs...');
    try {
      const res = await resolveLink(parsed);
      if (!ctx.live()) return;
      if (!res.ok) {
        showError(res.error === 'unreachable' ? UNREACHABLE_MESSAGE : (LINK_ERRORS[res.error] || LINK_ERRORS.discogs_failed));
        return;
      }
      if (!dg.linked) prior = chosen;
      dg.linked = res.candidate;
      chosen = candidateKey(res.candidate);
      ctx.touch();
      paint();
    } finally {
      ctx.busy(false);
    }
  }

  const clearLink = () => {
    if (!dg.linked) return;
    const was = candidateKey(dg.linked);
    dg.linked = null;
    if (chosen === was) chosen = prior;
    prior = '';
    paint();
  };

  useBtn.addEventListener('click', () => { void apply(); });
  linkInput.addEventListener('input', () => {
    paintUse();
    showError('');
    if (!linkInput.value.trim()) clearLink();
  });
  linkInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); void apply(); } });

  paint();
  const node = el('div', { class: 'wiz-step wiz-pick' }, note, list, all,
    el('div', { class: 'field' },
      el('label', { for: 'wiz-discogs-url' }, 'Paste a Discogs link'),
      el('div', { class: 'well wiz-well' }, linkInput, useBtn),
      linkNote));
  return {
    node, back: true, nextLabel: 'Next', focus: () => (list.querySelector('input:checked') || list.querySelector('input'))?.focus(),
    async run() {
      if (!chosen) { ctx.say('Pick an album, or choose None of these.'); return; }
      if (offline() && chosen !== 'none') { ctx.say(OFFLINE_MESSAGE); return; }
      const cand = chosen === 'none' ? 'none' : [dg.linked, ...dg.candidates].filter(Boolean).find((c) => candidateKey(c) === chosen);
      ctx.say('');
      ctx.busy(true, 'Reading the album on Discogs...');
      try {
        const ok = await resolvePick(draft, cand, cand !== 'none' && cand === dg.linked ? { full: dg.linked } : {});
        if (!ctx.live()) return;
        if (!ok) { ctx.say(RESOLVE_FAILED); return; }
        dg.auto = false;
        ctx.go('review');
      } finally {
        ctx.busy(false);
      }
    },
  };
}
