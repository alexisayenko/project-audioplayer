export const DEFAULT_PAGE = 'synthesize';
export const PAGES = [
  { id: 'synthesize', label: 'Synthesize', hash: '#/synthesize' },
  { id: 'analyze', label: 'Analyze', hash: '#/analyze' },
];

export const pageFromHash = (hash) => {
  const m = /^#\/?(analyze|synthesize)$/.exec(hash || '');
  return m ? m[1] : DEFAULT_PAGE;
};
