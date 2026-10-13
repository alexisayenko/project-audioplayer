import { splitTag, valueLabel } from './tagname.js';

export function genreText(tags) {
  return (tags || [])
    .map(splitTag)
    .filter((t) => t.key.toLowerCase() === 'genre' && t.value.trim())
    .map((t) => valueLabel('genre', t.value))
    .join(', ');
}
