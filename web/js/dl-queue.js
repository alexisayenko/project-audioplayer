// Pure state machine for the background audio downloads (Settings: Auto-download songs).
// state: { jobs: [{ id, status: 'queued' | 'downloading' | 'failed', progress, error }], pausedUntil: ms }

export const empty = () => ({ jobs: [], pausedUntil: 0 });

const find = (s, id) => s.jobs.find((j) => j.id === id);
const patch = (s, id, change) => ({ ...s, jobs: s.jobs.map((j) => (j.id === id ? { ...j, ...change } : j)) });

// New ids join as queued (front puts them ahead of other queued jobs); known ids, failed ones included, are left alone.
export function enqueue(s, ids, front = false) {
  const fresh = [...new Set(ids)].filter((id) => !find(s, id)).map((id) => ({ id, status: 'queued', progress: 0, error: '' }));
  if (!fresh.length) return s;
  if (!front) return { ...s, jobs: [...s.jobs, ...fresh] };
  const active = s.jobs.filter((j) => j.status === 'downloading');
  return { ...s, jobs: [...active, ...fresh, ...s.jobs.filter((j) => j.status !== 'downloading')] };
}

// Moves an already-known queued job to the head of the line.
export function prioritize(s, id) {
  const j = find(s, id);
  if (!j || j.status !== 'queued') return s;
  const active = s.jobs.filter((x) => x.status === 'downloading');
  return { ...s, jobs: [...active, j, ...s.jobs.filter((x) => x !== j && x.status !== 'downloading')] };
}

// Forgets queued and failed jobs whose song left the playlist; a running download is never dropped.
export function prune(s, keepIds) {
  const keep = new Set(keepIds);
  const jobs = s.jobs.filter((j) => j.status === 'downloading' || keep.has(j.id));
  return jobs.length === s.jobs.length ? s : { ...s, jobs };
}

export const retry = (s, id) => {
  const j = find(s, id);
  return j && j.status === 'failed' ? patch(s, id, { status: 'queued', progress: 0, error: '' }) : s;
};

export const active = (s) => s.jobs.filter((j) => j.status === 'downloading').length;

export const pausedFor = (s, now) => Math.max(0, s.pausedUntil - now);

// Ids to start now: queued jobs in order, up to `max` running at once, nothing while the hourly limit pause lasts.
export function startable(s, now, max = 1) {
  if (pausedFor(s, now) > 0) return [];
  const room = Math.max(0, max - active(s));
  return s.jobs.filter((j) => j.status === 'queued').slice(0, room).map((j) => j.id);
}

export const started = (s, id) => patch(s, id, { status: 'downloading', progress: 0 });
export const progress = (s, id, p) => patch(s, id, { progress: Math.max(0, Math.min(1, Number(p) || 0)) });
export const done = (s, id) => ({ ...s, jobs: s.jobs.filter((j) => j.id !== id) });
export const failed = (s, id, error) => patch(s, id, { status: 'failed', error: error || 'Download failed' });

// The hourly add limit answered: the job goes back to the head of the queue and everything waits `minutes`.
export function limited(s, id, now, minutes) {
  const wait = Math.max(1, Number(minutes) || 1) * 60000;
  const back = patch(s, id, { status: 'queued', progress: 0 });
  return { ...prioritize(back, id), pausedUntil: now + wait };
}

export const resume = (s, now) => (s.pausedUntil && s.pausedUntil <= now ? { ...s, pausedUntil: 0 } : s);

export const minutesLeft = (s, now) => Math.ceil(pausedFor(s, now) / 60000);

// What the UI shows for one song: { kind: 'none' | 'queued' | 'downloading' | 'failed' | 'paused', progress, error, minutes }.
export function view(s, id, now) {
  const j = find(s, id);
  if (!j) return { kind: 'none', progress: 0, error: '', minutes: 0 };
  if (j.status === 'queued' && pausedFor(s, now) > 0) return { kind: 'paused', progress: 0, error: '', minutes: minutesLeft(s, now) };
  return { kind: j.status, progress: j.progress, error: j.error, minutes: 0 };
}

// Poll delay after n unchanged polls: 1s, 2s, 3s, 5s, then every 5s.
export const backoff = (n) => [1000, 2000, 3000, 5000][Math.min(n, 3)];
