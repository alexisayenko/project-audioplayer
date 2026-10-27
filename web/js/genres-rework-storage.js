export const SUB_KEY = 'electrophone.genresSubfamilies';
export function clearSubfamilies(storage) {
  try { storage?.removeItem?.(SUB_KEY); } catch { /* storage unavailable */ }
}
export const RELATED_KEY = 'electrophone.genresRelated';
export const FUSION_KEY = 'electrophone.genresFusion';
export const SELECTED_KEY = 'electrophone.genresV2Selected';
export function loadSelected(storage) {
  try { return storage?.getItem(SELECTED_KEY) || null; } catch { return null; }
}
export function saveSelected(storage, name) {
  try {
    if (name) storage?.setItem(SELECTED_KEY, name);
    else storage?.removeItem(SELECTED_KEY);
  } catch { /* storage unavailable */ }
}
export const loadRelated = (storage) => loadFlag(storage, RELATED_KEY);
export const loadFusion = (storage) => loadFlag(storage, FUSION_KEY);

function loadFlag(storage, key) {
  try { return storage?.getItem(key) === '1'; } catch { return false; }
}
