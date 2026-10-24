import { hasLevels } from './genre-levels.js';
import { adaptGenresV2, hasStructure } from './genres-v2-adapter.js';

export const settledValue = (result) => (result.status === 'fulfilled' ? result.value : null);

export function adaptVocab(v2, raw) {
  if (!v2) return raw;
  return hasStructure(raw) ? adaptGenresV2(raw) : null;
}

const vocabMissing = (v2, vocab) => (v2 ? !vocab : !hasLevels(vocab));

export const loadFailed = (v2, vocab, library) => vocabMissing(v2, vocab) || library.status !== 'fulfilled';
