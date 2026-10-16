// Character profiles: every character on NUUVI, NPCs included, can have a detailed profile (quick
// facts, personality, history, a gallery and a playlist), shown in the About tab on
// their page. Everyone reads them; the writer (or an admin) edits.
import { html, render, api, $, $$, toast, icons, modal, formatPost, gradAttr, attachSheet, formattingGuide } from '../lib.js';
import { replaceHash } from '../main.js';

const FACT_LABELS = [
  ['fullName', 'Full name'], ['nicknames', 'Nicknames'], ['age', 'Age'], ['birthday', 'Birthday'], ['zodiac', 'Zodiac'],
  ['pronouns', 'Pronouns'], ['gender', 'Gender'], ['sexuality', 'Sexuality'], ['height', 'Height'], ['nationality', 'Nationality'],
  ['hometown', 'Hometown'], ['residence', 'Lives in'], ['occupation', 'Occupation'], ['affiliation', 'Affiliation'],
  ['relationship', 'Relationship'], ['faceclaim', 'Face claim'],
];
// Relationships live in the Ties tab now (the web, the family tree and the relationship notes).
const SECTION_LABELS = [
  ['personality', 'Personality'], ['appearance', 'Appearance'], ['history', 'History'],
  ['goals', 'Goals & fears'], ['trivia', 'Trivia'],
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
  const empty = !facts.length && !sections.length && !d.quote && !d.gallery?.length && !d.traits?.length && !d.likes && !d.dislikes && !d.playlist?.length;
  return html`<div class="dossier about-dossier" data-color="${c.color}"${gradAttr(c)}>
    ${canEdit ? html`<div class="about-edit"><button type="button" class="sm" id="about-edit">${icons.quill} ${empty ? 'Fill in the profile' : 'Edit profile details'}</button></div>` : ''}
    ${d.quote || d.traits?.length ? html`<section class="ds-card ds-intro">
      ${d.quote ? html`<blockquote class="ds-quote">${d.quote}</blockquote>` : ''}
      ${d.traits?.length ? html`<div class="ds-traits">${d.traits.map((t) => html`<span>${t}</span>`)}</div>` : ''}
    </section>` : ''}

    ${facts.length ? html`<section class="ds-card ds-facts"><h3 class="ds-title">The basics</h3>
      <dl>${facts.map(([k, l]) => html`<div><dt>${l}</dt><dd>${d.facts[k]}</dd></div>`)}</dl></section>` : ''}

    ${d.likes || d.dislikes ? html`<section class="ds-card ds-likes">
      ${d.likes ? html`<div><h3 class="ds-title">Loves</h3><p>${d.likes}</p></div>` : ''}
      ${d.dislikes ? html`<div><h3 class="ds-title">Can't stand</h3><p>${d.dislikes}</p></div>` : ''}</section>` : ''}

    ${sections.map(([k, l]) => html`<section class="ds-card ds-section"><h3 class="ds-title">${l}</h3><div class="body">${formatPost(d.sections[k])}</div></section>`)}

    ${d.gallery?.length ? html`<section class="ds-card ds-gallery-card"><h3 class="ds-title">Gallery</h3>
      <div class="ds-flow" data-flow>
        <div class="ds-flow-track" tabindex="0" aria-label="Gallery: swipe or use the arrows">${d.gallery.map((u, i) => html`
          <a class="ds-flow-card" href="${u}" data-i="${i}"><img src="${u}" alt="" loading="lazy" draggable="false"><span class="ds-flow-expand">${icons.expand || '⤢'} Expand</span></a>`)}</div>
        ${d.gallery.length > 1 ? html`<button type="button" class="ds-flow-nav prev" data-flow-go="-1" aria-label="Previous picture">‹</button>
          <button type="button" class="ds-flow-nav next" data-flow-go="1" aria-label="Next picture">›</button>` : ''}
      </div>
      ${d.gallery.length > 1 ? html`<div class="ds-flow-dots" aria-hidden="true">${d.gallery.map((_, i) => html`<i data-dot="${i}"></i>`)}</div>` : ''}
    </section>` : ''}

    ${d.playlist?.length ? html`<section class="ds-card"><h3 class="ds-title">Playlist</h3>
      <ol class="ds-playlist">${d.playlist.map((t, i) => (t.link?.embed ? html`<li class="ds-song-embed"><span class="ds-n">${String(i + 1).padStart(2, '0')}</span>
          <iframe class="ds-player song ${t.link.service} ${t.link.size === 'video' ? 'video' : ''}" src="${t.link.embed}" title="${t.title || 'Song'}${t.artist ? ` by ${t.artist}` : ''}"
            loading="lazy" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" referrerpolicy="strict-origin-when-cross-origin"></iframe></li>`
        : html`<li><span class="ds-n">${String(i + 1).padStart(2, '0')}</span><b>${t.title}</b><small>${t.artist}</small></li>`))}</ol></section>` : ''}
  </div>`;
}

// ---------- Editor ----------
export async function editDossier(c, d) {
  const gallery = [...(d.gallery || [])];
  let cover = d.cover || null;
  const playlist = d.playlist?.length ? d.playlist.map((t) => ({ title: t.title || '', artist: t.artist || '', url: t.link?.url || '' })) : [];
  return modal(html`<form class="ds-editor">
    <h2>${c.name}: profile details</h2>
    <nav class="ds-tabs" role="tablist">${[['id', 'Identity'], ['facts', 'Facts'], ['story', 'Story'], ['extras', 'Gallery & music']].map(([k, l], i) => html`
      <button type="button" class="chip ${i ? '' : 'on'}" data-tab="${k}">${l}</button>`)}</nav>
    <div data-pane="id">
      <label>Headline <small class="muted">(the big line at the top of their page, before their name; it changes every few minutes to lines with the same energy)</small></label><input name="headline" maxlength="40" value="${d.headline || ''}" placeholder="OHH SHIT IT'S">
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
      <label>Gallery <small class="muted">(up to 20 pictures)</small></label>
      <div class="ds-gal-edit" id="ds-gal"></div>
      <div class="actions"><button type="button" class="sm" id="ds-gal-add">Add pictures</button></div>
      <label>Playlist <small class="muted">(up to 12 songs)</small></label>
      <p class="hint">Paste a song's link from Spotify, Apple Music, YouTube or SoundCloud and it shows as a little player you can press play on. No link? The song shows as a line of text.</p>
      <div id="ds-songs"></div>
      <div class="actions"><button type="button" class="sm" id="ds-song-add">Add a song</button></div>
    </div>
    <div class="actions end"><button type="button" data-close>Cancel</button><button type="submit" class="primary">Save profile</button></div>
  </form>`, {
    init: (dlg, close) => {
      const drawGal = () => render($('#ds-gal', dlg), html`${gallery.map((u, i) => html`<span class="thumb"><img src="${u}" alt=""><button type="button" data-rm-pic="${i}" aria-label="Remove">✕</button></span>`)}`);
      const drawSongs = () => render($('#ds-songs', dlg), html`${playlist.map((t, i) => html`<div class="ds-song">
        <input data-song="${i}" data-k="title" placeholder="Song" value="${t.title}"><input data-song="${i}" data-k="artist" placeholder="Artist" value="${t.artist}">
        <button type="button" class="icon-btn sm" data-rm-song="${i}" aria-label="Remove">✕</button>
        <input class="ds-song-link" data-song="${i}" data-k="url" type="url" maxlength="500" placeholder="Song link (optional): https://open.spotify.com/track/…" value="${t.url || ''}"></div>`)}`);
      drawGal(); drawSongs();
      dlg.addEventListener('click', (e) => {
        const tab = e.target.closest('[data-tab]');
        if (tab) {
          $$('[data-tab]', dlg).forEach((b) => b.classList.toggle('on', b === tab));
          $$('[data-pane]', dlg).forEach((p) => { p.hidden = p.dataset.pane !== tab.dataset.tab; });
        }
        if (e.target.closest('#ds-fmt')) formattingGuide();
        if (e.target.closest('#ds-gal-add')) attachSheet({ max: 20 - gallery.length, onPictures: (urls) => { gallery.push(...urls.slice(0, 20 - gallery.length)); drawGal(); } });
        const rp = e.target.closest('[data-rm-pic]');
        if (rp) { gallery.splice(Number(rp.dataset.rmPic), 1); drawGal(); }
        if (e.target.closest('#ds-song-add') && playlist.length < 12) { playlist.push({ title: '', artist: '', url: '' }); drawSongs(); }
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
          bento: d.bento || {}, // which post is in which profile box (set on the profile itself)
          song: d.song || null, // the song on their profile (set on the profile itself)
          headline: f.headline.value, quote: f.quote.value, likes: f.likes.value, dislikes: f.dislikes.value, cover,
          traits: f.traits.value.split(',').map((t) => t.trim()).filter(Boolean),
          facts: Object.fromEntries(FACT_LABELS.map(([k]) => [k, f[`f_${k}`].value])),
          // Relationship notes are edited in the Ties tab; keep them as they are.
          sections: { ...Object.fromEntries(SECTION_LABELS.map(([k]) => [k, f[`s_${k}`].value])), relationships: d.sections?.relationships || '' },
          gallery, playlist: playlist.filter((t) => t.title.trim() || t.url.trim()).map((t) => ({ title: t.title, artist: t.artist, link: t.url.trim() })),
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

// The gallery carousel: swipe (phones), scroll or drag (computers), or the ‹ › arrows. The picture in
// the middle is big and flat; the ones beside it turn away and tuck behind, like cards in a museum.
export function wireGallery(root) {
  for (const flow of $$('[data-flow]', root)) {
    const track = $('.ds-flow-track', flow);
    const cards = $$('.ds-flow-card', track);
    const dots = $$('[data-dot]', flow.parentElement);
    let active = 0;
    const centerOf = (card) => card.offsetLeft + card.offsetWidth / 2 - track.clientWidth / 2;
    const update = () => {
      const mid = track.scrollLeft + track.clientWidth / 2;
      let best = 0;
      cards.forEach((card, i) => {
        const d = Math.max(-3, Math.min(3, (card.offsetLeft + card.offsetWidth / 2 - mid) / (card.offsetWidth || 1)));
        card.style.setProperty('--d', d.toFixed(3));
        card.style.setProperty('--ad', Math.abs(d).toFixed(3));
        card.style.zIndex = String(100 - Math.round(Math.abs(d) * 10));
        if (Math.abs(d) < Math.abs((cards[best].offsetLeft + cards[best].offsetWidth / 2 - mid) / (cards[best].offsetWidth || 1))) best = i;
      });
      active = best;
      cards.forEach((card, i) => card.classList.toggle('on', i === active));
      dots.forEach((dot, i) => dot.classList.toggle('on', i === active));
    };
    const go = (i) => {
      const n = Math.max(0, Math.min(cards.length - 1, i));
      track.scrollTo({ left: centerOf(cards[n]), behavior: 'smooth' });
    };
    let frame = 0;
    track.addEventListener('scroll', () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; update(); }); }, { passive: true });
    flow.addEventListener('click', (e) => {
      const nav = e.target.closest('[data-flow-go]');
      if (nav) { go(active + Number(nav.dataset.flowGo)); return; }
      // Tapping a picture at the side brings it to the middle; the middle one opens big.
      const card = e.target.closest('.ds-flow-card');
      if (card && (dragged || Number(card.dataset.i) !== active)) { e.preventDefault(); if (!dragged) go(Number(card.dataset.i)); }
    });
    track.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); go(active + (e.key === 'ArrowRight' ? 1 : -1)); }
    });
    // Drag with the mouse on computers.
    let dragged = false;
    track.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      const x0 = e.clientX; const s0 = track.scrollLeft;
      dragged = false;
      track.classList.add('dragging');
      const move = (ev) => { if (Math.abs(ev.clientX - x0) > 5) dragged = true; track.scrollLeft = s0 - (ev.clientX - x0); };
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        track.classList.remove('dragging');
        update(); go(active);
        setTimeout(() => { dragged = false; }, 0);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
    requestAnimationFrame(() => { track.scrollLeft = centerOf(cards[0]); update(); });
    window.addEventListener('resize', update, { passive: true });
  }
}
