// Which controls the right-hand cell of a Library row shows. `ring` is the progress model (or null when no fetch is active).
export function rowActions({ audio, link, ring }) {
  if (audio) return { ring: false, source: false, download: false };
  if (ring) return { ring: true, source: false, download: false };
  return { ring: false, source: !!link, download: true };
}
