export const FUSION_VOCAB = {
  families: ['Blues', 'Electronic', 'Funk / Soul', 'Rock'], genres: [], aliases: {}, family_synonyms: {}, modifiers: {},
  levels: {
    'blues rock': { parents: ['Blues', 'Rock'], discogs: true, fusion: true },
    'hard blues rock': { parents: ['blues rock'], discogs: true },
    disco: { parents: ['Funk / Soul', 'Electronic'], discogs: true },
    house: { parents: ['Electronic'], discogs: true },
  },
};
export const FUSION_SONGS = [{ id: '1', tags: ['genre:blues rock'] }, { id: '2', tags: ['genre:disco'] }, { id: '3', tags: ['genre:hard blues rock'] }];
