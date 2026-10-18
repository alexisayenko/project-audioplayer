import { api } from './api.js';
import { hasLevels, buildTree } from './genre-levels.js';

let cached = null;
let loading = null;

export const cachedTree = () => cached;

export function loadGenreTree() {
  if (cached) return Promise.resolve(cached);
  if (!loading) {
    loading = api.genreVocabulary().then((vocab) => {
      if (hasLevels(vocab)) cached = buildTree(vocab);
      return cached;
    }).catch(() => null).finally(() => { loading = null; });
  }
  return loading;
}

export function resetGenreTree(tree = null) {
  cached = tree;
  loading = null;
}
