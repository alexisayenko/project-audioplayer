export function storeGet(key, fallback = null) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v;
  } catch { return fallback; }
}

export function storeSet(key, value) {
  try { localStorage.setItem(key, value); return true; } catch { return false; }
}

export function storeRemove(key) {
  try { localStorage.removeItem(key); } catch { /* storage unavailable */ }
}
