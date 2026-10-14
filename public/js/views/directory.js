// The directory: every writer on this NUUVI (by username), every character in their cast, the NPCs,
// and the Locations of Ardell City (places anyone can add).
import { html, render, api, $, $$, avatar, applyColors, icons, modal, confirmModal, toast, uploadImage, askImageLink, formatPost } from '../lib.js';
import { forgetLocations } from './threads.js';
import { state, page, routeAlive, ensureAlive } from '../main.js';
import { characterCard, editCharacter } from './characters.js';

export async function viewDirectory() {
  const alive = routeAlive();
  const { writers, anonymous = [] } = await api('/api/directory');
  ensureAlive(alive);
  const all = writers.flatMap((w) => w.characters.map((c) => ({ ...c, writer: w })))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  let view = sessionStorage.getItem('nuuvi:dir-view') || 'writers';
  let q = '';
  let npcData = null;
  let npcTag = '';
  let placeData = null;
  let placeTag = ''; // "b:<borough>" or "v:<venue>"

  const body = page({
    alive,
    title: 'Directory',
    banner: 'everyone & everyone they play',
    subtitle: `${writers.length} writers · ${all.length} characters`,
    body: html`
      <div class="dir-tools">
        <input type="search" class="search" id="dir-q" placeholder="Search names, usernames, taglines…" aria-label="Search the directory">
        <div class="seg" role="group" aria-label="Show">
          <button type="button" data-view="writers">By writer</button>
          <button type="button" data-view="characters">All characters</button>
          <button type="button" data-view="npcs">NPCs</button>
          <button type="button" data-view="places">Locations</button>
        </div>
      </div>
      <div id="dir-list"></div>`,
  });
  const list = $('#dir-list', body);
  const match = (...fields) => !q || fields.some((f) => (f || '').toLowerCase().includes(q));

  function draw() {
    $$('[data-view]', body).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
    if (view === 'writers') {
      const shown = writers
        .map((w) => ({ ...w, shownChars: match(w.username, w.displayName) ? w.characters : w.characters.filter((c) => match(c.name, c.tagline)) }))
        .filter((w) => match(w.username, w.displayName) || w.shownChars.length);
      render(list, shown.length ? html`${shown.map((w) => html`
        <section class="dir-writer">
          <a class="dir-head" href="#/u/${w.id}">
            <span class="av-wrap ${state.online.includes(w.id) ? 'is-online' : ''}">${avatar({ name: w.displayName, src: w.avatar, color: '#48484A' })}<i class="online-dot"></i></span>
            <span class="grow"><b>@${w.username}</b><small>${w.displayName !== w.username ? `${w.displayName} · ` : ''}${w.characters.length} ${w.characters.length === 1 ? 'character' : 'characters'}</small></span>
          </a>
          ${w.shownChars.length ? html`<div class="char-grid compact">${w.shownChars.map((c) => characterCard(c))}</div>`
            : html`<p class="muted small">No characters yet.</p>`}
        </section>`)}
        ${anonymous.length ? html`<section class="dir-writer"><div class="dir-head"><span class="grow"><b>Accounts</b><small>Run anonymously</small></span></div>
          <div class="char-grid compact">${anonymous.map((c) => characterCard(c))}</div></section>` : ''}` : html`<div class="empty"><p>Nobody matches “${q}”.</p></div>`);
    } else if (view === 'npcs') {
      // NPCs: everyone's shared background characters, by category.
      if (!npcData) {
        render(list, html`<p class="muted small">Loading NPCs…</p>`);
        api('/api/npcs').then((r) => { npcData = r; if (view === 'npcs') draw(); }).catch(() => {});
        return;
      }
      const { npcs, tags } = npcData;
      const shown = npcs.filter((n) => (!npcTag || n.npcTags.includes(npcTag))
        && match(n.name, n.handle, n.tagline, n.npcTags.join(' '), n.owner.username, n.owner.displayName));
      render(list, html`
        <div class="npc-head"><div class="chips no-swipe">${html`<button type="button" class="chip-btn" data-tag="" aria-pressed="${!npcTag}">All NPCs</button>`}
          ${tags.map((t) => html`<button type="button" class="chip-btn" data-tag="${t}" aria-pressed="${npcTag === t}">#${t}</button>`)}</div>
          <button type="button" class="primary sm" id="new-npc">${icons.plus} Add an NPC</button></div>
        <p class="hint">Anyone can tag these NPCs into their episodes. Mark your own characters as NPCs in their editor.</p>
        ${npcTag ? html`<h2 class="cat-title"><span>${npcTag}</span><small>${shown.length} ${shown.length === 1 ? 'NPC' : 'NPCs'}</small></h2>` : ''}
        ${shown.length ? html`<div class="char-grid npc-grid">${shown.map((n) => html`
          <div class="npc-item">
            ${characterCard(n, { editable: n.owner.id === state.user.id })}
            <div class="npc-meta"><span class="muted small">by @${n.owner.username}</span>
              ${n.npcTags.map((t) => html`<button type="button" class="tag" data-tag="${t}">#${t}</button>`)}</div>
          </div>`)}</div>` : html`<div class="empty"><p>${npcs.length ? 'No NPCs match.' : 'No NPCs yet.'}</p></div>`}`);
    } else if (view === 'places') {
      // Locations: places in Ardell City, with the borough and kind of venue as tags.
      if (!placeData) {
        render(list, html`<p class="muted small">Loading locations…</p>`);
        api('/api/places').then((r) => { placeData = r; if (view === 'places') draw(); }).catch(() => {});
        return;
      }
      const { places, boroughs, venues } = placeData;
      const [kind, value] = placeTag ? [placeTag[0], placeTag.slice(2)] : [null, null];
      const shown = places.filter((p) => (!kind || (kind === 'b' ? p.borough === value : p.venue === value))
        && match(p.name, p.borough, p.venue, p.description));
      render(list, html`
        <div class="npc-head"><div class="chips no-swipe"><button type="button" class="chip-btn" data-ptag="" aria-pressed="${!placeTag}">All places</button>
          ${boroughs.map((b) => html`<button type="button" class="chip-btn" data-ptag="b:${b}" aria-pressed="${placeTag === `b:${b}`}">${icons.pin} ${b}</button>`)}
          ${venues.map((v) => html`<button type="button" class="chip-btn" data-ptag="v:${v}" aria-pressed="${placeTag === `v:${v}`}">#${v}</button>`)}</div>
          <button type="button" class="primary sm" id="new-place">${icons.plus} Add a location</button></div>
        <p class="hint">Places in Ardell City for everyone's stories. Anyone can add one; they show up as suggestions when you tag a location.</p>
        ${placeTag ? html`<h2 class="cat-title"><span>${value}</span><small>${shown.length} ${shown.length === 1 ? 'place' : 'places'}</small></h2>` : ''}
        ${shown.length ? html`<div class="char-grid npc-grid">${shown.map((p) => html`
          <div class="npc-item">
            <button type="button" class="char-card place-card" data-place="${p.id}" data-color="#C79AD8">
              ${p.picture ? html`<img src="${p.picture}" alt="" loading="lazy">` : html`<span class="initial">${icons.pin}</span>`}
              <span class="cc-top">${p.venue ? html`<span class="cc-badge">${p.venue}</span>` : ''}<span class="cc-name">${p.name}</span></span>
              <span class="cc-glass"><span class="cc-who"><b>${p.name}</b>${p.borough ? html`<small>${p.borough}</small>` : ''}</span><span class="cc-btn">View</span></span>
            </button>
            <div class="npc-meta">${p.borough ? html`<button type="button" class="tag" data-ptag="b:${p.borough}">${icons.pin} ${p.borough}</button>` : ''}
              ${p.venue ? html`<button type="button" class="tag" data-ptag="v:${p.venue}">#${p.venue}</button>` : ''}</div>
          </div>`)}</div>` : html`<div class="empty"><p>${places.length ? 'No places match.' : 'No locations yet. Add the first one!'}</p></div>`}`);
    } else {
      const shown = all.filter((c) => match(c.name, c.tagline, c.writer.username, c.writer.displayName));
      const groups = new Map();
      for (const c of shown) {
        const letter = /^[a-z]/i.test(c.name) ? c.name[0].toUpperCase() : '#';
        if (!groups.has(letter)) groups.set(letter, []);
        groups.get(letter).push(c);
      }
      render(list, shown.length ? html`${[...groups].map(([letter, chars]) => html`
        <h2 class="section-title dir-letter">${letter}</h2>
        <div class="char-grid compact">${chars.map((c) => characterCard(c))}</div>`)}`
        : html`<div class="empty"><p>${q ? `Nobody matches “${q}”.` : 'No characters yet.'}</p></div>`);
    }
    applyColors(list);
  }
  draw();
  body.addEventListener('click', async (e) => {
    const pt = e.target.closest('[data-ptag]');
    if (pt && view === 'places') { placeTag = pt.dataset.ptag === placeTag ? '' : pt.dataset.ptag; draw(); return; }
    if (e.target.closest('#new-place')) { if (await editPlace({}, placeData)) { placeData = null; forgetLocations(); draw(); } return; }
    const pc = e.target.closest('[data-place]');
    if (pc) {
      const p = placeData.places.find((x) => x.id === Number(pc.dataset.place));
      if (await showPlace(p, placeData)) { placeData = null; forgetLocations(); draw(); }
      return;
    }
    const t = e.target.closest('[data-tag]');
    if (t && view === 'npcs') { e.preventDefault(); npcTag = t.dataset.tag === npcTag ? '' : t.dataset.tag; draw(); return; }
    if (e.target.closest('#new-npc')) { if (await editCharacter({ npc: true })) { npcData = null; draw(); } return; }
    const ed = e.target.closest('[data-edit]');
    if (ed && view === 'npcs') {
      e.preventDefault();
      if (await editCharacter(npcData.npcs.find((n) => n.id === Number(ed.dataset.edit)))) { npcData = null; draw(); }
      return;
    }
    const b = e.target.closest('[data-view]');
    if (!b) return;
    view = b.dataset.view;
    sessionStorage.setItem('nuuvi:dir-view', view);
    draw();
  });
  $('#dir-q', body).addEventListener('input', (e) => { q = e.target.value.trim().toLowerCase(); draw(); });
}

// ---------- Locations ----------
const VENUES = ['Apartment', 'Bar', 'Beach', 'Café', 'Club', 'Gallery', 'Gym', 'Hospital', 'Hotel', 'Office', 'Park', 'Penthouse', 'Restaurant', 'School', 'Shop', 'Studio', 'Theatre'];

// A place, opened from its card: picture, name, tags and what it's like. Resolves true if it changed.
async function showPlace(p, data) {
  const canEdit = p.owner.id === state.user.id || state.user.isAdmin;
  const res = await modal(html`<div class="place-view">
    ${p.picture ? html`<img class="place-pic" src="${p.picture}" alt="">` : ''}
    <h2>${p.name}</h2>
    <div class="npc-meta">${p.borough ? html`<span class="tag">${icons.pin} ${p.borough}</span>` : ''}${p.venue ? html`<span class="tag">#${p.venue}</span>` : ''}</div>
    ${p.description ? html`<div class="body prose">${formatPost(p.description)}</div>` : ''}
    <p class="muted small">Added by @${p.owner.username}</p>
    <div class="actions end">
      ${canEdit ? html`<button type="button" class="danger" id="pl-del">Remove</button><button type="button" id="pl-edit">Edit</button>` : ''}
      <button type="button" class="primary" data-close>Close</button>
    </div></div>`, {
    init: (d, close) => {
      $('#pl-edit', d)?.addEventListener('click', () => close('edit'));
      $('#pl-del', d)?.addEventListener('click', async () => {
        if (!(await confirmModal(`Remove ${p.name} from Locations?`, { ok: 'Remove', danger: true }))) return;
        try { await api(`/api/places/${p.id}`, { method: 'DELETE' }); close('changed'); } catch (err) { toast(err.message); }
      });
    },
  });
  if (res === 'edit') return editPlace(p, data);
  return res === 'changed';
}

// Add or change a place. Resolves true when saved.
async function editPlace(p, data) {
  let picture = p.picture || '';
  const res = await modal(html`<form class="place-form">
    <h2>${p.id ? `Edit ${p.name}` : 'Add a location'}</h2>
    <div class="place-pic-edit" id="pl-pic"></div>
    <div class="row-inline"><label class="btn sm file-btn">${icons.image} Picture<input type="file" accept="image/*" id="pl-file" hidden></label>
      <button type="button" class="sm" id="pl-link">Link</button></div>
    <label for="pl-name">Name</label><input id="pl-name" name="name" required maxlength="80" value="${p.name || ''}" placeholder="The Velvet Room">
    <div class="row">
      <div><label for="pl-borough">Borough</label><input id="pl-borough" name="borough" maxlength="40" list="pl-boroughs" value="${p.borough || ''}" placeholder="Where in Ardell City"></div>
      <div><label for="pl-venue">Type of venue</label><input id="pl-venue" name="venue" maxlength="40" list="pl-venues" value="${p.venue || ''}" placeholder="Bar, club, café…"></div>
    </div>
    <datalist id="pl-boroughs">${(data?.boroughs || []).map((b) => html`<option value="${b}"></option>`)}</datalist>
    <datalist id="pl-venues">${[...new Set([...(data?.venues || []), ...VENUES])].map((v) => html`<option value="${v}"></option>`)}</datalist>
    <label for="pl-desc">About this place <small class="muted">(optional)</small></label>
    <textarea id="pl-desc" name="description" rows="4" maxlength="2000" placeholder="What it's like, who goes there…">${p.description || ''}</textarea>
    <div class="error"></div>
    <div class="actions end"><button type="button" data-close>Cancel</button><button type="submit" class="primary">${p.id ? 'Save' : 'Add location'}</button></div>
  </form>`, {
    init: (d) => {
      const drawPic = () => render($('#pl-pic', d), picture ? html`<img src="${picture}" alt="">` : html`<span class="muted small">No picture yet</span>`);
      drawPic();
      $('#pl-file', d).addEventListener('change', async (e) => {
        const f = e.target.files[0];
        if (!f) return;
        try { picture = await uploadImage(f, 1400); drawPic(); } catch (err) { toast(err.message); }
      });
      $('#pl-link', d).addEventListener('click', async () => { const url = await askImageLink(); if (url) { picture = url; drawPic(); } });
    },
    submit: async (form) => {
      const body = { ...form, picture: picture || null };
      await api(p.id ? `/api/places/${p.id}` : '/api/places', { method: p.id ? 'PUT' : 'POST', body });
      toast(p.id ? 'Saved' : `${form.name} added to Locations`);
      return true;
    },
  });
  return !!res;
}
