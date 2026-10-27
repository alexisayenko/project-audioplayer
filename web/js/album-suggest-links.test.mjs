import { test } from 'node:test';
import assert from 'node:assert/strict';
import { installPage } from './test-dom.mjs';

await installPage();
const { albumFields } = await import('./album-form.js');

const tick = () => new Promise((r) => setTimeout(r, 0));
const editor = { commit() {}, get: () => [], addTags() {}, node: document.createElement('div') };

function setup(answer, links = {}) {
  const seen = [];
  const lookup = async (body) => {
    seen.push(body);
    if (answer instanceof Error) throw answer;
    return answer;
  };
  const form = albumFields({ title: 'Twisted', artist: 'Hallucinogen', year: '1995', type: 'album', genres: editor, links, linksId: 'x', lookup });
  return { form, seen, btn: form.suggest.btn, status: form.suggest.status };
}

test('the Links bar has an icon button Suggest links with tooltip and aria-label, and a polite status line', () => {
  const { form, btn, status } = setup({});
  assert.equal(btn.getAttribute('aria-label'), 'Suggest links');
  assert.equal(btn.title, 'Suggest links');
  assert.ok(form.links.panel.bar.contains(btn));
  assert.equal(status.getAttribute('aria-live'), 'polite');
});

test('it sends the artist, title and year and fills only the empty link fields', async () => {
  const { form, seen, btn, status } = setup({ discogs: 'https://www.discogs.com/master/1', wikipedia: 'https://en.wikipedia.org/wiki/Twisted_(album)' }, { wikipedia: 'https://en.wikipedia.org/wiki/Mine' });
  let inputs = 0;
  form.links.inputs.discogs.addEventListener('input', () => { inputs += 1; });
  btn.click();
  assert.equal(btn.disabled, true);
  assert.equal(status.textContent, 'Looking for links...');
  await tick();
  assert.deepEqual(seen, [{ artist: 'Hallucinogen', title: 'Twisted', year: 1995 }]);
  assert.equal(form.links.inputs.discogs.value, 'https://www.discogs.com/master/1');
  assert.equal(form.links.inputs.wikipedia.value, 'https://en.wikipedia.org/wiki/Mine');
  assert.equal(inputs, 1);
  assert.equal(status.textContent, 'Found Discogs.');
  assert.equal(btn.disabled, false);
});

test('both found, nothing found, Discogs not configured, and failures are said in the status only', async () => {
  let r = setup({ discogs: 'https://www.discogs.com/release/2', wikipedia: 'https://en.wikipedia.org/wiki/T' });
  r.btn.click();
  await tick();
  assert.equal(r.status.textContent, 'Found Discogs and Wikipedia.');
  r = setup({ discogs: null, wikipedia: null, searchError: null });
  r.btn.click();
  await tick();
  assert.equal(r.status.textContent, 'Nothing found.');
  r = setup({ discogs: null, wikipedia: null, searchError: 'discogs_unavailable' });
  r.btn.click();
  await tick();
  assert.match(r.status.textContent, /Discogs is not configured/);
  r = setup(new Error('down'));
  r.btn.click();
  await tick();
  assert.equal(r.status.textContent, 'Nothing found.');
  assert.equal(r.form.links.inputs.discogs.value, '');
});

test('it ignores a non-http answer and asks for a name first', async () => {
  let r = setup({ discogs: 'javascript:alert(1)', wikipedia: null });
  r.btn.click();
  await tick();
  assert.equal(r.form.links.inputs.discogs.value, '');
  const form = albumFields({ title: '', artist: '', year: '', type: 'album', genres: editor, links: {}, linksId: 'y', lookup: async () => { throw new Error('no call'); } });
  form.suggest.btn.click();
  assert.match(form.suggest.status.textContent, /Type an album artist or title first/);
});
