// The Ardell City map (Directory → Locations), Apple Maps / GTA style: places as pins, and little
// glowing dots for the characters out there right now (from the open episodes set at each place).
// Zoom with the buttons, the mouse wheel or a pinch; drag to look around. Tap a pin for the place.
// The same map, in "pick" mode, lets someone tap where a new place goes.
import { html, raw, render, $, $$, avatar, icons, gradAttr, applyColors } from '../lib.js';
import { CITY_SVG } from '../citymap.js';

const MAX_ZOOM = 4;

// Draws the map into `el`. `onPlace(place)` runs when a pin is tapped; in pick mode `onPick(x, y)`
// runs when the map is tapped (x and y are 0–1 across and down).
export function mountCityMap(el, data, { onPlace = null, pick = false, onPick = null, pin = null } = {}) {
  const pinned = (data.places || []).filter((p) => p.x != null && p.y != null);
  const out = pinned.reduce((n, p) => n + p.here.length, 0);
  render(el, html`
    <div class="city-map ${pick ? 'picking' : ''}">
      <div class="cm-viewport">
        <div class="cm-stage">
          <div class="cm-art">${data.map ? html`<img src="${data.map}" alt="Map of Ardell City" draggable="false">` : raw(CITY_SVG)}</div>
          ${pick ? '' : pinned.map((p) => html`
            <button type="button" class="cm-pin ${p.here.length ? 'busy' : ''}" data-pin="${p.id}" data-x="${p.x}" data-y="${p.y}" aria-label="${p.name}${p.here.length ? `, ${p.here.length} here now` : ''}">
              ${p.here.length ? html`<span class="cm-people">${p.here.slice(0, 3).map((c) => html`<span class="cm-who" data-color="${c.color}"${gradAttr(c)}>${avatar({ name: c.name, src: c.avatar, color: c.color, size: 'xs' })}</span>`)}${p.here.length > 3 ? html`<b>+${p.here.length - 3}</b>` : ''}</span>` : ''}
              <span class="cm-dot"></span>
              <span class="cm-label">${p.name}</span>
            </button>`)}
          ${pick ? html`<span class="cm-pin cm-new" id="cm-new" ${pin ? html`data-x="${pin.x}" data-y="${pin.y}"` : 'hidden'}><span class="cm-dot"></span></span>` : ''}
        </div>
      </div>
      <div class="cm-zoom"><button type="button" data-zoom="1" aria-label="Zoom in">+</button><button type="button" data-zoom="-1" aria-label="Zoom out">−</button></div>
      ${pick ? html`<div class="cm-hint">Tap the map where this place is</div>`
        : html`<div class="cm-legend"><span class="cm-live"></span>${out ? `${out} ${out === 1 ? 'character' : 'characters'} out in the city` : 'Nobody out right now'}</div>`}
      <div class="cm-card" id="cm-card" hidden></div>
    </div>`);
  applyColors(el);
  const viewport = $('.cm-viewport', el);
  const stage = $('.cm-stage', el);
  const place = (node) => { node.style.setProperty('--x', node.dataset.x); node.style.setProperty('--y', node.dataset.y); };
  $$('[data-x]', stage).forEach(place);
  // A picture map keeps its own shape, so the pins stay on the right spots.
  const img = $('.cm-art img', stage);
  if (img) {
    const shape = () => { if (img.naturalWidth) stage.style.setProperty('--ar', `${img.naturalWidth} / ${img.naturalHeight}`); };
    img.addEventListener('load', shape);
    shape();
  }

  // ---- zoom & pan (a transform on the stage) ----
  let s = 1; let tx = 0; let ty = 0;
  const clamp = () => {
    const w = viewport.clientWidth; const h = viewport.clientHeight;
    tx = Math.min(0, Math.max(w - w * s, tx));
    ty = Math.min(0, Math.max(h - stage.offsetHeight * s, ty));
  };
  const apply = () => {
    clamp();
    stage.style.setProperty('--s', String(s));
    stage.style.setProperty('--tx', `${tx}px`);
    stage.style.setProperty('--ty', `${ty}px`);
    el.querySelector('.city-map').classList.toggle('zoomed', s > 1.01);
  };
  const zoomAt = (factor, cx, cy) => {
    const next = Math.min(MAX_ZOOM, Math.max(1, s * factor));
    tx = cx - ((cx - tx) * next) / s;
    ty = cy - ((cy - ty) * next) / s;
    s = next;
    apply();
  };
  el.addEventListener('click', (e) => {
    const z = e.target.closest('[data-zoom]');
    if (z) zoomAt(Number(z.dataset.zoom) > 0 ? 1.5 : 1 / 1.5, viewport.clientWidth / 2, viewport.clientHeight / 2);
  });
  // Mouse wheel zooms with Ctrl / ⌘ held (a trackpad pinch counts), so the page still scrolls normally.
  viewport.addEventListener('wheel', (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    const r = viewport.getBoundingClientRect();
    zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  // Drag to move around; two fingers pinch to zoom. A tap (no movement) is a click.
  const pointers = new Map();
  let moved = false; let pinchFrom = 0;
  viewport.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved = false;
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinchFrom = Math.hypot(a.x - b.x, a.y - b.y); }
  });
  viewport.addEventListener('pointermove', (e) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const now = { x: e.clientX, y: e.clientY };
    pointers.set(e.pointerId, now);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const r = viewport.getBoundingClientRect();
      if (pinchFrom) zoomAt(dist / pinchFrom, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
      pinchFrom = dist;
      moved = true;
      return;
    }
    const ddx = now.x - prev.x; const ddy = now.y - prev.y;
    if (Math.abs(ddx) + Math.abs(ddy) > 2) moved = true;
    if (s > 1) { tx += ddx; ty += ddy; apply(); }
  });
  const up = (e) => { pointers.delete(e.pointerId); if (pointers.size < 2) pinchFrom = 0; };
  viewport.addEventListener('pointerup', up);
  viewport.addEventListener('pointercancel', up);
  viewport.addEventListener('click', (e) => {
    if (moved) { e.preventDefault(); e.stopPropagation(); return; }
    const pinBtn = e.target.closest('[data-pin]');
    if (pinBtn && onPlace) { onPlace(pinned.find((p) => p.id === Number(pinBtn.dataset.pin)), pinBtn); return; }
    if (pick) {
      const r = stage.getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
      const marker = $('#cm-new', el);
      marker.dataset.x = x.toFixed(4); marker.dataset.y = y.toFixed(4); marker.hidden = false;
      place(marker);
      onPick?.(x, y);
    }
  }, true);
  apply();
}

// The little card that opens over the map for a place: picture, tags, and who's there now.
export function placeCard(p, { canEdit = false } = {}) {
  return html`
    <div class="cm-card-in">
      ${p.picture ? html`<img src="${p.picture}" alt="">` : ''}
      <div class="cm-card-body">
        <b>${p.name}</b>
        <div class="npc-meta">${p.borough ? html`<span class="tag">${icons.pin} ${p.borough}</span>` : ''}${p.venue ? html`<span class="tag">#${p.venue}</span>` : ''}</div>
        ${p.here.length ? html`<div class="cm-here"><span class="cm-live"></span><span>Here now</span></div>
          <div class="cm-here-list">${p.here.map((c) => html`<a href="#/s/${c.episode.storyId}/${c.episode.id}" title="${c.episode.name}">
            ${avatar({ name: c.name, src: c.avatar, color: c.color, size: 'xs' })}<span><b>${c.name}</b><small>${c.episode.name}</small></span></a>`)}</div>`
          : html`<p class="muted small">Nobody here right now.</p>`}
        <div class="cm-card-actions"><button type="button" class="sm" data-open-place="${p.id}">More</button>${canEdit ? html`<button type="button" class="sm" data-edit-place="${p.id}">Edit</button>` : ''}<button type="button" class="icon-btn sm" data-close-card aria-label="Close">✕</button></div>
      </div>
    </div>`;
}
