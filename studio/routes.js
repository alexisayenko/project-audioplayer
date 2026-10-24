export const GROUPS = [
  {
    id: 'synthesize',
    label: 'Synthesize',
    pages: [
      { id: 'synthesize/simple', label: 'Primitive' },
      { id: 'synthesize/chordophones', label: 'Chordophones' },
      { id: 'synthesize/aerophones', label: 'Aerophones' },
      { id: 'synthesize/membranophones', label: 'Membranophones' },
      { id: 'synthesize/idiophones', label: 'Idiophones' },
    ],
  },
  {
    id: 'analyze',
    label: 'Analyze',
    pages: [{ id: 'analyze/bpm', label: 'Live BPM' }],
  },
];

export const PAGES = GROUPS.flatMap((g) => g.pages.map((p) => ({ ...p, group: g.label, hash: `#/${p.id}` })));
export const DEFAULT_PAGE = 'synthesize/simple';
export const ALIASES = { synthesize: 'synthesize/simple', analyze: 'analyze/bpm' };

export const pageFromHash = (hash) => {
  const path = String(hash || '').replace(/^#\/?/, '').replace(/\/+$/, '');
  if (PAGES.some((p) => p.id === path)) return path;
  return Object.hasOwn(ALIASES, path) ? ALIASES[path] : DEFAULT_PAGE;
};
