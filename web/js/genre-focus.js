let pending = null;
const listeners = new Set();

const onMapRoute = (hash) => /^#?\/?genres2?\/?$/.test(hash || '');

export function takeGenreFocus() {
  const name = pending;
  pending = null;
  return name;
}

export function onGenreFocus(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function showGenreOnMap(name, loc = globalThis.location) {
  pending = name;
  if (onMapRoute(loc?.hash)) {
    for (const fn of [...listeners]) fn();
    return;
  }
  if (loc) loc.hash = '#/genres';
}
