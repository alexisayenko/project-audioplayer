import { test } from 'node:test';
import assert from 'node:assert/strict';
import { playlistState, issues, summary, trackLabel, payload, toDownload } from './album-youtube-model.js';

const PV = {
  playlist: { title: 'A - B', uploader: 'x', count: 3, url: 'https://www.youtube.com/playlist?list=PL1' },
  album: { title: 'B', albumArtist: 'A', type: 'EP', year: 1999, coverUrl: 'https://i/d.jpg' },
  genres: ['Techno'], links: { discogs: 'https://www.discogs.com/master/1', wikipedia: null }, discogsMatch: 'https://www.discogs.com/master/1', thumbnail: 'https://i/t.jpg',
  tracks: [
    { position: 1, videoId: 'aaaaaaaaaaa', title: 'One', artists: ['A', 'C'], version: 'Dub', durationS: 125, url: 'u1', songId: null },
    { position: 3, videoId: 'bbbbbbbbbbb', title: 'Two', artists: ['A'], version: null, durationS: null, url: 'u2', songId: 's1' },
  ],
};

test('state: album from the preview, Discogs link kept, youtube link is the playlist, rows checked', () => {
  const st = playlistState(PV, PV.playlist.url);
  assert.deepEqual(st.album, { title: 'B', albumArtist: 'A', type: 'EP', year: '1999', genres: ['Techno'], links: { discogs: 'https://www.discogs.com/master/1', youtube: PV.playlist.url }, coverUrl: 'https://i/d.jpg' });
  assert.equal(st.discogsMatch, 'https://www.discogs.com/master/1');
  assert.deepEqual(st.rows.map((r) => [r.no, r.position, r.include, r.artists, r.songId]), [[1, 1, true, 'A & C', null], [2, 3, true, 'A', 's1']]);
});

test('labels: artist - title, version, length; no length when unknown', () => {
  const st = playlistState(PV);
  assert.deepEqual(trackLabel(st, 0), { name: 'A & C - One', version: 'Dub', length: '2:05' });
  assert.deepEqual(trackLabel(st, 1), { name: 'A - Two', version: '', length: '' });
});

test('summary, download count and validation', () => {
  const st = playlistState(PV);
  assert.equal(summary(st), '2 tracks · 2 min');
  assert.equal(toDownload(st), 1);
  assert.deepEqual(issues(st), []);
  st.rows[0].title = ' ';
  st.album.albumArtist = '';
  st.album.year = '19';
  assert.deepEqual(issues(st), ['Year must have four digits.', 'Give the album an artist.', 'Track 1: Title is empty.']);
  st.rows.forEach((r) => { r.include = false; });
  assert.ok(issues(st).includes('Tick at least one track.'));
});

test('payload: album form with selected tracks only', () => {
  const st = playlistState(PV, PV.playlist.url);
  st.rows[1].include = false;
  st.album.year = '2000';
  assert.deepEqual(payload(st), {
    playlistUrl: PV.playlist.url,
    album: { title: 'B', albumArtist: 'A', type: 'EP', year: 2000, genres: ['Techno'], coverUrl: 'https://i/d.jpg', links: { discogs: 'https://www.discogs.com/master/1' } },
    selected: [{ position: 1, videoId: 'aaaaaaaaaaa', title: 'One', durationS: 125, artists: ['A', 'C'], version: 'Dub' }],
  });
});
