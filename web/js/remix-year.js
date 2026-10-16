import { MIN_YEAR, maxYear } from './constants.js';

export const validYear = (v) => (Number.isInteger(v) && v >= MIN_YEAR && v <= maxYear() ? v : null);

export function planVersionYear({ kind, current, auto, published, specific }) {
  const text = String(current ?? '').trim();
  const keep = { value: text, auto };
  if (text !== '' && !auto) return keep;
  if (String(kind ?? '').trim() === '') return auto ? { value: '', auto: false } : keep;
  const found = validYear(specific) ?? validYear(published);
  if (found == null) return auto ? { value: '', auto: false } : keep;
  return { value: String(found), auto: true };
}

export const planRemixYear = ({ remixer, ...rest }) => planVersionYear({ ...rest, kind: String(remixer ?? '').trim() ? 'remix' : '' });
