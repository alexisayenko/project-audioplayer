const GB = 1024 ** 3;
const MB = 1024 ** 2;

export function fmtBytes(n) {
  if (n >= GB) return `${(n / GB).toFixed(n >= 10 * GB ? 0 : 1)} GB`;
  if (n >= MB) return `${Math.round(n / MB)} MB`;
  return `${Math.round(n / 1024)} KB`;
}

export function usageText(u) {
  const songs = u.max_songs == null ? `${u.songs} songs` : `${u.songs} / ${u.max_songs} songs`;
  const size = u.max_bytes == null ? fmtBytes(u.bytes) : `${fmtBytes(u.bytes)} / ${fmtBytes(u.max_bytes)}`;
  return `${songs} · ${size}`;
}

export function friendly(code, data, fallback) {
  const d = data || {};
  switch (code) {
    case 'hourly_limit': {
      const m = Math.max(1, Number(d.retry_after_minutes) || 1);
      return `Hourly limit reached. Try again in ${m} ${m === 1 ? 'minute' : 'minutes'}.`;
    }
    case 'import_limit': {
      const m = Math.max(1, Number(d.retry_after_minutes) || 1);
      return `Playlist import limit reached. Try again in ${m} ${m === 1 ? 'minute' : 'minutes'}.`;
    }
    case 'draft_limit': {
      const m = Math.max(1, Number(d.retry_after_minutes) || 1);
      return `Draft lookup limit reached. Try again in ${m} ${m === 1 ? 'minute' : 'minutes'}.`;
    }
    case 'library_full_songs': return 'Your library is full. Delete some songs to add more.';
    case 'library_full_bytes': return 'Your storage is full. Delete some songs to free space.';
    case 'server_full': return 'The server is out of storage right now. Try again later.';
    case 'signup_closed': return 'Sign-up is closed on this server.';
    case 'guest_limit': {
      const m = Math.max(1, Number(d.retry_after_minutes) || 1);
      return `Guest limit reached. Sign in or try again in ${m} min`;
    }
    case 'guest_audio_disabled': return 'Audio is not available to guests. Sign in to listen.';
    case 'guest_download_disabled': return 'Guests cannot download files.';
    default: return fallback;
  }
}
