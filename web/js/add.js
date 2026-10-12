import { api } from './api.js';
import { store } from './store.js';
import { player } from './player.js';
import { tagEditor } from './tag-editor.js';
import { el, fmtTime } from './dom.js';

export function renderAdd(root) {
  let timer = null;
  let preview = null;

  const url = el('input', { type: 'text', placeholder: 'Paste a YouTube link', 'aria-label': 'YouTube URL', autocomplete: 'off', inputMode: 'url' });
  const previewBtn = el('button', { class: 'btn primary', type: 'submit' }, 'Preview');
  const form = el('form', { class: 'row' }, url, previewBtn);
  const message = el('div');
  const card = el('div');
  root.append(form, message, card);

  const say = (text, kind = '') => message.replaceChildren(text ? el('p', { class: `msg ${kind}` }, text) : '');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!url.value.trim()) return;
    say('');
    card.replaceChildren();
    previewBtn.disabled = true;
    previewBtn.textContent = 'Loading...';
    try {
      preview = await api.preview(url.value.trim());
      if (!store.loaded) await store.refresh().catch(() => {});
      renderCard();
      if (preview.in_library) say('This song is already in your library.', 'error');
    } catch (ex) {
      say(ex.message, 'error');
    } finally {
      previewBtn.disabled = false;
      previewBtn.textContent = 'Preview';
    }
  });

  function renderCard() {
    const f = {
      title: el('input', { type: 'text', value: preview.title || '' }),
      artist: el('input', { type: 'text', value: preview.artist || '' }),
      album: el('input', { type: 'text', value: preview.album || '' }),
      year: el('input', { type: 'number', value: preview.year ?? '', min: 0, max: 3000 }),
      bpm: el('input', { type: 'number', min: 20, max: 300, step: 1, placeholder: 'Detected after saving' }),
    };
    const editor = tagEditor({ tags: preview.tags || [], suggested: preview.tags || [] });
    const saveBtn = el('button', { class: 'btn primary', type: 'submit', disabled: preview.in_library }, 'Save and download');
    const progress = el('div', { class: 'progress', hidden: true }, el('div'));
    const result = el('div');

    const field = (label, input) => el('div', {}, el('label', {}, label), input);


    const cover = el('img', { class: 'cover preview', alt: '', src: preview.thumbnail });
    cover.addEventListener('error', () => cover.removeAttribute('src'));

    const body = el('form', { class: 'card' },
      el('div', { class: 'row' }, cover,
        el('div', {}, el('b', {}, preview.title || 'Untitled'),
          el('div', { class: 'muted' }, preview.duration ? fmtTime(preview.duration) : ''))),
      field('Title', f.title), field('Artist', f.artist),
      el('div', { class: 'grid2' }, field('Album', f.album), field('Year', f.year)),
      field('BPM (optional)', f.bpm),
      el('label', {}, 'Tags'), editor.node,
      el('div', { class: 'row', style: 'margin-top:16px' }, saveBtn),
      progress, result);
    card.replaceChildren(body);

    body.addEventListener('submit', async (e) => {
      e.preventDefault();
      result.replaceChildren();
      saveBtn.disabled = true;
      progress.hidden = false;
      setProgress(0);
      try {
        await api.addSong(preview.source_url, {
          title: f.title.value,
          artist: f.artist.value,
          album: f.album.value,
          year: f.year.value === '' ? null : Number(f.year.value),
          bpm: f.bpm.value === '' ? null : Math.round(Number(f.bpm.value)),
        }, editor.getTags());
        poll();
      } catch (ex) {
        fail(ex.message);
      }
    });

    function setProgress(p) { progress.firstChild.style.width = `${Math.round(p * 100)}%`; }

    function fail(text) {
      clearInterval(timer);
      progress.hidden = true;
      saveBtn.disabled = !!preview.in_library;
      result.replaceChildren(el('p', { class: 'msg error' }, text));
    }

    function poll() {
      clearInterval(timer);
      timer = setInterval(async () => {
        if (!root.isConnected) { clearInterval(timer); return; }
        try {
          const st = await api.status(preview.id);
          setProgress(st.progress || 0);
          if (st.status === 'error') fail(`Download failed: ${st.error}`);
          if (st.status === 'done') {
            clearInterval(timer);
            await store.refresh();
            progress.hidden = true;
            result.replaceChildren(el('p', { class: 'msg ok' }, 'Saved to your library.'),
              el('div', { class: 'row', style: 'margin-top:12px' },
                el('button', { type: 'button', class: 'btn primary', onclick: () => player.playNow(preview.id) }, 'Play now'),
                el('button', { type: 'button', class: 'btn', onclick: () => { card.replaceChildren(); url.value = ''; url.focus(); } }, 'Add another')));
          }
        } catch (ex) {
          fail(ex.message);
        }
      }, 1000);
    }
  }

  return () => clearInterval(timer);
}
