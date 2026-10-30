// Breakpoints (px); style.css and genres.css repeat these in their media queries:
//   480  phone -> small tablet: wider gutter, rail 64px, mini-player grows
//   640  mini-player shows the extra options
//   720  wide: rail 220px, table layout, genres outline docks beside the stage
//   900  Playback page gets its two-column layout
//   1100 outline opens by default and the stage insets
export const BP_WIDE = 720;
export const BP_DESKTOP = 1100;

export const MIN_YEAR = 1900;
export const maxYear = (now = new Date()) => now.getFullYear() + 1;

export const TOAST_MS = 3000;
export const TOAST_ACTION_MS = 6000;
export const SYNC_POLL_MS = 30000;
export const LIBRARY_FRESH_MS = 15000;
export const ROW_FLASH_MS = 1500;
export const COVER_FLASH_MS = 1200;
export const ADD_ROW_OUTLINE_MS = 2500;
export const MENU_EDGE = 8;
export const MENU_GAP = 4;
export const GENRES_OUTLINE_INSET = 340;
export const TOUCH_HOLD_MS = 250;
export const TOUCH_SLOP_PX = 10;
export const CLICK_SWALLOW_MS = 400;
export const VIBRATE_MS = 10;

export const LONG_SONG_SECONDS = 720;
export const EAGER_COVERS = 12;
export const PREFETCH_BATCH = 6;
export const PREFETCH_COVER_WAIT_MS = 4000;
export const PREFETCH_BATCH_WAIT_MS = 2500;
export const PREFETCH_IDLE_MS = 1500;
export const PREFETCH_RESUME_MS = 600;

/** Waits before each reload of a media source that failed to load; the sum (about 31 s) is the whole retry window, long enough for a server restart. */
export const MEDIA_RETRY_DELAYS_MS = [500, 1000, 1500, 2000, 3000, 4000, 5000, 6000, 8000];

export const ORDER_SEND_MS = 700;
export const DRAG_EDGE_PX = 80;
export const DRAG_SCROLL_PX = 18;
