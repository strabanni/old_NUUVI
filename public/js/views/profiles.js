// Character profiles: every character on NUUVI, NPCs included, can have a detailed profile (quick
// facts, personality, history, relationships, a gallery and a playlist), shown in the About tab on
// their page. Everyone reads them; the writer (or an admin) edits.
import { html, render, api, $, $$, toast, icons, modal, formatPost, gradAttr, attachSheet, formattingGuide } from '../lib.js';
import { replaceHash } from '../main.js';

const FACT_LABELS = [
  ['fullName', 'Full name'], ['nicknames', 'Nicknames'], ['age', 'Age'], ['birthday', 'Birthday'], ['zodiac', 'Zodiac'],
  ['pronouns', 'Pronouns'], ['gender', 'Gender'], ['sexuality', 'Sexuality'], ['height', 'Height'], ['nationality', 'Nationality'],
  ['hometown', 'Hometown'], ['residence', 'Lives in'], ['occupation', 'Occupation'], ['affiliation', 'Affiliation'],
  ['relationship', 'Relationship'], ['faceclaim', 'Face claim'],
];
const SECTION_LABELS = [
  ['personality', 'Personality'], ['appearance', 'Appearance'], ['history', 'History'],
  ['relationships', 'Relationships'], ['goals', 'Goals & fears'], ['trivia', 'Trivia'],
];

// Profiles live in the About tab on each character's page now; the old Profiles pages lead there.
export function viewProfiles() { replaceHash('#/directory'); }
export function viewProfile(idStr) {
  try { sessionStorage.setItem('nuuvi:char-tab', 'about'); } catch { /* ignore */ }
  replaceHash(`#/c/${idStr}`);
}

// A character's profile, for the About tab on their page (their picture and banner are already
// at the top of that page, so it starts with their quote and traits).
export function dossierAbout(c, d, { canEdit = false } = {}) {
  const facts = FACT_LABELS.filter(([k]) => d.facts?.[k]);
  const sections = SECTION_LABELS.filter(([k]) => d.sections?.[k]);
  const empty = !facts.length && !sections.length && !d.quote && !d.gallery?.length && !d.traits?.length && !d.likes && !d.dislikes;
  return html`<div class="dossier about-dossier" data-color="${c.color}"${gradAttr(c)}>
    ${canEdit ? html`<div class="about-edit"><button type="button" class="sm" id="about-edit">${icons.quill} ${empty ? 'Fill in the profile' : 'Edit profile details'}</button></div>` : ''}
    ${d.quote || d.traits?.length || d.tagline ? html`<section class="ds-card ds-intro">
      ${d.tagline ? html`<p class="ds-tagline">${d.tagline}</p>` : ''}
      ${d.quote ? html`<blockquote class="ds-quote">${d.quote}</blockquote>` : ''}
      ${d.traits?.length ? html`<div class="ds-traits">${d.traits.map((t) => html`<span>${t}</span>`)}</div>` : ''}
    </section>` : ''}

    ${facts.length ? html`<section class="ds-card ds-facts"><h3 class="ds-title">The basics</h3>
      <dl>${facts.map(([k, l]) => html`<div><dt>${l}</dt><dd>${d.facts[k]}</dd></div>`)}</dl></section>` : ''}

    ${d.likes || d.dislikes ? html`<section class="ds-card ds-likes">
      ${d.likes ? html`<div><h3 class="ds-title">Loves</h3><p>${d.likes}</p></div>` : ''}
      ${d.dislikes ? html`<div><h3 class="ds-title">Can't stand</h3><p>${d.dislikes}</p></div>` : ''}</section>` : ''}

    ${sections.map(([k, l]) => html`<section class="ds-card ds-section"><h3 class="ds-title">${l}</h3><div class="body">${formatPost(d.sections[k])}</div></section>`)}

    ${d.gallery?.length ? html`<section class="ds-card"><h3 class="ds-title">Gallery</h3>
      <div class="ds-gallery b-pics">${d.gallery.map((u) => html`<a href="${u}"><img src="${u}" alt="" loading="lazy"></a>`)}</div></section>` : ''}

    ${d.playlist?.length ? html`<section class="ds-card"><h3 class="ds-title">Playlist</h3>
      <ol class="ds-playlist">${d.playlist.map((t, i) => html`<li><span class="ds-n">${String(i + 1).padStart(2, '0')}</span><b>${t.title}</b><small>${t.artist}</small></li>`)}</ol></section>` : ''}
  </div>`;
}

// ---------- Editor ----------
export async function editDossier(c, d) {
  const gallery = [...(d.gallery || [])];
  let cover = d.cover || null;
  const playlist = d.playlist?.length ? d.playlist.map((t) => ({ ...t })) : [];
  return modal(html`<form class="ds-editor">
    <h2>${c.name}: profile details</h2>
    <nav class="ds-tabs" role="tablist">${[['id', 'Identity'], ['facts', 'Facts'], ['story', 'Story'], ['extras', 'Gallery & music']].map(([k, l], i) => html`
      <button type="button" class="chip ${i ? '' : 'on'}" data-tab="${k}">${l}</button>`)}</nav>
    <div data-pane="id">
      <label>Tagline</label><input name="tagline" maxlength="160" value="${d.tagline || ''}" placeholder="A line under their name">
      <label>Signature quote</label><input name="quote" maxlength="300" value="${d.quote || ''}" placeholder="Something they'd say">
      <label>Traits <small class="muted">(comma separated)</small></label><input name="traits" value="${(d.traits || []).join(', ')}" placeholder="loyal, reckless, night owl">
      <label>Loves</label><textarea name="likes" rows="2" maxlength="1000">${d.likes || ''}</textarea>
      <label>Can't stand</label><textarea name="dislikes" rows="2" maxlength="1000">${d.dislikes || ''}</textarea>
    </div>
    <div data-pane="facts" hidden><div class="ds-fact-grid">${FACT_LABELS.map(([k, l]) => html`
      <div><label>${l}</label><input name="f_${k}" maxlength="160" value="${d.facts?.[k] || ''}"></div>`)}</div></div>
    <div data-pane="story" hidden><p class="hint">HTML, Discord and forum codes all work here. <button type="button" class="link" id="ds-fmt">Formatting codes to copy</button></p>${SECTION_LABELS.map(([k, l]) => html`
      <label>${l}</label><textarea name="s_${k}" rows="5" maxlength="20000" placeholder="Formatting works here (bold, colors, centering…)">${d.sections?.[k] || ''}</textarea>`)}</div>
    <div data-pane="extras" hidden>
      <label>Gallery <small class="muted">(up to 12 pictures)</small></label>
      <div class="ds-gal-edit" id="ds-gal"></div>
      <div class="actions"><button type="button" class="sm" id="ds-gal-add">Add pictures</button></div>
      <label>Playlist <small class="muted">(up to 12 songs)</small></label>
      <div id="ds-songs"></div>
      <div class="actions"><button type="button" class="sm" id="ds-song-add">Add a song</button></div>
    </div>
    <div class="actions end"><button type="button" data-close>Cancel</button><button type="submit" class="primary">Save profile</button></div>
  </form>`, {
    init: (dlg, close) => {
      const drawGal = () => render($('#ds-gal', dlg), html`${gallery.map((u, i) => html`<span class="thumb"><img src="${u}" alt=""><button type="button" data-rm-pic="${i}" aria-label="Remove">✕</button></span>`)}`);
      const drawSongs = () => render($('#ds-songs', dlg), html`${playlist.map((t, i) => html`<div class="ds-song">
        <input data-song="${i}" data-k="title" placeholder="Song" value="${t.title}"><input data-song="${i}" data-k="artist" placeholder="Artist" value="${t.artist}">
        <button type="button" class="icon-btn sm" data-rm-song="${i}" aria-label="Remove">✕</button></div>`)}`);
      drawGal(); drawSongs();
      dlg.addEventListener('click', (e) => {
        const tab = e.target.closest('[data-tab]');
        if (tab) {
          $$('[data-tab]', dlg).forEach((b) => b.classList.toggle('on', b === tab));
          $$('[data-pane]', dlg).forEach((p) => { p.hidden = p.dataset.pane !== tab.dataset.tab; });
        }
        if (e.target.closest('#ds-fmt')) formattingGuide();
        if (e.target.closest('#ds-gal-add')) attachSheet({ max: 12 - gallery.length, onPictures: (urls) => { gallery.push(...urls.slice(0, 12 - gallery.length)); drawGal(); } });
        const rp = e.target.closest('[data-rm-pic]');
        if (rp) { gallery.splice(Number(rp.dataset.rmPic), 1); drawGal(); }
        if (e.target.closest('#ds-song-add') && playlist.length < 12) { playlist.push({ title: '', artist: '' }); drawSongs(); }
        const rs = e.target.closest('[data-rm-song]');
        if (rs) { playlist.splice(Number(rs.dataset.rmSong), 1); drawSongs(); }
      });
      dlg.addEventListener('input', (e) => { const s = e.target.closest('[data-song]'); if (s) playlist[Number(s.dataset.song)][s.dataset.k] = s.value; });
      // On the dialog, in the capture phase, so this runs instead of the modal's own form handling.
      dlg.addEventListener('submit', async (e) => {
        e.preventDefault();
        e.stopImmediatePropagation();
        const f = e.target;
        const dossier = {
          tagline: f.tagline.value, quote: f.quote.value, likes: f.likes.value, dislikes: f.dislikes.value, cover,
          traits: f.traits.value.split(',').map((t) => t.trim()).filter(Boolean),
          facts: Object.fromEntries(FACT_LABELS.map(([k]) => [k, f[`f_${k}`].value])),
          sections: Object.fromEntries(SECTION_LABELS.map(([k]) => [k, f[`s_${k}`].value])),
          gallery, playlist: playlist.filter((t) => t.title.trim()),
        };
        try {
          await api(`/api/profiles/${c.id}`, { method: 'PUT', body: { dossier } });
          toast('Profile saved');
          close(true);
        } catch (err) { toast(err.message); }
      }, true);
    },
  });
}
