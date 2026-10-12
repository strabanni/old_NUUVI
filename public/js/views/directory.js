// The directory: every writer on this NUUVI (by username) and every character in their cast.
import { html, render, api, $, $$, avatar, applyColors } from '../lib.js';
import { state, page, routeAlive, ensureAlive } from '../main.js';
import { characterCard } from './characters.js';

export async function viewDirectory() {
  const alive = routeAlive();
  const { writers } = await api('/api/directory');
  ensureAlive(alive);
  const all = writers.flatMap((w) => w.characters.map((c) => ({ ...c, writer: w })))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  let view = sessionStorage.getItem('nuuvi:dir-view') || 'writers';
  let q = '';

  const body = page({
    alive,
    title: 'Directory',
    subtitle: `${writers.length} writers · ${all.length} characters`,
    body: html`
      <div class="dir-tools">
        <input type="search" class="search" id="dir-q" placeholder="Search names, usernames, taglines…" aria-label="Search the directory">
        <div class="seg" role="group" aria-label="Show">
          <button type="button" data-view="writers">By writer</button>
          <button type="button" data-view="characters">All characters</button>
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
        </section>`)}` : html`<div class="empty"><p>Nobody matches “${q}”.</p></div>`);
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
  body.addEventListener('click', (e) => {
    const b = e.target.closest('[data-view]');
    if (!b) return;
    view = b.dataset.view;
    sessionStorage.setItem('nuuvi:dir-view', view);
    draw();
  });
  $('#dir-q', body).addEventListener('input', (e) => { q = e.target.value.trim().toLowerCase(); draw(); });
}
