const KEY = 'electrophone.sidebarCollapsed';

export function loadCollapsed(storage) {
  try { return storage.getItem(KEY) === '1'; } catch { return false; }
}

export function saveCollapsed(storage, collapsed) {
  try { storage.setItem(KEY, collapsed ? '1' : '0'); return true; } catch { return false; }
}
