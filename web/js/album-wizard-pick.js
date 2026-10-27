import { el, plural } from './dom.js';
import { searchDiscogs, resolvePick, RESOLVE_FAILED } from './album-wizard-flow.js';
import { offline, OFFLINE_MESSAGE } from './album-wizard-model.js';

export const candidateKey = (c) => (c === 'none' ? 'none' : `${c.kind}:${c.id}`);

export function candidateMeta(c) {
  const kind = c.kind === 'master' ? 'Master' : 'Release';
  const tracks = c.trackCount ? `${c.trackCount} ${plural(c.trackCount, 'track', 'tracks')}` : '';
  return [c.year, tracks, c.label, c.country, kind].filter(Boolean).join(' · ');
}

export function mountPick(ctx) {
  const { draft } = ctx;
  const dg = draft.discogs;
  let chosen = dg.pick ? candidateKey(dg.pick) : '';
  const note = el('p', { class: 'muted t-subhead', role: 'status' });
  const list = el('div', { class: 'wiz-cands', role: 'radiogroup', 'aria-label': 'Discogs albums' });
  const all = el('button', { class: 'link-btn t-caption discogs-all', type: 'button' }, 'Show all releases');

  const option = (c, none = false) => {
    const key = candidateKey(c);
    const radio = el('input', { type: 'radio', name: 'wiz-discogs', value: key, checked: chosen === key });
    radio.addEventListener('change', () => { chosen = key; ctx.touch(); });
    const art = !none && c.cover ? el('img', { class: 'discogs-thumb', src: c.cover, alt: '', loading: 'lazy' }) : el('span', { class: 'discogs-thumb' });
    return el('label', { class: `wiz-cand${none ? ' wiz-none' : ''}` },
      radio,
      none ? null : art,
      el('span', { class: 'info' },
        el('span', { class: 'ttl t-headline' }, none ? 'None of these' : [c.artist, c.title].filter(Boolean).join(' - ')),
        el('span', { class: 'sub t-caption muted' }, none ? 'Use the YouTube tracks as they are.' : candidateMeta(c))));
  };

  const paint = () => {
    const found = dg.candidates;
    list.replaceChildren(...found.map((c) => option(c)), option('none', true));
    note.textContent = found.length ? 'Pick the album that matches. It fills the track list, genres and art.' : dg.error;
    all.hidden = dg.all || !found.length;
    if (!chosen && !found.length) chosen = 'none';
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

  paint();
  const node = el('div', { class: 'wiz-step wiz-pick' }, note, list, all);
  return {
    node, back: true, nextLabel: 'Next', focus: () => (list.querySelector('input:checked') || list.querySelector('input'))?.focus(),
    async run() {
      if (!chosen) { ctx.say('Pick an album, or choose None of these.'); return; }
      if (offline() && chosen !== 'none') { ctx.say(OFFLINE_MESSAGE); return; }
      const cand = chosen === 'none' ? 'none' : dg.candidates.find((c) => candidateKey(c) === chosen);
      ctx.say('');
      ctx.busy(true, 'Reading the album on Discogs...');
      try {
        const ok = await resolvePick(draft, cand);
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
