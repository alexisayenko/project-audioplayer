const KEY = 'electrophone.sidebarCollapsed';
export const EXPANDED_KEY = 'electrophone.sidebar.expanded';

export function loadCollapsed(storage) {
  try { return storage.getItem(KEY) === '1'; } catch { return false; }
}

export function saveCollapsed(storage, collapsed) {
  try { storage.setItem(KEY, collapsed ? '1' : '0'); return true; } catch { return false; }
}

export function defaultStorage() {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

/** The groups the user opened or closed by hand: { library: true, help: false }; empty when unknown or unreadable. */
export function loadExpanded(storage) {
  try {
    const raw = JSON.parse(storage.getItem(EXPANDED_KEY));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === 'boolean'));
  } catch { return {}; }
}

export function saveExpanded(storage, id, open) {
  try {
    storage.setItem(EXPANDED_KEY, JSON.stringify({ ...loadExpanded(storage), [id]: Boolean(open) }));
    return true;
  } catch { return false; }
}

/** The menu name (data-route) a URL hash belongs to; the default page is the Library. */
export function navNameOfHash(hash) {
  const name = String(hash ?? '').replace(/^#\/?/, '').split('?')[0];
  if (!name || name === 'add') return 'library';
  if (name.startsWith('library/albums/')) return 'library/albums';
  if (name.startsWith('playlists/')) return 'playlists';
  return name;
}

/** The group holding the active route is always open; the others follow what the user left them at. Only the wide rail shows it inline. */
export function resolveExpanded({ ownsActive, remembered, inline }) {
  if (!inline) return false;
  return ownsActive || remembered === true;
}
