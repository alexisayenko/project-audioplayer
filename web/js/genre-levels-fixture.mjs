export const VOCAB = {
  families: ['Electronic', 'Rock'],
  genres: [{ name: 'electronic', level: 'family' }, { name: 'rock', level: 'family' }, { name: 'house', level: 'genre' }, { name: 'deep house', level: 'genre' }],
  aliases: {},
  family_synonyms: { Electronic: ['edm', 'dance music'], Rock: [] },
  modifiers: {
    dark: { name: 'Dark', kind: 'mood', description: 'Menacing, minor-key sound' },
    club: { name: 'Club', kind: 'scene', description: 'Made for the dance floor' },
  },
  levels: {
    house: { parents: ['Electronic'], discogs: true, synonyms: [], provisional: false },
    'deep house': { parents: ['house'], discogs: true, synonyms: ['deephouse sound'], provisional: false, status: 'question', modifiers: ['club'] },
    'afro house': { parents: ['house'], discogs: false, synonyms: [], provisional: false, status: 'approved', modifiers: ['club', 'dark', 'ghost'] },
    'drum and bass': { parents: ['Electronic'], discogs: true, synonyms: ['dnb'], provisional: false },
    breakbeat: { parents: ['Electronic'], discogs: true, synonyms: [], provisional: false },
    jungle: { parents: ['drum and bass', 'breakbeat'], discogs: true, synonyms: [], provisional: false, modifiers: ['dark'] },
    'rock and roll': { parents: ['Rock'], discogs: true, synonyms: [], provisional: true },
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
