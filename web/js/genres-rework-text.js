export function failureText(v, vocab) {
  if (v.status === 'rejected') return 'Genres structure unavailable';
  if (!vocab) return 'Genres structure is empty: the server has no genres in it yet';
  return 'Library unavailable: song counts are needed to show genres';
}
