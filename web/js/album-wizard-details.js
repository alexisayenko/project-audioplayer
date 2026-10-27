import { el, plural, field } from './dom.js';
import { tokenGroup } from './token-field.js';
import { trackClock } from './album-draft-model.js';
import { fieldIssues, offline, OFFLINE_MESSAGE } from './album-wizard-model.js';
import { fold } from './album-candidates.js';
import { runDetails } from './album-wizard-flow.js';

export const CHANNEL_NOTE = 'The artist is the channel name, not read from the title. Check it.';

export function sourceParts(draft) {
  const st = draft.st;
  const video = draft.kind === 'video';
  const count = st.rows.length;
  const secs = video ? st.duration : st.rows.reduce((sum, r) => sum + (r.durationS || 0), 0);
  return [
    video ? st.uploader : st.playlist?.uploader,
    video ? st.videoTitle : st.playlist?.title,
    count ? `${count} ${plural(count, 'track', 'tracks')}` : '',
    secs > 0 ? trackClock(secs) : '',
  ].filter(Boolean);
}

export const sourceLine = (draft) => sourceParts(draft).join(' · ');

export function fromChannel(draft) {
  const channel = String((draft.kind === 'video' ? draft.st.uploader : draft.st.playlist?.uploader) || '').trim();
  return !!channel && !/\s-\s*topic$/i.test(channel) && fold(draft.base?.artist) === fold(channel);
}

export function mountDetails(ctx) {
  const { draft } = ctx;
  const f = draft.fields;
  const tg = tokenGroup();
  const artist = tg.field('artists', f.artist);
  const album = tg.field('title', f.album);
  artist.setLabel('Artist');
  album.setLabel('Album name');
  for (const [key, node] of [['artist', artist], ['album', album]]) {
    node.addEventListener('input', () => { f[key] = node.value; ctx.touch(); });
    node.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.classList.contains('token-entry') && !e.target.value.trim()) { e.preventDefault(); ctx.submit(); }
    });
  }
  const year = el('input', { type: 'text', value: f.year, autocomplete: 'off', 'aria-label': 'Year', class: 'album-year', inputMode: 'numeric', maxLength: 4, size: 4 });
  year.addEventListener('input', () => { f.year = year.value; ctx.touch(); });
  year.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ctx.submit(); } });
  const notes = [...(draft.st.warnings || []), ...(fromChannel(draft) ? [CHANNEL_NOTE] : [])].map((w) => el('p', { class: 'muted t-caption av-warn' }, w));
  const href = draft.kind === 'video' ? draft.st.url : (draft.st.playlist?.url || draft.st.url);
  const node = el('div', { class: 'wiz-step wiz-details' },
    el('p', { class: 'muted t-subhead' }, 'Suggested from the title, the channel and the description. Change what is wrong.'),
    field('Artist', artist),
    field('Album name', album),
    field('Year', year),
    el('p', { class: 't-caption wiz-source' }, el('a', { href: href || draft.url, target: '_blank', rel: 'noopener' }, sourceLine(draft))),
    ...notes);
  return {
    node, back: true, nextLabel: 'Next', focus: () => album.focus(),
    async run() {
      const bad = fieldIssues(f);
      if (bad.length) { ctx.say(bad[0]); return; }
      if (offline()) { ctx.say(OFFLINE_MESSAGE); return; }
      ctx.say('');
      ctx.busy(true, 'Searching Discogs...');
      try {
        const next = await runDetails(draft);
        if (ctx.live()) ctx.go(next);
      } finally {
        ctx.busy(false);
      }
    },
  };
}
