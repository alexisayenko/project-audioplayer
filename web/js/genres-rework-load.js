import { adaptGenresV2, hasStructure } from './genres-v2-adapter.js';

export const settledValue = (result) => (result.status === 'fulfilled' ? result.value : null);

export const adaptVocab = (raw) => (hasStructure(raw) ? adaptGenresV2(raw) : null);
