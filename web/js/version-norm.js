import { splitTokens, joinTokens } from './tokens.js';

const YEAR = String.raw`(?:19|20)\d{2}`;
const CORE = String.raw`(?:digital(?:ly)?[\s-]+)?re[\s-]?master(?:ed)?`;
const REMASTER_SRC = String.raw`(?<![\w-])(?:(?<before>${YEAR})(?:\s+|\s*[,(]\s*))?${CORE}(?:\s*[,(]?\s*(?<after>${YEAR})\)?)?(?:\s+(?:version|edition))?(?![\w-])`;
const REMASTER = new RegExp(REMASTER_SRC, 'gi');
const REMASTER_WHOLE = new RegExp(`^(?:${REMASTER_SRC})$`, 'i');
const PART_SPLIT = /[,;]/;
const WRAPPED = /^[([]([^()[\]]*)[)\]]$/;

const splitParts = (text) => text.split(PART_SPLIT).map((piece, i, all) => {
  const head = i > 0 ? piece.trimStart() : piece;
  return i < all.length - 1 ? head.trimEnd() : head;
});

const canonical = (...args) => {
  const { before, after } = args.at(-1);
  const year = before || after;
  return year ? `${year} remaster` : 'remaster';
};

function part(p) {
  const inner = WRAPPED.exec(p)?.[1].trim();
  const unwrapped = inner && REMASTER_WHOLE.test(inner) ? inner : p;
  return unwrapped.replace(REMASTER, canonical);
}

export function normalizeVersion(text) {
  if (typeof text !== 'string' || !text.trim()) return text;
  const parts = splitTokens(text).flatMap(splitParts).filter(Boolean);
  const out = parts.map(part);
  return out.every((p, i) => p === parts[i]) ? text : joinTokens(out);
}
