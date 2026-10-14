export const FFT_SIZE = 8192;
export const ANALYSER_SMOOTHING = 0.5;
export const MIN_HZ = 20;
export const MAX_HZ = 16000;
export const BASS_HZ = 150;
export const ATTACK = 0.6;
export const RELEASE = 0.15;
export const NOISE_FLOOR = 0.04;
export const DPR_CAP = 2;
export const FPS_TOUCH = 30;
export const FPS_DESKTOP = 60;
export const IDLE_EPSILON = 0.012;
export const HIDE_CONTROLS_MS = 3000;
export const GRAPH_RESUME_TIMEOUT_MS = 1500;
export const PULSE_MAX_RATE = 4;
export const BG_STORAGE_KEY = 'ap2.viz.bg';
export const BAR_PITCH_PX = 4;
export const BAR_COUNT_MIN = 96;
export const BAR_COUNT_MAX = 480;
export const BAR_WIDTH_FRACTION = 0.6
export const BAR_MIN_CSS = 2;
export const GAP_MIN_CSS = 1;
export const EDGE_FADE = 0.04;
export const HEIGHT_KNEE = 2;
export const HEIGHT_MAX = 0.8;
export const MIRROR_ALPHA = 0.35;
export const BAR_NOISE = 0.18
export const NOISE_STEP_MS = 60;
export const BAR_COMPRESSION = 0.85;
export const QUALITY_LEVELS = [
  { scale: 1, glow: 'full', backdrop: true },
  { scale: 1, glow: 'tight', backdrop: true },
  { scale: 1, glow: 'halo', backdrop: false },
  { scale: 1, glow: 'none', backdrop: false },
];
export const MIN_TURN_S = 1 / 6;
export const VIZ_HEIGHT_SCALE = 1 / 6;
export const HEIGHT_STORAGE_KEY = 'ap2.viz.height';
export const HEIGHT_OPTIONS = [
  { id: 'small', label: 'Small (1/6)', scale: 1 / 6 },
  { id: 'medium', label: 'Medium (1/3)', scale: 1 / 3 },
  { id: 'full', label: 'Full', scale: 1 },
];
export const DEFAULT_HEIGHT = 'small';
export const EDGE_BANDS = 8;
export const VIZ_FPS = 30;
export const VIZ_DPR_CAP = 1.5;
export const GLOW_TIGHT_ALPHA = 0.65;
export const GLOW_WIDE_ALPHA = 0.5;
export const HORIZON_CORE_PX = 3;
export const BACKDROP_RADIUS = 0.28;
export const BACKDROP_ALPHA = 0.25;
export const BACKDROP_SPOKES = 160;
