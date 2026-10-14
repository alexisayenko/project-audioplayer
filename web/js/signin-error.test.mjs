import test from 'node:test';
import assert from 'node:assert/strict';
import { signInErrorText, isRejectedAddress, HOME_ORIGIN } from './signin-error.js';

test('provider rejection of the address names the origin and the fallback', () => {
  const t = signInErrorText('Apple', { error: 'invalid_client' }, 'https://electrophone.cc');
  assert.match(t, /not registered with Apple sign-in/);
  assert.ok(t.includes(HOME_ORIGIN) && t.includes('https://electrophone.cc'));
});

test('message mentioning redirect or origin counts as rejected', () => {
  assert.ok(isRejectedAddress(new Error('Invalid redirect_uri')));
  assert.ok(isRejectedAddress({ message: 'origin not allowed' }));
});

test('other errors stay generic', () => {
  assert.equal(signInErrorText('Google', { error: 'network' }, 'https://x'), 'Google sign-in failed.');
  assert.equal(isRejectedAddress(null), false);
  assert.equal(isRejectedAddress({}), false);
});
