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
      { id: 'analyze/rhythm', label: 'Rhythm' },
    ],
  },
  {
    id: 'reference',
    label: 'Reference',
    pages: [{ id: 'glossary', label: 'Glossary' }],
  },
  {
    id: 'help',
    label: 'Help',
    pages: [
      { id: 'help/features', label: 'Features' },
      { id: 'help/help', label: 'Help' },
      { id: 'help/about', label: 'About' },
    ],
  },
];

export const PAGES = GROUPS.flatMap((g) => g.pages.map((p) => ({ ...p, group: g.label, hash: `#/${p.id}` })));
export const DEFAULT_PAGE = 'synthesize/simple';
export const ALIASES = { synthesize: 'synthesize/simple', analyze: 'analyze/listen', 'analyze/bpm': 'analyze/rhythm', help: 'help/features' };

const pathOf = (hash) => String(hash || '').replace(/^#\/?/, '').replace(/\/+$/, '');

const decode = (s) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return '';
  }
};

export const glossaryViewFromHash = (hash) => (/^glossary\/map(\/[^/]+)?$/.test(pathOf(hash)) ? 'map' : 'list');

export const glossaryTermFromHash = (hash) => {
  const m = pathOf(hash).match(/^glossary\/([^/]+)$/);
  return m && m[1] !== 'map' ? decode(m[1]) : '';
};

export const glossaryMapTermFromHash = (hash) => {
  const m = pathOf(hash).match(/^glossary\/map\/([^/]+)$/);
  return m ? decode(m[1]) : '';
};

export const pageFromHash = (hash) => {
  const path = pathOf(hash);
  if (PAGES.some((p) => p.id === path)) return path;
  if (/^glossary\/[^/]+$/.test(path) || /^glossary\/map\/[^/]+$/.test(path)) return 'glossary';
  return Object.hasOwn(ALIASES, path) ? ALIASES[path] : DEFAULT_PAGE;
};
