import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './test-dom.mjs';

installDom({ ids: ['toast', 'audio', 'mini-viz'] });
const { trackListPanel } = await import('./album-tracklist-panel.js');
const { stateOf, payload, endOf, trackLabel, youtubeAt } = await import('./album-video-model.js');

const SAMPLE = [
  '1 Dancing Galaxylyrics 9:18', '2 Soundform 8:12', '3 Quantum Leap 9:45', '4 Third Eye 8:25', '5 Mother Earth 10:19',
  '6 Solar Wind 9:09', '7 Deep Space 11:01', '8 Ambient Galaxy (Disco Valley Mix) 13:45', 'Total length: 79:54',
].join('\n');

const PV = {
  videoId: 'yeUFSnA9Puk', url: 'https://youtu.be/yeUFSnA9Puk', title: 'Deep Mix', duration: 79 * 60 + 54,
  tracks: [{ start: 0, title: 'Old', artists: ['X'] }, { start: 100, title: 'Old 2', artists: ['X'] }],
  album: { title: 'Galaxy', albumArtist: 'Hallucinogen', type: 'album' },
};

function setup(duration = PV.duration) {
  const st = stateOf({ ...PV, duration }, PV.url);
  const ctx = { draws: 0, paints: 0, drawRows() { this.draws += 1; }, paint() { this.paints += 1; } };
  const node = trackListPanel({ st, ctx });
  const all = (tag) => node.querySelectorAll(tag);
  const [toggle] = all('button');
  const btn = (re) => [...all('button')].find((b) => re.test(b.textContent));
  const area = node.querySelector('textarea');
  return { st, ctx, node, toggle, btn, area, panel: node.querySelector('.av-tl-panel'), warn: node.querySelector('.av-warn'), mismatch: node.querySelector('.av-tl-mismatch') };
}

test('collapsed by default; the button opens the textarea', () => {
  const t = setup();
  assert.equal(t.panel.hidden, true);
  assert.equal(t.toggle.getAttribute('aria-expanded'), 'false');
  t.toggle.click();
  assert.equal(t.panel.hidden, false);
  assert.equal(t.toggle.getAttribute('aria-expanded'), 'true');
});

test('the example list gives the right starts, ends and commit payload; untouched rows are replaced without asking', () => {
  const t = setup();
  t.area.value = SAMPLE;
  t.btn(/Use this list/).click();
  assert.equal(t.st.rows.length, 8);
  assert.equal(t.ctx.draws, 1);
  assert.deepEqual(t.st.rows.map((r) => r.start), [0, 558, 1050, 1635, 2140, 2759, 3308, 3969]);
  assert.equal(endOf(t.st, 7), 79 * 60 + 54);
  assert.equal(t.st.rows[0].artists, 'Hallucinogen');
  assert.equal(trackLabel(t.st, 7).length, '13:45');
  const p = payload(t.st);
  assert.deepEqual(p.tracks.map((x) => [x.start, x.end, x.trackNo]).slice(6), [[3308, 3969, 7], [3969, 4794, 8]]);
  assert.deepEqual(p.tracks[0].artists, ['Hallucinogen']);
  assert.equal(youtubeAt(t.st.videoId, t.st.rows[1].start), 'https://youtu.be/yeUFSnA9Puk?t=558');
  assert.equal(t.mismatch.hidden, true);
});

test('a shorter or longer video shows the muted warning; Scale to video length rescales starts', () => {
  const t = setup(80 * 60 + 54);
  t.area.value = SAMPLE;
  t.btn(/Use this list/).click();
  assert.equal(t.mismatch.hidden, false);
  assert.equal(t.warn.textContent, 'Track list is 1:00 shorter than the video');
  t.btn(/Scale to video length/).click();
  assert.equal(t.mismatch.hidden, true);
  assert.equal(t.st.rows[0].start, 0);
  assert.equal(t.st.rows[7].start, Math.round(3969 * 4854 / 4794));
  assert.equal(endOf(t.st, 7), 4854);
  assert.equal(t.st.rows[1].startText, '00:09:25');
  const longer = setup(60 * 60);
  longer.area.value = SAMPLE;
  longer.btn(/Use this list/).click();
  assert.equal(longer.warn.textContent, 'Track list is 19:54 longer than the video');
});

test('edited tracks need a second click to be replaced; a missing length warns on its row', () => {
  const t = setup();
  t.st.rows[0].title = 'Edited';
  t.area.value = '1 One 3:00\n2 Two\n3 Three 2:00';
  const use = t.btn(/Use this list/);
  use.click();
  assert.equal(t.st.rows[0].title, 'Edited');
  assert.match(t.node.textContent, /You edited the tracks/);
  t.btn(/Replace my edits/).click();
  assert.deepEqual(t.st.rows.map((r) => r.title), ['One', 'Two', 'Three']);
  assert.deepEqual(t.st.rows.map((r) => r.warnings.length), [0, 1, 0]);
  assert.match(t.node.textContent, /"Two" has no length/);
});

test('text without a usable line says so and changes nothing', () => {
  const t = setup();
  t.area.value = '\n\n';
  t.btn(/Use this list/).click();
  assert.equal(t.st.rows.length, 2);
  assert.match(t.node.textContent, /No tracks found/);
});
