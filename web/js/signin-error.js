const REJECTED_CODES = new Set(['invalid_client', 'invalid_request', 'unauthorized_client', 'invalid_redirect_uri', 'redirect_uri_mismatch', 'origin_mismatch']);

export function isRejectedAddress(ex) {
  if (!ex) return false;
  const code = String(ex.error || ex.code || '');
  return REJECTED_CODES.has(code) || /redirect|origin|domain/i.test(String(ex.message || ex.details || ''));
}

export function signInErrorText(provider, ex, origin) {
  if (isRejectedAddress(ex)) {
    return `This address is not registered with ${provider} sign-in yet: ask the owner to add ${origin} to the console.`;
  }
  return `${provider} sign-in failed.`;
}
