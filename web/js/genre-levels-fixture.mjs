export const VOCAB = {
  families: ['Electronic', 'Rock'],
  genres: [{ name: 'electronic', level: 'genre' }, { name: 'rock', level: 'genre' }, { name: 'house', level: 'style' }, { name: 'deep house', level: 'style' }],
  aliases: {},
  genre_synonyms: { Electronic: ['edm', 'dance music'], Rock: [] },
  flavours: {
    dark: { name: 'Dark', kind: 'sound', description: 'Menacing, minor-key sound' },
    club: { name: 'Club', kind: 'scene', description: 'Made for the dance floor' },
  },
  levels: {
    house: { genre: 'Electronic', parent: null, also_under: [], discogs: true, synonyms: [], provisional: false },
    'deep house': { genre: 'Electronic', parent: 'house', also_under: [], discogs: true, synonyms: ['deephouse sound'], provisional: false, status: 'question', flavours: ['club'] },
    'afro house': { genre: 'Electronic', parent: 'house', also_under: [], discogs: false, synonyms: [], provisional: false, status: 'approved', flavours: ['club', 'dark', 'ghost'] },
    'drum and bass': { genre: 'Electronic', parent: null, also_under: [], discogs: true, synonyms: ['dnb'], provisional: false },
    breakbeat: { genre: 'Electronic', parent: null, also_under: [], discogs: true, synonyms: [], provisional: false },
    jungle: { genre: 'Electronic', parent: 'drum and bass', also_under: ['breakbeat'], discogs: true, synonyms: [], provisional: false, flavours: ['dark'] },
    'rock and roll': { genre: 'Rock', parent: null, also_under: [], discogs: true, synonyms: [], provisional: true },
  },
};
export const SONGS = [
  { id: 's1', tags: ['genre:deep house', 'genre:house', 'mood:calm'] },
  { id: 's2', tags: ['genre:jungle'] },
  { id: 's3', tags: ['genre:EDM'] },
  { id: 's4', tags: ['genre:afro house', 'genre:deep house'] },
  { id: 's5', tags: ['genre:rock and roll'] },
  { id: 's6', tags: ['genre:unknown thing'] },
];
