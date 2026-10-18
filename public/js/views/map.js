// The Ardell City map (Directory → Locations). Ardell City is NUUVI's New York, so the map is a live
// street map of New York, Apple Maps / GTA style: zoom, drag, tilt into 3D buildings, rotate. The
// real borough, neighbourhood and landmark names are hidden so the city reads as Ardell City.
// Places are pins; little glowing avatars show which characters are where right now (from the open
// episodes set at each place). Tap a pin for the place. In "pick" mode, tap where a new place goes.
//
// The map software (MapLibre) is part of NUUVI (public/vendor/maplibre); the map itself comes from
// OpenFreeMap (free, no account). If it can't load, the drawn map is shown instead.
import { html, raw, render, $, $$, avatar, icons, gradAttr, applyColors } from '../lib.js';
import { CITY_SVG } from '../citymap.js';

const STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const HOME = { center: [-73.975, 40.742], zoom: 11.7, pitch: 45, bearing: -29 }; // Manhattan's grid runs straight up
const BOUNDS = [
  [-74.45, 40.42],
  [-73.55, 41.05],
];
// Map labels that would give away the real city: boroughs, neighbourhoods, landmarks, rivers.
const HIDDEN_LABELS = ['place', 'poi', 'water_name', 'aerodrome_label', 'mountain_peak', 'housenumber', 'park'];

let loading = null;
function loadMapLibre() {
  if (window.maplibregl) return Promise.resolve(window.maplibregl);
  loading ??= new Promise((resolve, reject) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = '/vendor/maplibre/maplibre-gl.css';
    document.head.append(css);
    const s = document.createElement('script');
    s.src = '/vendor/maplibre/maplibre-gl-csp.js';
    s.onload = () => {
      window.maplibregl.setWorkerUrl('/vendor/maplibre/maplibre-gl-csp-worker.js');
      resolve(window.maplibregl);
    };
    s.onerror = () => {
      loading = null;
      reject(new Error('Map failed to load'));
    };
    document.head.append(s);
  });
  return loading;
}

const isDark = () => document.documentElement.dataset.theme === 'dark';

// The map's own colours are for daytime; at night (dark mode) everything is re-coloured to match NUUVI.
function nightMode(map) {
  const set = (id, prop, value) => {
    try {
      map.setPaintProperty(id, prop, value);
    } catch {
      /* not this layer */
    }
  };
  for (const l of map.getStyle().layers) {
    const id = l.id;
    const src = l['source-layer'] || '';
    if (l.type === 'background') set(id, 'background-color', '#141519');
    else if (l.type === 'fill') {
      set(
        id,
        'fill-color',
        /water/.test(src + id)
          ? '#0f2233'
          : /park|wood|grass|landcover|scrub|wetland/.test(src + id)
            ? '#17261d'
            : /building/.test(src + id)
              ? '#23252c'
              : '#1a1c21',
      );
      set(id, 'fill-outline-color', 'rgba(0,0,0,0)');
    } else if (l.type === 'fill-extrusion') set(id, 'fill-extrusion-color', '#2a2d35');
    else if (l.type === 'line') {
      set(
        id,
        'line-color',
        /water/.test(src + id)
          ? '#0f2233'
          : /boundary/.test(src + id)
            ? '#3d3f47'
            : /motorway|trunk|primary/.test(id)
              ? '#4a4537'
              : '#30333b',
      );
    } else if (l.type === 'symbol') {
      set(id, 'text-color', '#c3c7cf');
      set(id, 'text-halo-color', '#141519');
    }
  }
}

// Draws the map into `el`. `onPlace(place)` runs when a pin is tapped; in pick mode `onPick(lat, lng)`
// runs when the map is tapped.
export function mountCityMap(el, data, { onPlace = null, pick = false, onPick = null, pin = null, focus = null } = {}) {
  dropMap(el);
  const pinned = (data.places || []).filter((p) => p.lat != null && p.lng != null);
  const out = pinned.reduce((n, p) => n + p.here.length, 0);
  render(
    el,
    html`
    <div class="city-map live ${pick ? 'picking' : ''}">
      <div class="ml-map" id="ml-map"></div>
      <div class="cm-brand">${icons.pin} Ardell City</div>
      ${
        pick
          ? html`<div class="cm-hint">Tap the map where this place is</div>`
          : html`<div class="cm-legend"><span class="cm-live"></span>${out ? `${out} ${out === 1 ? 'character' : 'characters'} out in the city` : 'Nobody out right now'}</div>`
      }
      <button type="button" class="cm-3d" id="cm-3d" title="Flat map / 3D">3D</button>
      <div class="cm-card" id="cm-card" hidden></div>
    </div>`,
  );
  const box = $('#ml-map', el);
  let fellBack = false;
  const fallback = () => {
    if (fellBack) return;
    fellBack = true;
    dropMap(el);
    mountDrawnMap(el, data, { onPlace, pick, onPick, pin });
  };
  loadMapLibre()
    .then((ml) => {
      if (!el.isConnected || fellBack) return;
      const start = pin
        ? { ...HOME, center: [pin.lng, pin.lat], zoom: 14.5 }
        : focus
          ? { ...HOME, center: [focus.lng, focus.lat], zoom: 12.3 }
          : HOME;
      const map = new ml.Map({
        container: box,
        style: STYLE,
        ...start,
        maxBounds: BOUNDS,
        minZoom: 9.5,
        maxZoom: 18.5,
        attributionControl: { compact: true },
      });
      el._map = map;
      map.addControl(new ml.NavigationControl({ visualizePitch: true }), 'top-right');
      const timer = setTimeout(() => {
        if (!map.loaded() && !map.isStyleLoaded()) fallback();
      }, 12000);
      map.on('error', (e) => {
        if (!map.isStyleLoaded() && /style|fetch|load/i.test(e?.error?.message || '')) {
          clearTimeout(timer);
          fallback();
        }
      });
      map.on('load', () => {
        clearTimeout(timer);
        for (const l of map.getStyle().layers) {
          if (l.type === 'symbol' && HIDDEN_LABELS.includes(l['source-layer'])) map.setLayoutProperty(l.id, 'visibility', 'none');
        }
        if (isDark()) nightMode(map);
        map.resize();
      });
      requestAnimationFrame(() => map.resize());
      // 3D: tilt to see the buildings, or lie flat.
      $('#cm-3d', el).addEventListener('click', () => map.easeTo({ pitch: map.getPitch() > 5 ? 0 : 55, duration: 600 }));

      // Ardell City's borough names, where the real ones would be.
      for (const d of data.districts || []) {
        if (d.lat == null || d.lng == null) continue;
        const label = document.createElement('span');
        label.className = 'ml-borough';
        label.textContent = d.name;
        new ml.Marker({ element: label, anchor: 'center' }).setLngLat([d.lng, d.lat]).addTo(map);
      }

      if (pick) {
        let marker = pin ? new ml.Marker({ color: '#C79AD8' }).setLngLat([pin.lng, pin.lat]).addTo(map) : null;
        map.on('click', (e) => {
          if (marker) marker.setLngLat(e.lngLat);
          else marker = new ml.Marker({ color: '#C79AD8' }).setLngLat(e.lngLat).addTo(map);
          onPick?.(e.lngLat.lat, e.lngLat.lng);
        });
        return;
      }
      for (const p of pinned) {
        const node = document.createElement('button');
        node.type = 'button';
        node.className = `ml-pin ${p.here.length ? 'busy' : ''}`;
        node.setAttribute('aria-label', `${p.name}${p.here.length ? `, ${p.here.length} here now` : ''}`);
        render(node, pinFace(p));
        applyColors(node);
        node.addEventListener('click', (e) => {
          e.stopPropagation();
          onPlace?.(p, node);
          map.easeTo({ center: [p.lng, p.lat], duration: 500 });
        });
        new ml.Marker({ element: node, anchor: 'bottom' }).setLngLat([p.lng, p.lat]).addTo(map);
      }
      // Start framed on the places (when there are a few spread out), unless a borough was picked.
      if (focus) {
        /* already there */
      } else if (pinned.length > 1) {
        const b = new ml.LngLatBounds();
        pinned.forEach((p) => b.extend([p.lng, p.lat]));
        map.once('load', () =>
          map.fitBounds(b, { padding: 80, maxZoom: 14, pitch: HOME.pitch, bearing: HOME.bearing, duration: 0 }),
        );
      } else if (pinned.length === 1) map.setCenter([pinned[0].lng, pinned[0].lat]);
    })
    .catch(fallback);
}

// Lets go of a live map (it uses the graphics card) when its box is redrawn or closed.
export function dropMap(box) {
  if (!box?._map) return;
  try {
    box._map.remove();
  } catch {
    /* already gone */
  }
  box._map = null;
}

const pinFace = (p) => html`
  ${p.here.length ? html`<span class="cm-people">${p.here.slice(0, 3).map((c) => html`<span class="cm-who" data-color="${c.color}"${gradAttr(c)}>${avatar({ name: c.name, src: c.avatar, color: c.color, size: 'xs' })}</span>`)}${p.here.length > 3 ? html`<b>+${p.here.length - 3}</b>` : ''}</span>` : ''}
  <span class="cm-dot"></span>
  <span class="cm-label">${p.name}</span>`;

// ---------- The drawn map (when the live map can't load) ----------
// Pins are placed on it from their latitude/longitude, roughly where they'd be.
// (all five boroughs, Staten Island to the airport)
const toXY = (p) => ({
  x: Math.min(1, Math.max(0, (p.lng + 74.26) / 0.56)),
  y: Math.min(1, Math.max(0, (40.92 - p.lat) / 0.42)),
});
const toLatLng = (x, y) => ({ lat: 40.92 - y * 0.42, lng: -74.26 + x * 0.56 });

function mountDrawnMap(el, data, { onPlace, pick, onPick, pin }) {
  const pinned = (data.places || []).filter((p) => p.lat != null && p.lng != null).map((p) => ({ ...p, ...toXY(p) }));
  const out = pinned.reduce((n, p) => n + p.here.length, 0);
  const start = pin ? toXY(pin) : null;
  render(
    el,
    html`
    <div class="city-map ${pick ? 'picking' : ''}">
      <div class="cm-viewport">
        <div class="cm-stage">
          <div class="cm-art">${raw(CITY_SVG)}</div>
          ${(data.districts || [])
            .filter((d) => d.lat != null)
            .map((d) => {
              const xy = toXY(d);
              return html`<span class="cm-borough" data-x="${xy.x}" data-y="${xy.y}">${d.name}</span>`;
            })}
          ${
            pick
              ? ''
              : pinned.map(
                  (p) => html`
            <button type="button" class="cm-pin ${p.here.length ? 'busy' : ''}" data-pin="${p.id}" data-x="${p.x}" data-y="${p.y}" aria-label="${p.name}">${pinFace(p)}</button>`,
                )
          }
          ${pick ? html`<span class="cm-pin cm-new" id="cm-new" ${start ? html`data-x="${start.x}" data-y="${start.y}"` : 'hidden'}><span class="cm-dot"></span></span>` : ''}
        </div>
      </div>
      <div class="cm-zoom"><button type="button" data-zoom="1" aria-label="Zoom in">+</button><button type="button" data-zoom="-1" aria-label="Zoom out">−</button></div>
      ${
        pick
          ? html`<div class="cm-hint">Tap the map where this place is</div>`
          : html`<div class="cm-legend"><span class="cm-live"></span>${out ? `${out} ${out === 1 ? 'character' : 'characters'} out in the city` : 'Nobody out right now'}</div>`
      }
      <div class="cm-card" id="cm-card" hidden></div>
    </div>`,
  );
  applyColors(el);
  const viewport = $('.cm-viewport', el);
  const stage = $('.cm-stage', el);
  const place = (node) => {
    node.style.setProperty('--x', node.dataset.x);
    node.style.setProperty('--y', node.dataset.y);
  };
  $$('[data-x]', stage).forEach(place);
  let s = 1;
  let tx = 0;
  let ty = 0;
  const apply = () => {
    const w = viewport.clientWidth;
    const h = viewport.clientHeight;
    tx = Math.min(0, Math.max(w - w * s, tx));
    ty = Math.min(0, Math.max(h - stage.offsetHeight * s, ty));
    stage.style.setProperty('--s', String(s));
    stage.style.setProperty('--tx', `${tx}px`);
    stage.style.setProperty('--ty', `${ty}px`);
    el.querySelector('.city-map').classList.toggle('zoomed', s > 1.01);
  };
  const zoomAt = (factor, cx, cy) => {
    const next = Math.min(4, Math.max(1, s * factor));
    tx = cx - ((cx - tx) * next) / s;
    ty = cy - ((cy - ty) * next) / s;
    s = next;
    apply();
  };
  el.addEventListener('click', (e) => {
    const z = e.target.closest('[data-zoom]');
    if (z) zoomAt(Number(z.dataset.zoom) > 0 ? 1.5 : 1 / 1.5, viewport.clientWidth / 2, viewport.clientHeight / 2);
  });
  let last = null;
  let moved = false;
  viewport.addEventListener('pointerdown', (e) => {
    last = { x: e.clientX, y: e.clientY };
    moved = false;
  });
  viewport.addEventListener('pointermove', (e) => {
    if (!last) return;
    const ddx = e.clientX - last.x;
    const ddy = e.clientY - last.y;
    last = { x: e.clientX, y: e.clientY };
    if (Math.abs(ddx) + Math.abs(ddy) > 2) moved = true;
    if (s > 1) {
      tx += ddx;
      ty += ddy;
      apply();
    }
  });
  viewport.addEventListener('pointerup', () => {
    last = null;
  });
  viewport.addEventListener(
    'click',
    (e) => {
      if (moved) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      const pinBtn = e.target.closest('[data-pin]');
      if (pinBtn && onPlace) {
        onPlace(
          pinned.find((p) => p.id === Number(pinBtn.dataset.pin)),
          pinBtn,
        );
        return;
      }
      if (pick) {
        const r = stage.getBoundingClientRect();
        const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
        const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
        const marker = $('#cm-new', el);
        marker.dataset.x = String(x);
        marker.dataset.y = String(y);
        marker.hidden = false;
        place(marker);
        const ll = toLatLng(x, y);
        onPick?.(ll.lat, ll.lng);
      }
    },
    true,
  );
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
        ${
          p.here.length
            ? html`<div class="cm-here"><span class="cm-live"></span><span>Here now</span></div>
          <div class="cm-here-list">${p.here.map(
            (c) => html`<a href="#/s/${c.episode.storyId}/${c.episode.id}" title="${c.episode.name}">
            ${avatar({ name: c.name, src: c.avatar, color: c.color, size: 'xs' })}<span><b>${c.name}</b><small>${c.episode.name}</small></span></a>`,
          )}</div>`
            : html`<p class="muted small">Nobody here right now.</p>`
        }
        <div class="cm-card-actions"><button type="button" class="sm" data-open-place="${p.id}">More</button>${canEdit ? html`<button type="button" class="sm" data-edit-place="${p.id}">Edit</button>` : ''}<button type="button" class="icon-btn sm" data-close-card aria-label="Close">✕</button></div>
      </div>
    </div>`;
}
