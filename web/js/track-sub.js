export function trackSub(song) {
  const artist = String(song?.artist ?? '').trim();
  const year = String(song?.year ?? '').trim();
  return [artist, year].filter(Boolean).join(' · ');
}
