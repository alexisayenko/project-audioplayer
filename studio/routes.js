export const DEFAULT_TAB = 'analyze';
export const TABS = [
  { id: 'analyze', label: 'Analyze', hash: '#/analyze' },
  { id: 'synthesize', label: 'Synthesize', hash: '#/synthesize' },
];

export const tabFromHash = (hash) => {
  const m = /^#\/?(analyze|synthesize)$/.exec(hash || '');
  return m ? m[1] : DEFAULT_TAB;
};
