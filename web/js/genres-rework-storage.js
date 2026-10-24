export const LEGEND_KEY = 'electrophone.genresLegend';
export const VIEW_KEY = 'electrophone.genresView';
export const VIEWS = ['graph', 'radial'];
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
export const saveRelated = (storage, on) => saveFlag(storage, RELATED_KEY, on);
export const loadFusion = (storage) => loadFlag(storage, FUSION_KEY);
export const saveFusion = (storage, on) => saveFlag(storage, FUSION_KEY, on);

export function loadView(storage) {
  try {
    const v = storage?.getItem(VIEW_KEY);
    return VIEWS.includes(v) ? v : 'graph';
  } catch { return 'graph'; }
}

export function saveView(storage, v) {
  try { storage?.setItem(VIEW_KEY, v); } catch { /* storage unavailable */ }
}

function loadFlag(storage, key) {
  try { return storage?.getItem(key) === '1'; } catch { return false; }
}

function saveFlag(storage, key, on) {
  try { storage?.setItem(key, on ? '1' : '0'); } catch { /* storage unavailable */ }
}

export const loadLegend = (storage) => loadFlag(storage, LEGEND_KEY);
export const saveLegend = (storage, on) => saveFlag(storage, LEGEND_KEY, on);

export function initialKind(v2, opts, storage) {
  if (v2) return 'graph';
  return VIEWS.includes(opts?.view) ? opts.view : loadView(storage);
}
