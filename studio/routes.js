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
    pages: [
      { id: 'analyze/listen', label: 'Listen' },
      { id: 'analyze/bpm', label: 'Live BPM' },
    ],
  },
  {
    id: 'reference',
    label: 'Reference',
    pages: [{ id: 'glossary', label: 'Glossary' }],
  },
];

export const PAGES = GROUPS.flatMap((g) => g.pages.map((p) => ({ ...p, group: g.label, hash: `#/${p.id}` })));
export const DEFAULT_PAGE = 'synthesize/simple';
export const ALIASES = { synthesize: 'synthesize/simple', analyze: 'analyze/listen' };

const pathOf = (hash) => String(hash || '').replace(/^#\/?/, '').replace(/\/+$/, '');

export const glossaryTermFromHash = (hash) => {
  const m = pathOf(hash).match(/^glossary\/([^/]+)$/);
  if (!m) return '';
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return '';
  }
};

export const pageFromHash = (hash) => {
  const path = pathOf(hash);
  if (PAGES.some((p) => p.id === path)) return path;
  if (/^glossary\/[^/]+$/.test(path)) return 'glossary';
  return Object.hasOwn(ALIASES, path) ? ALIASES[path] : DEFAULT_PAGE;
};
