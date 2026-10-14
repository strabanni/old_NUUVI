// Character profiles: a category of its own (like the Archive) where every character on NUUVI,
// NPCs included, can have a deeply detailed dossier: quick facts, personality, history,
// relationships, a gallery and a playlist. Everyone reads them; the writer (or an admin) edits.
import { html, render, api, $, $$, toast, icons, modal, formatPost, gradAttr, attachSheet, formattingGuide } from '../lib.js';
import { state, page, routeAlive, ensureAlive } from '../main.js';

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

const pic = (c) => c.portrait || c.avatar;
const initial = (c) => c.name.trim().slice(0, 1).toUpperCase();

// ---------- The category: every character as a card ----------
export async function viewProfiles() {
  const alive = routeAlive();
  const { profiles } = await api('/api/profiles');
  ensureAlive(alive);
  let filter = 'all';
  let q = '';
  const body = page({
    alive,
    title: 'Profiles',
    subtitle: 'Every character in NUUVI, in detail',
    body: html`<div class="pf-tools">
        <input type="search" id="pf-q" placeholder="Search characters…" aria-label="Search characters">
        <nav class="pf-chips" role="tablist">${[['all', 'All'], ['mine', 'Mine'], ['cast', 'Characters'], ['npc', 'NPCs']].map(([k, l]) => html`
          <button type="button" class="chip ${k === 'all' ? 'on' : ''}" data-f="${k}">${l}</button>`)}</nav>
      </div>
      <div class="pf-grid" id="pf-grid"></div>`,
  });
  const grid = $('#pf-grid', body);
  const draw = () => {
    const list = profiles.filter((c) => (filter === 'all' || (filter === 'mine' && c.mine) || (filter === 'npc' && c.npc) || (filter === 'cast' && !c.npc))
      && (!q || `${c.name} ${c.handle || ''} ${c.aka || ''} ${c.occupation} ${c.ownerName}`.toLowerCase().includes(q)));
    render(grid, list.length ? html`${list.map((c) => html`
      <a class="pf-card" href="#/profiles/${c.id}" data-color="${c.color}"${gradAttr(c)}>
        <span class="pf-card-pic">${pic(c) ? html`<img src="${pic(c)}" alt="" loading="lazy">` : html`<span class="pf-initial">${initial(c)}</span>`}</span>
        <span class="pf-card-shade"></span>
        ${c.npc ? html`<span class="pf-tag">NPC</span>` : ''}
        <span class="pf-card-info">
          <b>${c.name}</b>
          <small>${[c.age, c.occupation].filter(Boolean).join(' · ') || (c.handle ? `@${c.handle}` : '')}</small>
          ${c.quote ? html`<i>“${c.quote}”</i>` : ''}
        </span>
      </a>`)}` : html`<div class="empty"><p>No characters match.</p></div>`);
  };
  draw();
  $('#pf-q', body).addEventListener('input', (e) => { q = e.target.value.trim().toLowerCase(); draw(); });
  body.addEventListener('click', (e) => {
    const b = e.target.closest('[data-f]');
    if (!b) return;
    filter = b.dataset.f;
    $$('[data-f]', body).forEach((x) => x.classList.toggle('on', x === b));
    draw();
  });
}

// ---------- One character's dossier ----------
export async function viewProfile(idStr) {
  const alive = routeAlive();
  const { character: c, dossier: d, owner, canEdit } = await api(`/api/profiles/${idStr}`);
  ensureAlive(alive);
  const facts = FACT_LABELS.filter(([k]) => d.facts?.[k]);
  const sections = SECTION_LABELS.filter(([k]) => d.sections?.[k]);
  const empty = !facts.length && !sections.length && !d.quote && !d.gallery?.length;
  const body = page({
    alive,
    title: c.name,
    subtitle: c.npc ? 'NPC profile' : `Profile · written by ${owner.displayName}`,
    actions: canEdit ? html`<button class="primary sm" id="pf-edit">${icons.edit || icons.quill}<span class="lbl">Edit profile</span></button>` : '',
    className: 'pf-body',
    body: html`<article class="dossier" data-color="${c.color}"${gradAttr(c)}>
      <header class="ds-hero">
        <div class="ds-cover">${d.cover || pic(c) ? html`<img src="${d.cover || pic(c)}" alt="">` : ''}</div>
        <div class="ds-hero-in">
          <div class="ds-portrait">${pic(c) ? html`<img src="${pic(c)}" alt="${c.name}">` : html`<span class="pf-initial">${initial(c)}</span>`}</div>
          <div class="ds-id">
            <span class="ds-eyebrow">${c.npc ? 'NPC' : 'Character'} file${c.handle ? html` · <a href="#/c/${c.id}">@${c.handle}</a>` : ''}</span>
            <h2 class="ds-name">${c.name}</h2>
            ${d.tagline || c.tagline ? html`<p class="ds-tagline">${d.tagline || c.tagline}</p>` : ''}
            ${d.traits?.length ? html`<div class="ds-traits">${d.traits.map((t) => html`<span>${t}</span>`)}</div>` : ''}
          </div>
        </div>
        ${d.quote ? html`<blockquote class="ds-quote">${d.quote}</blockquote>` : ''}
      </header>

      ${empty ? html`<div class="ds-empty">${icons.card}<p>${canEdit ? 'This profile is empty. Tap Edit profile to fill it in: facts, personality, history, a gallery and more.' : 'Nothing here yet.'}</p></div>` : ''}

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
    </article>`,
  });
  $('#main #pf-edit')?.addEventListener('click', async () => {
    if (await editDossier(c, d)) viewProfile(idStr);
  });
}

// ---------- Editor ----------
async function editDossier(c, d) {
  const gallery = [...(d.gallery || [])];
  let cover = d.cover || null;
  const playlist = d.playlist?.length ? d.playlist.map((t) => ({ ...t })) : [];
  return modal(html`<form class="ds-editor">
    <h2>${c.name}'s profile</h2>
    <nav class="ds-tabs" role="tablist">${[['id', 'Identity'], ['facts', 'Facts'], ['story', 'Story'], ['extras', 'Gallery & music']].map(([k, l], i) => html`
      <button type="button" class="chip ${i ? '' : 'on'}" data-tab="${k}">${l}</button>`)}</nav>
    <div data-pane="id">
      <label>Tagline</label><input name="tagline" maxlength="160" value="${d.tagline || ''}" placeholder="A line under their name">
      <label>Signature quote</label><input name="quote" maxlength="300" value="${d.quote || ''}" placeholder="Something they'd say">
      <label>Traits <small class="muted">(comma separated)</small></label><input name="traits" value="${(d.traits || []).join(', ')}" placeholder="loyal, reckless, night owl">
      <label>Cover picture <small class="muted">(wide, best 1800 × 700)</small></label>
      <div class="ds-cover-pick" id="ds-cover">${cover ? html`<img src="${cover}" alt="">` : html`<span>Uses their portrait until you pick one</span>`}</div>
      <div class="actions"><button type="button" class="sm" id="ds-cover-btn">Choose cover</button>${cover ? html`<button type="button" class="sm" id="ds-cover-clear">Remove</button>` : ''}</div>
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
      const drawCover = () => render($('#ds-cover', dlg), cover ? html`<img src="${cover}" alt="">` : html`<span>Uses their portrait until you pick one</span>`);
      drawGal(); drawSongs();
      dlg.addEventListener('click', (e) => {
        const tab = e.target.closest('[data-tab]');
        if (tab) {
          $$('[data-tab]', dlg).forEach((b) => b.classList.toggle('on', b === tab));
          $$('[data-pane]', dlg).forEach((p) => { p.hidden = p.dataset.pane !== tab.dataset.tab; });
        }
        if (e.target.closest('#ds-fmt')) formattingGuide();
        if (e.target.closest('#ds-gal-add')) attachSheet({ max: 12 - gallery.length, onPictures: (urls) => { gallery.push(...urls.slice(0, 12 - gallery.length)); drawGal(); } });
        if (e.target.closest('#ds-cover-btn')) attachSheet({ max: 1, onPictures: (urls) => { [cover] = urls; drawCover(); } });
        if (e.target.closest('#ds-cover-clear')) { cover = null; drawCover(); }
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
