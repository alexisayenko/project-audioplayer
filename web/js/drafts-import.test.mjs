import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  stripNoise, cleanChannel, splitVideoTitle, videoIdOf, playlistLinkOf, classify, hasPlaylist, entryLine, existingVideoIds, playlistError, runImport, summarizeImport,
} from './drafts-import.js';

const id11 = (n) => `vid${String(n).padStart(8, '0')}`;
const entry = (n, extra = {}) => ({ id: id11(n), title: `Artist - Song ${n}`, channel: 'Chan', duration: 200, url: `https://www.youtube.com/watch?v=${id11(n)}`, available: true, ...extra });
const PL = 'https://youtube.com/playlist?list=PL1';

test('noise suffixes are stripped, version words stay', () => {
  assert.equal(stripNoise('Song (Official Video)'), 'Song');
  assert.equal(stripNoise('Song [Official Music Video]'), 'Song');
  assert.equal(stripNoise('Song (Official Audio)'), 'Song');
  assert.equal(stripNoise('Song (Lyrics)'), 'Song');
  assert.equal(stripNoise('Song HD'), 'Song');
  assert.equal(stripNoise('Song (Remix)'), 'Song (Remix)');
  assert.equal(stripNoise('Song (Live at Wembley)'), 'Song (Live at Wembley)');
  assert.equal(stripNoise('Song (2011 Remaster)'), 'Song (2011 Remaster)');
  assert.equal(stripNoise('Song (Cover)'), 'Song (Cover)');
});

test('Artist - Title splits at the first " - " only', () => {
  assert.deepEqual(splitVideoTitle('Daft Punk - One More Time (Official Video)', 'Daft Punk'), { artist: 'Daft Punk', title: 'One More Time' });
  assert.deepEqual(splitVideoTitle('A - B - C', 'x'), { artist: 'A', title: 'B - C' });
  assert.deepEqual(splitVideoTitle('A - Song (Club Remix) [Official Audio]', 'x'), { artist: 'A', title: 'Song (Club Remix)' });
});

test('without " - " the title stays and the channel is the artist, minus Topic and VEVO', () => {
  assert.deepEqual(splitVideoTitle('Bohemian Rhapsody', 'Queen - Topic'), { artist: 'Queen', title: 'Bohemian Rhapsody' });
  assert.deepEqual(splitVideoTitle('Song (Official Video)', 'ArtistVEVO'), { artist: 'Artist', title: 'Song' });
  assert.deepEqual(splitVideoTitle('Song', null), { artist: '', title: 'Song' });
  assert.equal(cleanChannel('Some Artist - Topic'), 'Some Artist');
});

test('playlist links are found in a line; mixes and plain video links are not playlists', () => {
  assert.equal(playlistLinkOf('https://www.youtube.com/playlist?list=PLabc123').id, 'PLabc123');
  assert.equal(playlistLinkOf('see https://music.youtube.com/watch?v=dQw4w9WgXcQ&list=PLabc123 now').id, 'PLabc123');
  assert.equal(playlistLinkOf('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=RDdQw4w9WgXcQ'), null);
  assert.equal(playlistLinkOf('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(playlistLinkOf('Artist - Title'), null);
  assert.equal(hasPlaylist(['a', PL]), true);
});

test('classify keeps the order and reads a repeated playlist once', () => {
  const video = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
  const out = classify(['A - B', PL, video, PL, 'https://youtube.com/playlist?list=PL2']);
  assert.deepEqual(out.map((i) => (i.kind === 'line' ? i.line : i.id)), ['A - B', 'PL1', video, 'PL2']);
});

test('videoIdOf reads watch and short links', () => {
  assert.equal(videoIdOf('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=x'), 'dQw4w9WgXcQ');
  assert.equal(videoIdOf('https://youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(videoIdOf('https://soundcloud.com/a/b'), '');
});

test('an entry line is "Artist - Title <link>" and fits the line limit', () => {
  const url = 'https://www.youtube.com/watch?v=abcdefghijk';
  assert.equal(entryLine({ id: 'abcdefghijk', url, title: 'Daft Punk - One More Time (Official Video)', channel: 'x' }), `Daft Punk - One More Time ${url}`);
  assert.ok(entryLine({ id: 'abcdefghijk', url, title: 'x'.repeat(900), channel: 'c' }).length <= 300);
});

test('existing ids come from the drafts links and the YouTube songs of the Library', () => {
  const ids = existingVideoIds({ drafts: [{ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }, { url: '' }], songs: [{ id: 'abcdefghijk' }, { id: 'soundcloud-123' }] });
  assert.deepEqual([...ids].sort(), ['abcdefghijk', 'dQw4w9WgXcQ']);
});

test('playlist errors become friendly messages', () => {
  assert.equal(playlistError({ status: 422, code: 'playlist_unavailable' }), 'This playlist is private or not available.');
  assert.equal(playlistError({ status: 502 }), 'Could not read the playlist. Try again.');
  assert.equal(playlistError({ status: 0 }), 'Could not read the playlist. Try again.');
});

test('runImport skips unavailable entries and known ids, adds in chunks of 10 in order and reports progress', async () => {
  const entries = Array.from({ length: 25 }, (_, i) => entry(i));
  entries[3].available = false;
  const batches = [];
  const progress = [];
  const r = await runImport({
    lines: [PL],
    fetchPlaylist: async () => ({ entries, truncated: false, skipped: 1 }),
    addLines: async (part) => { batches.push(part); return { counts: { created: part.length } }; },
    ids: new Set([id11(0)]),
    onProgress: (p) => progress.push(`${p.phase}:${p.done}/${p.total}`),
  });
  assert.deepEqual(batches.map((b) => b.length), [10, 10, 3]);
  assert.equal(r.added, 23);
  assert.equal(r.duplicates, 1);
  assert.equal(r.unavailable, 2);
  assert.deepEqual(progress, ['reading:0/0', 'adding:0/23', 'adding:10/23', 'adding:20/23', 'adding:23/23']);
  assert.equal(summarizeImport(r), 'Added 23, skipped 1 already in your Drafts or Library, 2 unavailable.');
});

test('plain lines and a playlist are processed in order of appearance', async () => {
  const sent = [];
  await runImport({
    lines: ['First - Song', PL, 'Last - Song'],
    fetchPlaylist: async () => ({ entries: [entry(1)] }),
    addLines: async (part) => { sent.push(...part); return { counts: { created: part.length } }; },
  });
  assert.deepEqual(sent.map((l) => l.split(' https')[0]), ['First - Song', 'Last - Song', 'Artist - Song 1']);
});

test('cancel stops cleanly after the current chunk and keeps what was added', async () => {
  const entries = Array.from({ length: 30 }, (_, i) => entry(i));
  let cancelled = false;
  const r = await runImport({
    lines: [PL],
    fetchPlaylist: async () => ({ entries }),
    addLines: async (part) => { cancelled = true; return { counts: { created: part.length } }; },
    isCancelled: () => cancelled,
  });
  assert.equal(r.cancelled, true);
  assert.equal(r.added, 10);
  assert.match(summarizeImport(r), /Cancelled after 10 of 30: the 10 added drafts are kept\./);
});

test('a failing playlist is reported and the other lines still go in', async () => {
  const r = await runImport({
    lines: ['Plain - Song', PL],
    fetchPlaylist: async () => { throw Object.assign(new Error('x'), { status: 422 }); },
    addLines: async (part) => ({ counts: { created: part.length } }),
  });
  assert.equal(r.added, 1);
  assert.match(summarizeImport(r), /This playlist is private or not available\./);
});

test('a failing save stops the import and keeps the earlier chunks', async () => {
  let calls = 0;
  const r = await runImport({
    lines: Array.from({ length: 12 }, (_, i) => `A - ${i}`).concat(PL),
    fetchPlaylist: async () => ({ entries: [] }),
    addLines: async (part) => {
      calls += 1;
      if (calls > 1) throw new Error('Server unreachable');
      return { counts: { created: part.length } };
    },
  });
  assert.equal(r.added, 10);
  assert.match(summarizeImport(r), /Stopped after 10 of 12: Server unreachable/);
});

test('a truncated playlist says so; an unreadable one skips the "Added 0" sentence', async () => {
  const t = await runImport({ lines: [PL], fetchPlaylist: async () => ({ entries: [entry(1)], truncated: true }), addLines: async () => ({ counts: { created: 1 } }) });
  assert.match(summarizeImport(t), /more than 500 videos: only the first 500 were read/);
  const e = await runImport({ lines: [PL], fetchPlaylist: async () => { throw new Error('x'); }, addLines: async () => ({}) });
  assert.equal(summarizeImport(e), 'Could not read the playlist. Try again.');
});
