import { makeTimelineBuilder } from './viz-timeline.js';

const CHUNK_ROWS = 64;

self.onmessage = (e) => {
  const m = e.data;
  if (m?.type !== 'build') return;
  try {
    const b = makeTimelineBuilder({ pcm: m.pcm, sampleRate: m.sampleRate, bands: m.bands, bins: m.bins, rps: m.rps });
    while (b.done < b.total) {
      const r = b.step(CHUNK_ROWS);
      const copy = b.data.slice(r.from * b.bins, r.to * b.bins);
      self.postMessage({ type: 'rows', from: r.from, data: copy.buffer }, [copy.buffer]);
    }
    self.postMessage({ type: 'done' });
  } catch (err) {
    self.postMessage({ type: 'error', message: String(err?.message || err) });
  }
};
