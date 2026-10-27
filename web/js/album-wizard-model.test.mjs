import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installDom } from './test-dom.mjs';

installDom({ ids: ['toast', 'audio', 'mini-viz'] });
const M = await import('./album-wizard-model.js');

const { VIDEO, DISC, PLAYLIST } = await import('./album-wizard-fixture.mjs');

const make = (kind = 'video') => {
  const d = M.newDraft();
  d.address = 'https://youtu.be/yeUFSnA9Puk';
  M.applyPreview(d, kind, d.address, VIDEO);
  return d;
};

test('addresses: a playlist, a time-coded video, and clear errors for everything else', () => {
  assert.deepEqual(M.classifyAddress('https://www.youtube.com/playlist?list=PLabcdefghij').kind, 'playlist');
  assert.equal(M.classifyAddress('https://youtu.be/yeUFSnA9Puk?t=5').kind, 'video');
  assert.equal(M.classifyAddress('  ').error, M.EMPTY_MESSAGE);
  const mix = M.classifyAddress('https://www.youtube.com/playlist?list=RDyeUFSnA9Puk');
  assert.equal(mix.ok, false);
  assert.match(mix.error, /Mix/);
  assert.match(M.classifyAddress('https://www.youtube.com/playlist?list=WL').error, /private/);
  const d = M.classifyAddress('https://www.discogs.com/release/545650-Derango-Tumult');
  assert.equal(d.error, M.NOT_YOUTUBE_MESSAGE);
  assert.equal(d.hint, M.DISCOGS_HINT);
  assert.equal(M.classifyAddress('https://example.com/x').hint, '');
});

test('a pasted list with lengths only becomes a time-coded text; coded text is left alone', () => {
  const coded = M.normalisePasted('00:00 A - One\n03:45 A - Two');
  assert.equal(coded.converted, false);
  const lengths = M.normalisePasted('1 A - One 3:45\n2 Two 4:00\nTotal length: 7:45');
  assert.equal(lengths.converted, true);
  assert.equal(lengths.text, '00:00:00 A - One\n00:03:45 Two');
  assert.equal(M.normalisePasted('just words').converted, false);
});

test('a preview fills the three fields from the guess and keeps the rest for later steps', () => {
  const d = make();
  assert.deepEqual(d.fields, { artist: 'Hallucinogen', album: 'Twisted', year: '1995' });
  assert.equal(d.step, 'details');
  assert.deepEqual(d.album.genres, ['psytrance']);
  assert.equal(d.album.links.youtube, 'https://youtu.be/yeUFSnA9Puk');
  assert.equal(M.fieldIssues({ artist: '', album: ' ', year: '19' }).length, 3);
});

test('restart needs a confirm only when the address changed after edits', () => {
  const d = make();
  assert.equal(M.needsRestart(d, 'https://youtu.be/other'), false);
  d.edited = true;
  assert.equal(M.needsRestart(d, 'https://youtu.be/other'), true);
  assert.equal(M.needsRestart(d, ' https://youtu.be/yeUFSnA9Puk '), false);
  assert.equal(M.sameSource(d, 'https://youtu.be/yeUFSnA9Puk'), true);
});

test('confident match: one exact artist, album and year within one; otherwise the picker shows', () => {
  const f = { artist: 'Hallucinogen', album: 'Twisted', year: '1995' };
  assert.equal(M.isConfident([DISC], f).id, 7);
  assert.equal(M.isConfident([DISC, { ...DISC, id: 8, year: 1996 }], f), null);
  assert.equal(M.isConfident([{ ...DISC, year: 2001 }], f), null);
  assert.equal(M.isConfident([{ ...DISC, title: 'Twisted (Deluxe)' }], f), null);
  assert.equal(M.isConfident([], f), null);
  assert.equal(M.isConfident([DISC], { ...f, year: '' }).id, 7);
});

test('step order skips Discogs when it was matched alone, in both directions', () => {
  const d = make();
  assert.equal(M.afterStep(d, 'link'), 'details');
  assert.equal(M.afterStep(d, 'details'), 'discogs');
  assert.equal(M.beforeStep(d, 'review'), 'discogs');
  d.discogs.auto = true;
  assert.equal(M.afterStep(d, 'details'), 'review');
  assert.equal(M.beforeStep(d, 'review'), 'details');
  assert.equal(M.afterStep(d, 'review'), 'run');
  assert.equal(M.beforeStep(d, 'link'), 'link');
});

test('matching pairs Discogs tracks to video tracks by title, with a version, and leaves the rest', () => {
  const d = make();
  d.discogs.resolved = DISC;
  M.buildReview(d);
  const keys = d.st.rows.map((r) => r.key);
  assert.deepEqual([...d.review.assign], [[1, keys[0]], [2, null], [3, keys[2]], [4, keys[1]]]);
  const rows = M.reviewRows(d);
  assert.equal(rows.length, 4);
  assert.equal(rows[1].src, null);
  assert.equal(d.review.state.get(keys[1]).include, false);
  assert.equal(d.review.state.get(keys[0]).include, true);
});

test('without a Discogs list the review is the source tracks in order, library matches unticked', () => {
  const d = make();
  M.buildReview(d);
  const rows = M.reviewRows(d);
  assert.deepEqual(rows.map((r) => r.disc), [null, null, null]);
  assert.deepEqual(rows.map((r) => r.st.include), [true, false, true]);
});

test('re-assigning swaps with the row that held the track, or parks the displaced one', () => {
  const d = make();
  d.discogs.resolved = DISC;
  M.buildReview(d);
  const [a, b, c] = d.st.rows.map((r) => r.key);
  M.reassign(d, 1, c);
  assert.equal(d.review.assign.get(1), c);
  assert.equal(d.review.assign.get(3), a);
  M.reassign(d, 2, b);
  assert.equal(d.review.assign.get(2), b);
  assert.equal(d.review.assign.get(4), null);
  M.reassign(d, 3, null);
  assert.equal(d.review.assign.get(3), null);
  assert.equal(d.review.state.get(a).include, false);
  assert.ok(M.reviewRows(d).some((r) => r.id === `s${a}`));
});

test('the view numbers tracks by Discogs position, extras after them, and keeps own artists', () => {
  const d = make();
  d.discogs.resolved = DISC;
  M.buildReview(d);
  const [a, , c] = d.st.rows.map((r) => r.key);
  M.reassign(d, 3, null);
  d.review.state.get(c).include = true;
  const view = M.reviewView(d);
  const byTitle = Object.fromEntries(view.rows.map((r) => [r.title, r]));
  assert.equal(byTitle.LSD.no, 1);
  assert.equal(byTitle.Gloople.no, 5);
  assert.equal(byTitle.LSD.artists, 'Hallucinogen');
  assert.equal(byTitle.Gloople.artists, 'Guest');
  assert.equal(byTitle['Spirit Guide'].include, false);
  assert.equal(a, view.rows[0].key);
});

test('a track without an artist of its own takes the album artist as the user edits it', () => {
  const d = make();
  d.fields.artist = 'Hallucinogen & Friend';
  M.buildReview(d);
  const view = M.reviewView(d);
  assert.deepEqual(view.rows.map((r) => r.artists), ['Hallucinogen & Friend', 'Hallucinogen & Friend', 'Guest']);
  d.fields.artist = 'Various Artists';
  assert.equal(M.reviewView(d).rows[0].artists, '');
});

test('the video body carries the album, art, genres, per-track numbers and coverToSongs', () => {
  const d = make();
  d.discogs.resolved = DISC;
  d.discogs.pick = DISC;
  d.art.chosen = DISC.cover;
  d.album.genres = ['psytrance', 'goa'];
  d.album.links = { ...d.album.links, discogs: DISC.url };
  M.buildReview(d);
  const body = M.createPayload(d);
  assert.equal(body.coverToSongs, true);
  assert.equal(body.url, VIDEO.url);
  assert.deepEqual(body.album.genres, ['psytrance', 'goa']);
  assert.equal(body.album.coverUrl, DISC.cover);
  assert.equal(body.album.title, 'Twisted');
  assert.equal(body.album.links.discogs, DISC.url);
  const picked = body.tracks.filter((t) => t.include);
  assert.deepEqual(picked.map((t) => [t.title, t.trackNo, t.start, t.end]), [['LSD', 1, 0, 300], ['Gloople', 3, 700, 1200]]);
  assert.deepEqual(body.tracks.find((t) => t.title === 'Gloople').artists, ['Guest']);
  assert.equal(body.tracks.find((t) => t.title === 'Gloople').version, 'Remix');
  assert.equal(M.createIssues(d).length, 0);
});

test('Use existing links the library song and ticks the track', () => {
  const d = make();
  M.buildReview(d);
  const b = d.st.rows[1].key;
  d.review.state.get(b).include = true;
  d.review.state.get(b).useExisting = true;
  const t = M.createPayload(d).tracks[1];
  assert.equal(t.useExistingSongId, 's9');
  assert.equal(t.include, true);
});

const WITH_MIX = { ...DISC, tracks: DISC.tracks.map((t) => (t.no === 4 ? { ...t, title: 'Spirit Guide (Metal Mix)' } : t.no === 1 ? { ...t, title: 'LSD (Live)' } : t)) };
const byNo = (d) => Object.fromEntries(M.createPayload(d).tracks.map((t) => [t.trackNo, [t.title, t.version]]));

test('the title of a matched row follows the Discogs track, split like the song form does', () => {
  const d = make();
  d.discogs.resolved = WITH_MIX;
  M.buildReview(d);
  const tracks = byNo(d);
  assert.deepEqual(tracks[1], ['LSD', 'Live']);
  assert.deepEqual(tracks[3], ['Gloople', 'Remix']);
  assert.deepEqual(tracks[4], ['Spirit Guide (Metal Mix)', null]);
  assert.equal(M.reviewRows(d).find((r) => r.id === 'd2').src, null);
});

test('splitDiscTitle splits only a version the song form recognises, never a feature or an unknown bracket', () => {
  assert.deepEqual(M.splitDiscTitle('Gloople (Remix)', 'Guest'), { title: 'Gloople', version: 'Remix' });
  assert.deepEqual(M.splitDiscTitle('Foo (Bar Remix)'), { title: 'Foo', version: 'Bar Remix' });
  assert.deepEqual(M.splitDiscTitle('State Of Mind (Metal Mix)'), { title: 'State Of Mind (Metal Mix)', version: '' });
  assert.deepEqual(M.splitDiscTitle('Song (feat. X) (Live)'), { title: 'Song (feat. X) (Live)', version: '' });
  assert.deepEqual(M.splitDiscTitle('Plain'), { title: 'Plain', version: '' });
});

test('re-assigning the video track recomputes the automatic title', () => {
  const d = make();
  d.discogs.resolved = WITH_MIX;
  M.buildReview(d);
  M.reassign(d, 4, d.st.rows[0].key);
  const tracks = byNo(d);
  assert.deepEqual(tracks[4], ['Spirit Guide (Metal Mix)', null]);
  assert.deepEqual(tracks[1], ['LSD', 'Live']);
  M.reassign(d, 4, null);
  M.reassign(d, 2, d.st.rows[1].key);
  assert.deepEqual(M.reviewView(d).rows[1].title, 'Snakey Shaker');
});

test('a title the user edited wins and survives re-assigning the match', () => {
  const d = make();
  d.discogs.resolved = WITH_MIX;
  M.buildReview(d);
  const row = M.reviewRows(d).find((r) => r.id === 'd4');
  M.editDiscTitle(d, row, 'title', 'Mine');
  assert.deepEqual(byNo(d)[4], ['Mine', null]);
  M.reassign(d, 4, d.st.rows[0].key);
  assert.deepEqual(byNo(d)[4], ['Mine', null]);
  assert.deepEqual(M.discTitleParts(d, M.reviewRows(d).find((r) => r.id === 'd4')), { title: 'Mine', version: '' });
  M.editDiscTitle(d, M.reviewRows(d).find((r) => r.id === 'd4'), 'version', 'Edit');
  assert.deepEqual(byNo(d)[4], ['Mine', 'Edit']);
});

test('without a Discogs pick, and for leftover tracks, the video titles stay', () => {
  const d = make();
  M.buildReview(d);
  assert.deepEqual(M.createPayload(d).tracks.map((t) => [t.title, t.version]), [['LSD', null], ['Spirit Guide', null], ['Gloople', 'Remix']]);
  d.discogs.resolved = WITH_MIX;
  M.buildReview(d);
  M.reassign(d, 3, null);
  const view = M.reviewView(d);
  const left = view.rows.find((r) => r.title === 'Gloople');
  assert.equal(left.version, 'Remix');
  assert.equal(left.no, 5);
});

test('issues block a bad start or an empty selection', () => {
  const d = make();
  M.buildReview(d);
  for (const s of d.review.state.values()) s.include = false;
  assert.ok(M.createIssues(d).includes('Tick at least one track.'));
  d.review.state.get(d.st.rows[0].key).include = true;
  d.st.rows[0].badStart = true;
  assert.ok(M.createIssues(d).some((t) => /Start must look like/.test(t)));
});

test('the playlist body keeps positions, adds Discogs numbers and coverToSongs', () => {
  const d = M.newDraft();
  d.address = PLAYLIST.playlist.url;
  M.applyPreview(d, 'playlist', d.address, PLAYLIST);
  d.discogs.resolved = DISC;
  M.buildReview(d);
  const body = M.createPayload(d);
  assert.equal(body.playlistUrl, d.address);
  assert.equal(body.coverToSongs, true);
  assert.deepEqual(body.selected.map((s) => [s.position, s.trackNo]), [[1, 1], [2, 3], [3, 4]]);
  assert.equal(M.createLabel(d), 'Import and download 2 tracks');
  assert.equal(M.createLabel(make()), 'Download, cut and import');
});

test('art: Discogs cover first, YouTube thumbnail as fallback, no duplicates', () => {
  const d = make();
  assert.deepEqual(M.artOptions(d).map((o) => o.label), ['YouTube']);
  d.discogs.resolved = DISC;
  d.discogs.pick = { ...DISC, cover: 'https://img.discogs.com/other.jpg' };
  assert.deepEqual(M.artOptions(d).map((o) => o.label), ['Discogs', 'Discogs', 'YouTube']);
  d.discogs.pick = 'none';
  assert.deepEqual(M.artOptions(d).map((o) => o.url), [DISC.cover, VIDEO.thumbnail]);
});

test('genres: names sent to the server, first four mapped ones, RYM link or text', () => {
  const d = make();
  d.discogs.resolved = DISC;
  assert.deepEqual(M.names(DISC), ['Psy-Trance', 'Electronic']);
  assert.deepEqual(M.genresPayload(d).discogs, ['Psy-Trance', 'Electronic']);
  assert.equal(M.genresPayload(d, 'goa, psytrance').rym, 'goa, psytrance');
  d.genreHints.items = [
    { name: 'Psy-Trance', source: 'discogs', mapped: 'psytrance', unmapped: false },
    { name: 'Weird', source: 'discogs', mapped: null, unmapped: true },
    { name: 'goa', source: 'rym', mapped: 'goa trance', unmapped: false },
  ];
  assert.deepEqual(M.initialGenres(d), ['goa trance', 'psytrance']);
  assert.deepEqual(M.parseRym('https://rateyourmusic.com/release/album/hallucinogen/twisted/'), { url: 'https://rateyourmusic.com/release/album/hallucinogen/twisted/', genres: '' });
  assert.deepEqual(M.parseRym('Genres: goa, psy'), { url: '', genres: 'Genres: goa, psy' });
  assert.deepEqual(M.parseRym(' '), { url: '', genres: '' });
  assert.equal(M.parseRym('https://evil.example/rateyourmusic.com/x').url, '');
});

test('length gap flags a likely wrong pairing', () => {
  const d = make();
  d.discogs.resolved = DISC;
  M.buildReview(d);
  const rows = M.reviewRows(d);
  assert.equal(M.lengthGap(d, rows[0]), 0);
  assert.equal(M.lengthGap(d, rows[3]), 0);
  assert.equal(M.lengthGap(d, rows[1]), 0);
});

test('an older preview without the album block still fills the fields and the type', () => {
  const d = M.newDraft();
  M.applyPreview(d, 'video', 'https://youtu.be/yeUFSnA9Puk', {
    videoId: 'yeUFSnA9Puk', url: 'https://youtu.be/yeUFSnA9Puk', title: 'Deep Mix', uploader: 'DJ Q', duration: 3600, source: 'description', rawText: '',
    artist: 'Foo', year: 2012, type: 'ep', genres: ['Techno'],
    tracks: [{ index: 0, start: 0, end: 1800, artist: 'Foo', title: 'One', version: null, warnings: [], match: null }, { index: 1, start: 1800, end: 3600, artist: 'Foo', title: 'Two', version: null, warnings: [], match: null }],
    warnings: [],
  });
  assert.equal(d.fields.album, 'Deep Mix');
  assert.equal(d.album.type, 'EP');
  assert.deepEqual(d.album.genres, ['Techno']);
});
