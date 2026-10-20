export const ROUTE_RE = /^#\/?play\/([^?#]*)(?:\?(.*))?$/;

export const isShareHash = (hash) => ROUTE_RE.test(String(hash ?? ''));
