import { splitTokens, joinTokens } from './tokens.js';

const YEAR = String.raw`(?:19|20)\d{2}`;
const CORE = String.raw`(?:digital(?:ly)?[\s-]+)?re[\s-]?master(?:ed)?`;
const REMASTER_SRC = String.raw`(?<![\w-])(?:(?<before>${YEAR})(?:\s+|\s*[,(]\s*))?${CORE}(?:\s*[,(]?\s*(?<after>${YEAR})\)?)?(?:\s+(?:version|edition))?(?![\w-])`;
const REMASTER = new RegExp(REMASTER_SRC, 'gi');
const REMASTER_WHOLE = new RegExp(`^(?:${REMASTER_SRC})$`, 'i');
const PART_SPLIT = /\s*[,;]\s*/;
const WRAPPED = /^[(\[]\s*([^()[\]]+?)\s*[)\]]$/;

const canonical = (...args) => {
  const { before, after } = args.at(-1);
  const year = before || after;
  return year ? `${year} remaster` : 'remaster';
};

function part(p) {
  const wrapped = WRAPPED.exec(p);
  const unwrapped = wrapped && REMASTER_WHOLE.test(wrapped[1]) ? wrapped[1] : p;
  return unwrapped.replace(REMASTER, canonical);
}

export function normalizeVersion(text) {
  if (typeof text !== 'string' || !text.trim()) return text;
  const parts = splitTokens(text).flatMap((t) => t.split(PART_SPLIT)).filter(Boolean);
  const out = parts.map(part);
  return out.every((p, i) => p === parts[i]) ? text : joinTokens(out);
}
