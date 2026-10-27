import { el, plural, field } from './dom.js';
import { fieldIssues, offline, OFFLINE_MESSAGE } from './album-wizard-model.js';
import { runDetails } from './album-wizard-flow.js';

const SOURCE_NOTE = { chapters: 'from the video chapters', description: 'from the video description', pasted: 'from the pasted text' };

export function sourceLine(draft) {
  const st = draft.st;
  const count = st.rows.length;
  const title = draft.kind === 'video' ? st.videoTitle : st.playlist?.title;
  const who = draft.kind === 'video' ? st.uploader : st.playlist?.uploader;
  const how = draft.kind === 'video' ? `${count} ${plural(count, 'track', 'tracks')} ${SOURCE_NOTE[st.source] || 'found'}` : `${count} ${plural(count, 'video', 'videos')} in the playlist`;
  return [title, who, how].filter(Boolean).join(' · ');
}

export function mountDetails(ctx) {
  const { draft } = ctx;
  const f = draft.fields;
  const mk = (label, key, extra = {}) => {
    const input = el('input', { type: 'text', value: f[key], autocomplete: 'off', 'aria-label': label, ...extra });
    input.addEventListener('input', () => { f[key] = input.value; ctx.touch(); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ctx.submit(); } });
    return input;
  };
  const artist = mk('Artist', 'artist');
  const album = mk('Album name', 'album');
  const year = mk('Year', 'year', { class: 'album-year', inputMode: 'numeric', maxLength: 4, size: 4 });
  const warnings = (draft.st.warnings || []).map((w) => el('p', { class: 'muted t-caption av-warn' }, w));
  const node = el('div', { class: 'wiz-step wiz-details' },
    el('p', { class: 'muted t-subhead' }, 'Suggested from the title, the channel and the description. Change what is wrong.'),
    field('Artist', artist),
    field('Album name', album),
    field('Year', year),
    el('p', { class: 'muted t-caption wiz-source' }, sourceLine(draft)),
    ...warnings);
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
