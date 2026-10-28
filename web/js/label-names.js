export const LABEL_LIMIT = 10;
export const LABEL_LENGTH = 100;

const space = (s) => String(s ?? '').replaceAll(/\s+/g, ' ').trim();

export function cleanLabels(list) {
  const out = [];
  const seen = new Set();
  for (const item of Array.isArray(list) ? list : []) {
    if (typeof item !== 'string') continue;
    const name = space(item).slice(0, LABEL_LENGTH).trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key) || out.length >= LABEL_LIMIT) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

export const labelsOf = (record) => cleanLabels(record?.labels);

export const sameLabels = (a, b) => JSON.stringify(cleanLabels(a)) === JSON.stringify(cleanLabels(b));

export const labelsCaption = (record) => {
  const names = labelsOf(record);
  if (!names.length) return '';
  return `${names.length === 1 ? 'Label' : 'Labels'}: ${names.join(', ')}`;
};
