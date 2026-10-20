const row = (name, family, level, families = [family]) => ({ name, family, families, level, parents: [], extra: false });

export const OTHERS_VOCAB = {
  families: ['Blues', 'Others', 'Rock'],
  family_synonyms: { Blues: [], Others: ['electronic music', 'electronica', 'electronic'], Rock: [] },
  groups: { Others: { kind: 'organisational', temporary: true, order: 2, synonyms: ['electronic music', 'electronica', 'electronic'], members: ['house', 'techno'], assignable: false, note: '', colour: 'Electronic' } },
  forms: {},
  genres: [row('blues', 'Blues', 'family'), row('rock', 'Rock', 'family'), row('house', 'Others', 'genre'), row('techno', 'Others', 'genre'), row('deep house', 'Others', 'genre'), row('rock and roll', 'Rock', 'genre'), row('edm', 'Others', 'genre')],
  aliases: { 'dance music': 'edm', 'electronic dance music': 'edm' },
  modifiers: {},
  subfamilies: [{ family: 'Others', name: 'House', order: 1 }, { family: 'Others', name: 'Techno', order: 2 }],
  levels: {
    house: { parents: ['Others'], discogs: true, synonyms: [], provisional: false, subfamily: 'House' },
    'deep house': { parents: ['house'], discogs: true, synonyms: [], provisional: false, subfamily: 'House' },
    techno: { parents: ['Others'], discogs: true, synonyms: [], provisional: false, subfamily: 'Techno' },
    edm: { parents: ['Others'], discogs: false, synonyms: [], provisional: false, status: 'approved' },
    'rock and roll': { parents: ['Rock'], discogs: true, synonyms: [], provisional: false },
  },
};

export const OTHERS_SONGS = [
  { id: 'a', tags: ['genre:house', 'genre:electronic'] },
  { id: 'b', tags: ['genre:electronic'] },
  { id: 'c', tags: ['genre:deep house', 'genre:rock and roll'] },
  { id: 'd', tags: ['genre:techno'] },
];

export function promote(vocab, name, form = {}) {
  const { [name]: node, ...levels } = vocab.levels;
  const at = vocab.families.indexOf('Others') + 1;
  const families = [...vocab.families.slice(0, at), name, ...vocab.families.slice(at)];
  const genres = vocab.genres.map((g) => (g.name === name ? { ...g, level: 'family', family: name, families: [name] } : g));
  return {
    ...vocab, families, genres, levels,
    forms: { ...vocab.forms, [name]: { level: 1, parents: [], discogs: node.discogs, synonyms: node.synonyms, provisional: false, status: null, display: null, modifiers: [], form: true, colour: 'Others', families: [name], ...form } },
  };
}
