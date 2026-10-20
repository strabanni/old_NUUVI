// The directory: every writer on this NUUVI (you included) with the characters in their cast, the supporting cast,
// and the Locations of Ardell City (places anyone can add).
import {
  html,
  render,
  api,
  $,
  $$,
  avatar,
  applyColors,
  icons,
  modal,
  confirmModal,
  toast,
  uploadImage,
  askImageLink,
  formatPost,
} from '../lib.js';
import { forgetLocations } from './threads.js';
import { mountCityMap, placeCard, dropMap as dropMapOf } from './map.js';
import { state, page, routeAlive, ensureAlive, onLeave, myCharacters } from '../main.js';
import { characterCard, editCharacter } from './characters.js';

export async function viewDirectory() {
  const alive = routeAlive();
  const [{ writers: everyone, anonymous = [] }, myAll] = await Promise.all([api('/api/directory'), myCharacters(true)]);
  ensureAlive(alive);
  // The supporting cast (NPCs) only appears under Supporting Cast: Me and Meet The Cast show the
  // main cast.
  const mine = myAll.filter((c) => !c.npc);
  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  const writers = everyone.map((w) => ({ ...w, characters: w.characters.filter((c) => !c.npc) }));
  const characterCount = writers.reduce((n, w) => n + w.characters.length, 0);
  // Everyone's main cast in one A to Z list, each with their writer (anonymous accounts too).
  const cast = [...writers.flatMap((w) => w.characters.map((c) => ({ ...c, writer: w }))), ...anonymous].sort(byName);
  // The Directory opens on Meet The Cast (unless another view was picked); #/locations opens it on
  // the Locations map once, and #/characters on "Me". ("All characters" is now part of Meet The Cast.)
  let view = sessionStorage.getItem('nuuvi:dir-once') || sessionStorage.getItem('nuuvi:dir-view') || 'writers';
  if (view === 'characters') view = 'writers';
  sessionStorage.removeItem('nuuvi:dir-once');
  let q = '';
  let npcData = null;
  let npcTag = '';
  let placeData = null;
  let placeTag = ''; // "b:<borough>"
  let placeVenue = '';

  const body = page({
    alive,
    title: 'Directory',
    banner: 'Writers and the characters they play',
    subtitle: `${writers.length} writers · ${characterCount} characters`,
    body: html`
      <div class="dir-tools">
        <input type="search" class="search" id="dir-q" placeholder="Search names, usernames, taglines…" aria-label="Search the directory">
        <div class="seg dir-tabs no-swipe" role="group" aria-label="Show">
          <button type="button" data-view="me">Me</button>
          <button type="button" data-view="writers">Meet The Cast</button>
          <button type="button" data-view="npcs">Supporting Cast</button>
          <button type="button" data-view="brands">Brands</button>
          <button type="button" data-view="places">Locations</button>
        </div>
      </div>
      <div id="dir-list" class="no-swipe"></div>`,
  });
  const list = $('#dir-list', body);
  const match = (...fields) => !q || fields.some((f) => (f || '').toLowerCase().includes(q));

  // The live map uses the graphics card: let go of it when the list redraws or the page closes.
  const dropMap = () => dropMapOf($('#city-map-box', list));
  onLeave(dropMap);

  function draw() {
    dropMap();
    $$('[data-view]', body).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
    if (view === 'me') {
      // Your own characters (your muses), to open, edit or add to. Lots of them: smaller cards on phones.
      const shown = mine.filter((c) => match(c.name, c.handle, c.tagline));
      render(
        list,
        html`
        <div class="npc-head"><span class="muted small">${mine.length} ${mine.length === 1 ? 'character' : 'characters'} in your cast</span>
          <button type="button" class="primary sm" id="new-char">${icons.plus} New character</button></div>
        ${
          shown.length
            ? html`<div class="char-grid me-grid ${mine.length > 10 ? 'dense' : ''}">${shown.map((c) => characterCard(c, { editable: true }))}</div>`
            : mine.length
              ? html`<div class="empty"><p>Nobody matches “${q}”.</p></div>`
              : html`<div class="card empty"><p class="script">every story needs a cast</p><p>Create your first character to start writing in character.</p></div>`
        }`,
      );
    } else if (view === 'writers') {
      // Meet The Cast: every main character (yours included) A to Z under letter headings, four
      // across, each with the writer who plays them.
      const shown = cast.filter((c) => match(c.name, c.handle, c.tagline, c.writer?.username, c.writer?.displayName));
      const groups = new Map();
      for (const c of shown) {
        const letter = /^[a-z]/i.test(c.name) ? c.name[0].toUpperCase() : '#';
        if (!groups.has(letter)) groups.set(letter, []);
        groups.get(letter).push(c);
      }
      const tile = (c) => html`
        <a class="cast-tile" href="#/c/${c.id}" data-color="${c.color}">
          <span class="ct-pic">${c.avatar || c.portrait ? html`<img src="${c.avatar || c.portrait}" alt="" loading="lazy">` : html`<span class="ct-initial">${c.name.charAt(0).toUpperCase()}</span>`}</span>
          <b class="ct-name">${c.name}</b>
          <small class="ct-writer">${c.writer ? (c.writer.id === state.user.id ? 'You' : `@${c.writer.username}`) : 'Anonymous'}</small>
        </a>`;
      render(
        list,
        shown.length
          ? html`<nav class="cast-letters no-swipe" aria-label="Jump to a letter">${[...groups.keys()].map(
              (l) => html`<a href="#" data-letter="${l}">${l}</a>`,
            )}</nav>
        ${[...groups].map(
          ([letter, chars]) => html`
        <h2 class="cast-letter" id="cast-${letter === '#' ? 'num' : letter}">${letter}</h2>
        <div class="cast-four">${chars.map(tile)}</div>`,
        )}`
          : html`<div class="empty"><p>${q ? `Nobody matches “${q}”.` : 'No characters yet.'}</p></div>`,
      );
    } else if (view === 'brands') {
      // Brand accounts: shops, labels, cafés, magazines… that post on THE NU.
      const brands = everyone.flatMap((w) => w.characters.map((c) => ({ ...c, writer: w }))).filter((c) => c.brand);
      const shown = brands.filter((c) => match(c.name, c.handle, c.tagline, c.writer.username));
      render(
        list,
        html`
        <p class="hint">Brand accounts post on THE NU like a business would. Make one by ticking “This is a brand account” in a character's editor.</p>
        ${
          shown.length
            ? html`<div class="char-grid npc-grid">${shown.map(
                (c) => html`
          <div class="npc-item">
            ${characterCard(c, { editable: c.writer.id === state.user.id })}
            <div class="npc-meta"><span class="muted small">by @${c.writer.username}</span></div>
          </div>`,
              )}</div>`
            : html`<div class="empty"><p>${brands.length ? 'No brands match.' : 'No brand accounts yet.'}</p></div>`
        }`,
      );
    } else if (view === 'npcs') {
      // NPCs: everyone's shared background characters, by category.
      if (!npcData) {
        render(list, html`<p class="muted small">Loading the supporting cast…</p>`);
        api('/api/npcs')
          .then((r) => {
            npcData = r;
            if (view === 'npcs') draw();
          })
          .catch(() => {});
        return;
      }
      const { npcs, tags } = npcData;
      const shown = npcs.filter(
        (n) =>
          (!npcTag || n.npcTags.includes(npcTag)) &&
          match(n.name, n.handle, n.tagline, n.npcTags.join(' '), n.owner.username, n.owner.displayName),
      );
      render(
        list,
        html`
        <div class="npc-head"><div class="chips no-swipe">${html`<button type="button" class="chip-btn" data-tag="" aria-pressed="${!npcTag}">Everyone</button>`}
          ${tags.map((t) => html`<button type="button" class="chip-btn" data-tag="${t}" aria-pressed="${npcTag === t}">#${t}</button>`)}</div>
          <button type="button" class="primary sm" id="new-npc">${icons.plus} Add supporting cast</button></div>
        <p class="hint">The supporting cast: background characters anyone can tag into their episodes. To move one of your characters here, tick “This is supporting cast” in their editor.</p>
        ${npcTag ? html`<h2 class="cat-title"><span>${npcTag}</span><small>${shown.length} ${shown.length === 1 ? 'character' : 'characters'}</small></h2>` : ''}
        ${
          shown.length
            ? html`<div class="char-grid npc-grid">${shown.map(
                (n) => html`
          <div class="npc-item">
            ${characterCard(n, { editable: n.owner.id === state.user.id })}
            <div class="npc-meta"><span class="muted small">by @${n.owner.username}</span>
              ${n.npcTags.map((t) => html`<button type="button" class="tag" data-tag="${t}">#${t}</button>`)}</div>
          </div>`,
              )}</div>`
            : html`<div class="empty"><p>${npcs.length ? 'Nobody in the supporting cast matches.' : 'No supporting cast yet.'}</p></div>`
        }`,
      );
    } else if (view === 'places') {
      // Locations: the guide to Ardell City. The map on top, then the boroughs and their spots.
      if (!placeData) {
        render(list, html`<p class="muted small">Loading locations…</p>`);
        api('/api/places')
          .then((r) => {
            placeData = r;
            if (view === 'places') draw();
          })
          .catch(() => {});
        return;
      }
      const { places, boroughs, venues, districts = [], intro } = placeData;
      const borough = placeTag.startsWith('b:') ? placeTag.slice(2) : '';
      const shown = places.filter(
        (p) =>
          (!borough || p.borough === borough) &&
          (!placeVenue || p.venue === placeVenue) &&
          match(p.name, p.borough, p.venue, p.description),
      );
      const about = districts.find((d) => d.name === borough);
      const card = (p) => html`
          <div class="npc-item">
            <button type="button" class="char-card place-card" data-place="${p.id}" data-color="#C79AD8">
              ${p.picture ? html`<img src="${p.picture}" alt="" loading="lazy">` : html`<span class="initial">${icons.pin}</span>`}
              <span class="cc-top">${p.venue ? html`<span class="cc-badge">${p.venue}</span>` : ''}<span class="cc-name">${p.name}</span></span>
              <span class="cc-glass"><span class="cc-who"><b>${p.name}</b><small>${[p.borough, p.price].filter(Boolean).join(' · ')}</small></span><span class="cc-btn">${p.here.length ? html`<span class="cm-live"></span> ${p.here.length} here` : 'View'}</span></span>
            </button>
            <div class="npc-meta">${p.borough ? html`<button type="button" class="tag" data-ptag="b:${p.borough}">${icons.pin} ${p.borough}</button>` : ''}
              ${p.venue ? html`<button type="button" class="tag" data-pvenue="${p.venue}">#${p.venue}</button>` : ''}
              ${p.lat == null ? html`<span class="cm-unpinned">· not on the map yet</span>` : ''}</div>
          </div>`;
      // With no borough picked, the spots are grouped by borough (Ardell City's own five first).
      const groups = borough
        ? [[borough, shown]]
        : boroughs
            .map((b) => [b, shown.filter((p) => p.borough === b)])
            .concat([['Elsewhere', shown.filter((p) => !p.borough)]])
            .filter(([, l]) => l.length);
      render(
        list,
        html`
        ${
          intro
            ? html`<section class="ardell-intro">
          <h2>${intro.title}</h2>
          <p class="ardell-tag">${intro.tagline}</p>
          <div class="body prose">${formatPost(intro.body)}</div>
          <p class="hint">${intro.note}</p>
        </section>`
            : ''
        }
        <div id="city-map-box"></div>
        <div class="npc-head"><div class="chips no-swipe"><button type="button" class="chip-btn" data-ptag="" aria-pressed="${!borough}">All of Ardell City</button>
          ${boroughs.map((b) => html`<button type="button" class="chip-btn" data-ptag="b:${b}" aria-pressed="${borough === b}">${icons.pin} ${b}</button>`)}</div>
          <span class="row-inline"><select id="place-venue" aria-label="Kind of place"><option value="">Every kind of place</option>${venues.map((v) => html`<option value="${v}" ${v === placeVenue ? 'selected' : ''}>${v}</option>`)}</select>
          <button type="button" class="primary sm" id="new-place">${icons.plus} Add a location</button></span></div>
        ${about ? html`<section class="borough-card"><h2>${about.name}</h2><p>${about.blurb}</p></section>` : ''}
        <p class="hint">Characters show up on the map where their open episode is set: tag the episode's location, or move the scene with the Location button.</p>
        ${
          groups.length
            ? groups.map(
                ([name, list2]) => html`
          <h2 class="cat-title"><span>${name}</span><small>${list2.length} ${list2.length === 1 ? 'place' : 'places'}</small></h2>
          <div class="char-grid npc-grid">${list2.map(card)}</div>`,
              )
            : html`<div class="empty"><p>${places.length ? 'No places match.' : 'No locations yet. Add the first one!'}</p></div>`
        }`,
      );
      $('#place-venue', list).addEventListener('change', (e) => {
        placeVenue = e.target.value;
        draw();
      });
      // The map, with the places shown by the filter, and the boroughs' names.
      mountCityMap(
        $('#city-map-box', list),
        { ...placeData, places: shown, districts },
        {
          focus: about ? { lat: about.lat, lng: about.lng } : null,
          onPlace: (p) => {
            const cardBox = $('#cm-card', list);
            render(cardBox, placeCard(p, { canEdit: p.owner.id === state.user.id || state.user.isAdmin }));
            cardBox.hidden = false;
          },
        },
      );
    }
    applyColors(list);
  }
  draw();
  body.addEventListener('click', async (e) => {
    const jump = e.target.closest('[data-letter]');
    if (jump) {
      e.preventDefault();
      const l = jump.dataset.letter;
      $(`#cast-${l === '#' ? 'num' : l}`, list)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    const pt = e.target.closest('[data-ptag]');
    if (pt && view === 'places') {
      placeTag = pt.dataset.ptag === placeTag ? '' : pt.dataset.ptag;
      draw();
      return;
    }
    const pv = e.target.closest('[data-pvenue]');
    if (pv && view === 'places') {
      placeVenue = pv.dataset.pvenue === placeVenue ? '' : pv.dataset.pvenue;
      draw();
      return;
    }
    if (e.target.closest('#new-place')) {
      if (await editPlace({}, placeData)) {
        placeData = null;
        forgetLocations();
        draw();
      }
      return;
    }
    if (e.target.closest('[data-close-card]')) {
      $('#cm-card', list).hidden = true;
      return;
    }
    const ep = e.target.closest('[data-edit-place]');
    if (ep) {
      if (
        await editPlace(
          placeData.places.find((x) => x.id === Number(ep.dataset.editPlace)),
          placeData,
        )
      ) {
        placeData = null;
        forgetLocations();
        draw();
      }
      return;
    }
    const pc = e.target.closest('[data-place], [data-open-place]');
    if (pc) {
      const p = placeData.places.find((x) => x.id === Number(pc.dataset.place || pc.dataset.openPlace));
      if (await showPlace(p, placeData)) {
        placeData = null;
        forgetLocations();
        draw();
      }
      return;
    }
    const t = e.target.closest('[data-tag]');
    if (t && view === 'npcs') {
      e.preventDefault();
      npcTag = t.dataset.tag === npcTag ? '' : t.dataset.tag;
      draw();
      return;
    }
    // Me: make a character, or edit one of yours.
    if (e.target.closest('#new-char')) {
      if (await editCharacter()) {
        toast('Saved');
        state.characters = null;
        sessionStorage.setItem('nuuvi:dir-once', 'me');
        viewDirectory();
      }
      return;
    }
    const edMine = e.target.closest('[data-edit]');
    if (edMine && (view === 'me' || view === 'brands')) {
      e.preventDefault();
      if (await editCharacter(mine.find((c) => c.id === Number(edMine.dataset.edit)))) {
        toast('Saved');
        state.characters = null;
        sessionStorage.setItem('nuuvi:dir-once', view);
        viewDirectory();
      }
      return;
    }
    if (e.target.closest('#new-npc')) {
      if (await editCharacter({ npc: true })) {
        npcData = null;
        draw();
      }
      return;
    }
    const ed = e.target.closest('[data-edit]');
    if (ed && view === 'npcs') {
      e.preventDefault();
      if (await editCharacter(npcData.npcs.find((n) => n.id === Number(ed.dataset.edit)))) {
        npcData = null;
        draw();
      }
      return;
    }
    const b = e.target.closest('[data-view]');
    if (!b) return;
    view = b.dataset.view;
    // Remember the characters view picked; Locations is visited, not the default.
    if (view !== 'places') sessionStorage.setItem('nuuvi:dir-view', view);
    draw();
  });
  $('#dir-q', body).addEventListener('input', (e) => {
    q = e.target.value.trim().toLowerCase();
    draw();
  });
  // Phones: swipe the list left or right to go to the next or previous tab (Me, By writer, All
  // characters, NPCs, Brands, Locations). Swiping right on the first tab still opens the menu.
  // The map has its own dragging, so swipes on it are left alone.
  const order = $$('[data-view]', body).map((b) => b.dataset.view);
  let touch = null;
  list.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches.length !== 1 || e.target.closest('.maplibregl-map, #city-map-box, input, textarea')) {
        touch = null;
        return;
      }
      touch = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
    },
    { passive: true },
  );
  list.addEventListener(
    'touchend',
    (e) => {
      if (!touch) return;
      const p = e.changedTouches[0];
      const dx = p.clientX - touch.x;
      const dy = p.clientY - touch.y;
      const quick = Date.now() - touch.t < 600;
      touch = null;
      if (!quick || Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx) * 0.6) return;
      const i = order.indexOf(view);
      if (dx > 0 && i === 0) {
        document.body.classList.add('drawer-open');
        return;
      }
      const next = order[Math.min(order.length - 1, Math.max(0, i + (dx < 0 ? 1 : -1)))];
      if (next === view) return;
      view = next;
      if (view !== 'places') sessionStorage.setItem('nuuvi:dir-view', view);
      draw();
      $(`[data-view="${view}"]`, body)?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    },
    { passive: true },
  );
}

// ---------- Locations ----------
const VENUES = [
  'Apartment',
  'Bar',
  'Beach',
  'Café',
  'Club',
  'Gallery',
  'Gym',
  'Hospital',
  'Hotel',
  'Office',
  'Park',
  'Penthouse',
  'Restaurant',
  'School',
  'Shop',
  'Studio',
  'Theatre',
];

// A place, opened from its card: picture, name, tags and what it's like. Resolves true if it changed.
async function showPlace(p, data) {
  const canEdit = p.owner.id === state.user.id || state.user.isAdmin;
  const res = await modal(
    html`<div class="place-view">
    ${
      (p.pictures || []).length
        ? html`<div class="place-gallery">
      <img class="place-pic" id="pl-main" src="${p.pictures[0]}" alt="">
      ${p.pictures.length > 1 ? html`<div class="place-thumbs">${p.pictures.map((u, i) => html`<button type="button" class="${i ? '' : 'on'}" data-show="${u}" aria-label="Picture ${i + 1}"><img src="${u}" alt="" loading="lazy"></button>`)}</div>` : ''}
    </div>`
        : ''
    }
    <h2>${p.name}</h2>
    <div class="npc-meta">${p.borough ? html`<span class="tag">${icons.pin} ${p.borough}</span>` : ''}${p.venue ? html`<span class="tag">#${p.venue}</span>` : ''}</div>
    ${p.description ? html`<div class="body prose">${formatPost(p.description)}</div>` : ''}
    ${
      p.venue || p.hours || p.price || p.since
        ? html`<dl class="place-facts">
      ${p.venue ? html`<div><dt>Lot type</dt><dd>${p.venue}</dd></div>` : ''}
      ${p.hours ? html`<div><dt>Hours</dt><dd>${p.hours}</dd></div>` : ''}
      ${p.price ? html`<div><dt>Expense range</dt><dd>${p.price}</dd></div>` : ''}
      ${p.since ? html`<div><dt>Since</dt><dd>${p.since}</dd></div>` : ''}
    </dl>`
        : ''
    }
    ${
      p.here?.length
        ? html`<div class="cm-here"><span class="cm-live"></span><span>Here now</span></div>
      <div class="cm-here-list">${p.here.map((c) => html`<a href="#/s/${c.episode.storyId}/${c.episode.id}" data-close>${avatar({ name: c.name, src: c.avatar, color: c.color, size: 'xs' })}<span><b>${c.name}</b><small>${c.episode.name}</small></span></a>`)}</div>`
        : ''
    }
    <p class="muted small">Added by @${p.owner.username}${p.lat == null ? ' · not on the map yet' : ''}</p>
    <div class="actions end">
      ${canEdit ? html`<button type="button" class="danger" id="pl-del">Remove</button><button type="button" id="pl-edit">Edit</button>` : ''}
      <button type="button" class="primary" data-close>Close</button>
    </div></div>`,
    {
      init: (d, close) => {
        // Tap a small picture to see it big.
        d.addEventListener('click', (e) => {
          const t = e.target.closest('[data-show]');
          if (!t) return;
          $('#pl-main', d).src = t.dataset.show;
          $$('[data-show]', d).forEach((b) => b.classList.toggle('on', b === t));
        });
        $('#pl-edit', d)?.addEventListener('click', () => close('edit'));
        $('#pl-del', d)?.addEventListener('click', async () => {
          if (!(await confirmModal(`Remove ${p.name} from Locations?`, { ok: 'Remove', danger: true }))) return;
          try {
            await api(`/api/places/${p.id}`, { method: 'DELETE' });
            close('changed');
          } catch (err) {
            toast(err.message);
          }
        });
      },
    },
  );
  if (res === 'edit') return editPlace(p, data);
  return res === 'changed';
}

// Add or change a place. Resolves true when saved.
async function editPlace(p, data) {
  const pictures = [...(p.pictures || (p.picture ? [p.picture] : []))];
  let spot = p.lat != null ? { lat: p.lat, lng: p.lng } : null;
  let pickBox = null;
  const res = await modal(
    html`<form class="place-form">
    <h2>${p.id ? `Edit ${p.name}` : 'Add a location'}</h2>
    <label>Pictures <small class="muted">(up to 12 · the first one is the cover)</small></label>
    <div class="ds-gal-edit pl-gal" id="pl-pic"></div>
    <div class="row-inline"><label class="btn sm file-btn">${icons.image} Add pictures<input type="file" accept="image/*" id="pl-file" multiple hidden></label>
      <button type="button" class="sm" id="pl-link">Link</button></div>
    <label for="pl-name">Name</label><input id="pl-name" name="name" required maxlength="80" value="${p.name || ''}" placeholder="The Velvet Room">
    <div class="row">
      <div><label for="pl-borough">Borough</label><input id="pl-borough" name="borough" maxlength="40" list="pl-boroughs" value="${p.borough || ''}" placeholder="Where in Ardell City"></div>
      <div><label for="pl-venue">Lot type</label><input id="pl-venue" name="venue" maxlength="60" list="pl-venues" value="${p.venue || ''}" placeholder="bar, nightclub, café…"></div>
    </div>
    <div class="row">
      <div><label for="pl-hours">Hours</label><input id="pl-hours" name="hours" maxlength="80" value="${p.hours || ''}" placeholder="9:00 pm – 3:00 am"></div>
      <div><label for="pl-price">Expense range</label><input id="pl-price" name="price" maxlength="80" value="${p.price || ''}" placeholder="$30 – $90"></div>
      <div><label for="pl-since">Since</label><input id="pl-since" name="since" maxlength="60" value="${p.since || ''}" placeholder="est. 2021"></div>
    </div>
    <datalist id="pl-boroughs">${(data?.boroughs || []).map((b) => html`<option value="${b}"></option>`)}</datalist>
    <datalist id="pl-venues">${[...new Set([...(data?.venues || []), ...VENUES])].map((v) => html`<option value="${v}"></option>`)}</datalist>
    <label>On the map <small class="muted">(tap where it is)</small></label>
    <div class="place-pick-map" id="pl-map"></div>
    <label for="pl-desc">About this place <small class="muted">(optional)</small></label>
    <textarea id="pl-desc" name="description" rows="4" maxlength="2000" placeholder="What it's like, who goes there…">${p.description || ''}</textarea>
    <div class="error"></div>
    <div class="actions end"><button type="button" data-close>Cancel</button><button type="submit" class="primary">${p.id ? 'Save' : 'Add location'}</button></div>
  </form>`,
    {
      init: (d) => {
        const drawPic = () =>
          render(
            $('#pl-pic', d),
            pictures.length
              ? html`${pictures.map(
                  (u, i) => html`<span class="thumb"><img src="${u}" alt="">
          <button type="button" data-rm-pic="${i}" aria-label="Remove">✕</button>
          ${i === 0 ? html`<b class="pl-cover">cover</b>` : ''}
          <span class="pl-move">${i > 0 ? html`<button type="button" data-mv-pic="${i}" data-to="${i - 1}" aria-label="Move earlier">‹</button>` : ''}${i < pictures.length - 1 ? html`<button type="button" data-mv-pic="${i}" data-to="${i + 1}" aria-label="Move later">›</button>` : ''}</span></span>`,
                )}`
              : html`<span class="muted small">No pictures yet</span>`,
          );
        drawPic();
        $('#pl-file', d).addEventListener('change', async (e) => {
          for (const f of [...e.target.files].slice(0, 12 - pictures.length)) {
            try {
              toast('Uploading…');
              pictures.push(await uploadImage(f, 1600));
              drawPic();
            } catch (err) {
              toast(err.message);
            }
          }
          e.target.value = '';
        });
        $('#pl-link', d).addEventListener('click', async () => {
          const url = await askImageLink();
          if (url && pictures.length < 12) {
            pictures.push(url);
            drawPic();
          }
        });
        $('#pl-pic', d).addEventListener('click', (e) => {
          const rm = e.target.closest('[data-rm-pic]');
          if (rm) {
            pictures.splice(Number(rm.dataset.rmPic), 1);
            drawPic();
            return;
          }
          const mv = e.target.closest('[data-mv-pic]');
          if (mv) {
            const i = Number(mv.dataset.mvPic);
            const j = Number(mv.dataset.to);
            [pictures[i], pictures[j]] = [pictures[j], pictures[i]];
            drawPic();
          }
        });
        pickBox = $('#pl-map', d);
        mountCityMap(
          pickBox,
          { places: [] },
          {
            pick: true,
            pin: spot,
            onPick: (lat, lng) => {
              spot = { lat, lng };
            },
          },
        );
      },
      submit: async (form) => {
        const body = { ...form, pictures, lat: spot ? spot.lat : null, lng: spot ? spot.lng : null };
        dropMapOf(pickBox);
        await api(p.id ? `/api/places/${p.id}` : '/api/places', { method: p.id ? 'PUT' : 'POST', body });
        toast(p.id ? 'Saved' : `${form.name} added to Locations`);
        return true;
      },
    },
  );
  dropMapOf(pickBox);
  return !!res;
}
