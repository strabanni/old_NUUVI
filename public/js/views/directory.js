// The directory: every writer on this NUUVI (by username) and every character in their cast.
import { html, render, api, $, $$, avatar, applyColors, icons } from '../lib.js';
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
