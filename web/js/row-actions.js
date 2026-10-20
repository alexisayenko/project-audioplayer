import { can } from './guest.js';
// Which fetch control a Library row shows at the end of its subtitle line. `ring` is the progress model (or null when no fetch is active).
export function rowActions({ audio, ring }) {
  if (audio) return { ring: false, download: false };
  if (ring) return { ring: true, download: false };
  return { ring: false, download: can('fetch') };
}
