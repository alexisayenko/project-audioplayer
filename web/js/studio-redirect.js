export const STUDIO_SITE = 'https://studio.electrophone.cc/';
export const STUDIO_LINK_TEXT = 'Studio tools: analyze and synthesize sound →';

const MOVED = [
  [/^#\/?studio\/(?:tools|analyze)\/?$/i, `${STUDIO_SITE}#/analyze`],
  [/^#\/?studio\/(?:simple|synthesize)\/?$/i, `${STUDIO_SITE}#/synthesize`],
];

export function studioSiteUrl(hash) {
  for (const [pattern, url] of MOVED) if (pattern.test(hash || '')) return url;
  return null;
}
