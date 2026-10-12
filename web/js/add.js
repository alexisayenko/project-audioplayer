import { api } from './api.js';
import { store } from './store.js';
import { downloads } from './downloads.js';
import { tagEditor } from './tag-editor.js';
import { el, fmtTime, toast } from './dom.js';
import { icon } from './icons.js';
import { tagLabel } from './tagname.js';
import { cleanPasted, sourceOf, sourceLabel } from './url-clean.js';
import { wikiFields } from './wiki-links.js';
import { dialogHead } from './edit-dialog.js';

const BULK = new Set(['insertFromPaste', 'insertFromPasteAsQuotation', 'insertFromDrop', 'insertReplacementText']);
const PREVIEW_ONLY = 'Preview only \u2014 SoundCloud Go+ track, can\'t be downloaded in full.';
const NO_AUDIO = 'No audio yet \u2014 Spotify gives metadata only. Get the audio from a YouTube match later.';
const field = (label, input) => el('div', { class: 'field' }, el('label', {}, label), input);

export function openAdd() {
  const dlg = document.getElementById('add-dialog');
  let preview = null;

  const url = el('input', { type: 'url', placeholder: 'Paste a YouTube, SoundCloud or Spotify link', 'aria-label': 'YouTube, SoundCloud or Spotify link', autocomplete: 'off', inputMode: 'url' });
  const fetchBtn = el('button', { class: 'btn fill small', type: 'submit' }, 'Fetch');
  const form = el('form', { class: 'well' }, url, fetchBtn);
  const message = el('div');
  const body = el('div', { class: 'add-body' });
  const say = (text, kind = '') => message.replaceChildren(text ? el('p', { class: `msg ${kind}` }, text) : '');

  const tidy = () => {
    const clean = cleanPasted(url.value);
    if (clean === url.value) return;
    url.value = clean;
    url.setSelectionRange(clean.length, clean.length);
  };
  url.addEventListener('input', (e) => { if (BULK.has(e.inputType) || (e.data && e.data.length > 1)) tidy(); });
  url.addEventListener('paste', () => setTimeout(tidy));
  url.addEventListener('drop', () => setTimeout(tidy));
  url.addEventListener('blur', tidy);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    tidy();
    if (!url.value) return;
    say('');
    body.replaceChildren();
    fetchBtn.disabled = true;
    fetchBtn.textContent = 'Fetching...';
    try {
      preview = await api.preview(url.value);
      if (!store.loaded) await store.refresh().catch(() => {});
      renderPreview();
      if (preview.in_library) say('This song is already in your library.', 'error');
      else if (preview.audio === 'none') say(preview.partial ? `${NO_AUDIO} Server has no Spotify credentials: title and cover only.` : NO_AUDIO);
    } catch (ex) {
      say(ex.code === 'preview_only' ? PREVIEW_ONLY : ex.message, 'error');
    } finally {
      fetchBtn.disabled = false;
      fetchBtn.textContent = 'Fetch';
    }
  });

  function renderPreview() {
    const f = {
      title: el('input', { type: 'text', value: preview.title || '' }),
      artist: el('input', { type: 'text', value: preview.artist || '' }),
      album: el('input', { type: 'text', value: preview.album || '' }),
      year: el('input', { type: 'number', value: preview.year ?? '', min: 0, max: 3000 }),
      bpm: el('input', { type: 'number', min: 20, max: 300, step: 1, placeholder: 'Detected after saving' }),
    };
    const tagRow = el('div', { class: 'vchips' });
    let ready = false;
    const editor = tagEditor({
      tags: preview.tags || [], suggested: preview.tags || [], year: f.year,
      onChange: (tags) => { if (ready) paintTags(tags); },
    });
    const wikiMsg = el('div');
    const wiki = wikiFields({
      song: preview.wikipedia_song, artist: preview.wikipedia_artist, year: f.year, editor,
      onMessage: (text, kind) => wikiMsg.replaceChildren(el('p', { class: `msg ${kind}` }, text)),
    });
    const addTag = el('button', { class: 'chip-add', type: 'button', 'aria-label': 'Add tag', 'aria-expanded': 'false' }, icon('plus', 16));
    const editorBox = el('div', { class: 'details', hidden: true }, editor.node);
    addTag.addEventListener('click', () => {
      editorBox.hidden = !editorBox.hidden;
      addTag.setAttribute('aria-expanded', String(!editorBox.hidden));
    });
    function paintTags(tags) {
      tagRow.replaceChildren(...tags.map((t) => el('span', { class: 'chip tint', title: t }, tagLabel(t))), addTag);
    }
    paintTags(editor.peek());
    ready = true;

    const cover = el('img', { class: 'cover xl', alt: '', src: preview.thumbnail });
    cover.addEventListener('error', () => cover.removeAttribute('src'));
    const title = el('div', { class: 't-headline' });
    const sub = el('div', { class: 't-subhead muted' });
    const facts = el('div', { class: 't-time muted' });
    const paintMeta = () => {
      title.textContent = f.title.value || 'Untitled';
      sub.textContent = [f.artist.value, f.album.value, f.year.value].filter(Boolean).join(' · ');
      facts.textContent = [preview.duration ? fmtTime(preview.duration) : '', f.bpm.value ? `${f.bpm.value} BPM` : ''].filter(Boolean).join(' · ');
    };
    for (const i of Object.values(f)) i.addEventListener('input', paintMeta);
    paintMeta();

    const details = el('div', { class: 'details', hidden: true },
      field('Title', f.title), field('Artist', f.artist),
      el('div', { class: 'grid2' }, field('Album', f.album), field('Year', f.year)),
      field('BPM (optional)', f.bpm),
      wiki.node, wikiMsg);
    const edit = el('button', { class: 'btn outline small', type: 'button', 'aria-expanded': 'false' }, 'Edit details');
    edit.addEventListener('click', () => {
      details.hidden = !details.hidden;
      edit.setAttribute('aria-expanded', String(!details.hidden));
    });
    const noAudio = preview.audio === 'none';
    const save = el('button', { class: 'btn primary glow big', type: 'submit', disabled: !!preview.in_library },
      icon(noAudio ? 'plus' : 'download', 20), noAudio ? 'Save to library (no audio)' : 'Save to library');
    const err = el('div');

    const card = el('form', { class: 'add-card' },
      el('div', { class: 'preview-row' }, cover, el('div', { class: 'preview-meta' }, title, sub, facts,
        el('span', { class: 'chip tint', title: 'Source' }, sourceLabel(preview.source || sourceOf(preview.id))),
        noAudio ? el('span', { class: 'chip', title: 'Audio' }, 'No audio yet') : ''), edit),
      details, tagRow, editorBox, err,
      el('div', { class: 'row end' }, save));
    body.replaceChildren(card);

    card.addEventListener('submit', async (e) => {
      e.preventDefault();
      save.disabled = true;
      try {
        await api.addSong(preview.source_url, {
          title: f.title.value,
          artist: f.artist.value,
          album: f.album.value,
          year: f.year.value === '' ? null : Number(f.year.value),
          bpm: f.bpm.value === '' ? null : Math.round(Number(f.bpm.value)),
          ...wiki.values(),
        }, editor.getTags());
        if (!noAudio) downloads.track(preview.id, { title: f.title.value, artist: f.artist.value, thumbnail: preview.thumbnail, duration: preview.duration });
        dlg.close();
        toast(noAudio ? 'Added to your library (no audio yet)' : 'Downloading to your library');
      } catch (ex) {
        save.disabled = !!preview.in_library;
        err.replaceChildren(el('p', { class: 'msg error' }, ex.message));
      }
    });
  }

  dlg.replaceChildren(
    dialogHead('Add a song', 'YouTube or SoundCloud: the server downloads the audio. Spotify: metadata only, no audio.', () => dlg.close()),
    form, message, body);
  dlg.onclick = (e) => { if (e.target === dlg) dlg.close(); };
  dlg.showModal();
  url.focus();
}
